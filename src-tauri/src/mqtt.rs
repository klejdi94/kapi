//! MQTT 3.1.1 client sessions: connect to a broker over TCP (`mqtt://`), TLS
//! (`mqtts://`), WebSocket (`ws://`) or secure WebSocket (`wss://`), subscribe
//! and publish, with every incoming message pushed to the frontend as it
//! arrives. One session per tab, keyed by an id the frontend chooses.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use rumqttc::{AsyncClient, ConnectReturnCode, Event, MqttOptions, Packet, QoS, TlsConfiguration, Transport};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MqttConfig {
    /// `mqtt://host[:1883]`, `mqtts://host[:8883]`, `ws://host[:80]/mqtt`, `wss://host[:443]/mqtt`.
    url: String,
    client_id: String,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    password: Option<String>,
    #[serde(default = "default_keep_alive")]
    keep_alive_secs: u64,
    #[serde(default = "default_true")]
    clean_session: bool,
    #[serde(default)]
    ca_cert_pem: Option<String>,
    #[serde(default)]
    client_cert_pem: Option<String>,
    #[serde(default)]
    client_key_pem: Option<String>,
}

fn default_keep_alive() -> u64 {
    30
}
fn default_true() -> bool {
    true
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum MqttEvent {
    #[serde(rename_all = "camelCase")]
    Connected {
        session_present: bool,
    },
    #[serde(rename_all = "camelCase")]
    Message {
        topic: String,
        /// UTF-8 text when the payload is valid UTF-8, otherwise null and `base64` is set.
        text: Option<String>,
        base64: Option<String>,
        bytes: usize,
        qos: u8,
        retain: bool,
        at_ms: u64,
    },
    #[serde(rename_all = "camelCase")]
    Subscribed {
        granted: Vec<String>,
    },
    Disconnected {
        reason: String,
    },
}

#[derive(Default)]
pub struct MqttSessions(Mutex<HashMap<String, (AsyncClient, tauri::async_runtime::JoinHandle<()>)>>);

#[derive(Debug, PartialEq)]
struct BrokerAddress {
    scheme: &'static str,
    host: String,
    port: u16,
    /// For WebSocket transports rumqttc wants the whole URL as the "host".
    ws_url: Option<String>,
}

fn parse_url(url: &str) -> Result<BrokerAddress, String> {
    let url = url.trim();
    let (scheme, rest, default_port) = if let Some(r) = url.strip_prefix("mqtts://") {
        ("mqtts", r, 8883)
    } else if let Some(r) = url.strip_prefix("ssl://") {
        ("mqtts", r, 8883)
    } else if let Some(r) = url.strip_prefix("mqtt://") {
        ("mqtt", r, 1883)
    } else if let Some(r) = url.strip_prefix("tcp://") {
        ("mqtt", r, 1883)
    } else if let Some(r) = url.strip_prefix("wss://") {
        ("wss", r, 443)
    } else if let Some(r) = url.strip_prefix("ws://") {
        ("ws", r, 80)
    } else if !url.contains("://") {
        ("mqtt", url, 1883)
    } else {
        return Err("Use an mqtt://, mqtts://, ws:// or wss:// broker address".into());
    };
    let authority = rest.split('/').next().unwrap_or("");
    if authority.is_empty() {
        return Err("The broker address has no host".into());
    }
    let (host, port) = match authority.rsplit_once(':') {
        Some((h, p)) if !h.ends_with(']') || authority.starts_with('[') => (
            h.trim_matches(['[', ']']).to_string(),
            p.parse::<u16>().map_err(|_| format!("Invalid port {p}"))?,
        ),
        _ => (authority.trim_matches(['[', ']']).to_string(), default_port),
    };
    let ws_url = if scheme == "ws" || scheme == "wss" {
        let path = rest.find('/').map(|i| &rest[i..]).unwrap_or("/mqtt");
        Some(format!("{scheme}://{host}:{port}{path}"))
    } else {
        None
    };
    Ok(BrokerAddress {
        scheme,
        host,
        port,
        ws_url,
    })
}

fn tls_config(config: &MqttConfig) -> Result<TlsConfiguration, String> {
    use rustls_pki_types::pem::PemObject;
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let mut roots = rustls::RootCertStore::empty();
    for cert in rustls_native_certs::load_native_certs().certs {
        let _ = roots.add(cert);
    }
    if let Some(ca) = config.ca_cert_pem.as_deref().filter(|s| !s.trim().is_empty()) {
        for cert in rustls_pki_types::CertificateDer::pem_slice_iter(ca.as_bytes()) {
            roots
                .add(cert.map_err(|e| format!("CA certificate: {e}"))?)
                .map_err(|e| format!("CA certificate: {e}"))?;
        }
    }
    let builder = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|e| e.to_string())?
        .with_root_certificates(roots);
    let client = match (
        config.client_cert_pem.as_deref().filter(|s| !s.trim().is_empty()),
        config.client_key_pem.as_deref().filter(|s| !s.trim().is_empty()),
    ) {
        (Some(cert), Some(key)) => {
            let certs = rustls_pki_types::CertificateDer::pem_slice_iter(cert.as_bytes())
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Client certificate: {e}"))?;
            let key = rustls_pki_types::PrivateKeyDer::from_pem_slice(key.as_bytes()).map_err(|e| format!("Client key: {e}"))?;
            builder.with_client_auth_cert(certs, key).map_err(|e| e.to_string())?
        }
        _ => builder.with_no_client_auth(),
    };
    Ok(TlsConfiguration::Rustls(Arc::new(client)))
}

fn options_for(config: &MqttConfig) -> Result<MqttOptions, String> {
    let address = parse_url(&config.url)?;
    let client_id = if config.client_id.trim().is_empty() {
        format!("kapi-{}", std::process::id())
    } else {
        config.client_id.trim().to_string()
    };
    let host = address.ws_url.clone().unwrap_or_else(|| address.host.clone());
    let mut options = MqttOptions::new(client_id, host, address.port);
    options.set_keep_alive(Duration::from_secs(config.keep_alive_secs.max(5)));
    options.set_clean_session(config.clean_session);
    options.set_max_packet_size(16 * 1024 * 1024, 16 * 1024 * 1024);
    if let Some(user) = config.username.as_deref().filter(|u| !u.is_empty()) {
        options.set_credentials(user, config.password.clone().unwrap_or_default());
    }
    match address.scheme {
        "mqtts" => {
            options.set_transport(Transport::tls_with_config(tls_config(config)?));
        }
        "ws" => {
            options.set_transport(Transport::Ws);
        }
        "wss" => {
            options.set_transport(Transport::wss_with_config(tls_config(config)?));
        }
        _ => {}
    }
    Ok(options)
}

pub fn qos(level: u8) -> Result<QoS, String> {
    match level {
        0 => Ok(QoS::AtMostOnce),
        1 => Ok(QoS::AtLeastOnce),
        2 => Ok(QoS::ExactlyOnce),
        _ => Err("QoS must be 0, 1 or 2".into()),
    }
}

/// Connects and starts streaming events; resolves once the broker accepts (or refuses) the connection.
#[tauri::command]
pub async fn kapi_mqtt_connect(
    session_id: String,
    config: MqttConfig,
    events: Channel<MqttEvent>,
    sessions: State<'_, MqttSessions>,
) -> Result<(), String> {
    if let Some((client, task)) = sessions.0.lock().unwrap().remove(&session_id) {
        let _ = client.try_disconnect();
        task.abort();
    }
    let options = options_for(&config)?;
    let (client, mut eventloop) = AsyncClient::new(options, 64);
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let started = Instant::now();

    let task = tauri::async_runtime::spawn(async move {
        let mut ready = Some(ready_tx);
        loop {
            match eventloop.poll().await {
                Ok(Event::Incoming(Packet::ConnAck(ack))) => {
                    if ack.code == ConnectReturnCode::Success {
                        let _ = events.send(MqttEvent::Connected {
                            session_present: ack.session_present,
                        });
                        if let Some(tx) = ready.take() {
                            let _ = tx.send(Ok(()));
                        }
                    } else {
                        let reason = format!("The broker refused the connection: {:?}", ack.code);
                        if let Some(tx) = ready.take() {
                            let _ = tx.send(Err(reason.clone()));
                        }
                        let _ = events.send(MqttEvent::Disconnected { reason });
                        break;
                    }
                }
                Ok(Event::Incoming(Packet::Publish(p))) => {
                    let (text, base64) = match std::str::from_utf8(&p.payload) {
                        Ok(t) => (Some(t.to_string()), None),
                        Err(_) => (None, Some(base64::engine::general_purpose::STANDARD.encode(&p.payload))),
                    };
                    let _ = events.send(MqttEvent::Message {
                        topic: p.topic,
                        text,
                        base64,
                        bytes: p.payload.len(),
                        qos: p.qos as u8,
                        retain: p.retain,
                        at_ms: started.elapsed().as_millis() as u64,
                    });
                }
                Ok(Event::Incoming(Packet::SubAck(ack))) => {
                    let granted = ack.return_codes.iter().map(|c| format!("{c:?}")).collect();
                    let _ = events.send(MqttEvent::Subscribed { granted });
                }
                Ok(Event::Incoming(Packet::Disconnect)) => {
                    let _ = events.send(MqttEvent::Disconnected {
                        reason: "The broker closed the connection".into(),
                    });
                    break;
                }
                Ok(Event::Outgoing(rumqttc::Outgoing::Disconnect)) => {
                    let _ = events.send(MqttEvent::Disconnected {
                        reason: "Disconnected".into(),
                    });
                    break;
                }
                Ok(_) => {}
                Err(err) => {
                    let reason = err.to_string();
                    if let Some(tx) = ready.take() {
                        let _ = tx.send(Err(format!("Could not connect: {reason}")));
                    } else {
                        let _ = events.send(MqttEvent::Disconnected { reason });
                    }
                    // rumqttc would reconnect on the next poll; kapi leaves that to the user.
                    break;
                }
            }
        }
    });

    sessions.0.lock().unwrap().insert(session_id.clone(), (client, task));
    let outcome = tokio::time::timeout(Duration::from_secs(15), ready_rx).await;
    let result = match outcome {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("The connection ended before the broker answered".into()),
        Err(_) => Err("The broker didn't answer within 15s".into()),
    };
    if result.is_err() {
        if let Some((_, task)) = sessions.0.lock().unwrap().remove(&session_id) {
            task.abort();
        }
    }
    result
}

fn client_for(sessions: &MqttSessions, session_id: &str) -> Result<AsyncClient, String> {
    sessions
        .0
        .lock()
        .unwrap()
        .get(session_id)
        .map(|(c, _)| c.clone())
        .ok_or_else(|| "Not connected".to_string())
}

#[tauri::command]
pub async fn kapi_mqtt_subscribe(
    session_id: String,
    topic: String,
    qos_level: u8,
    sessions: State<'_, MqttSessions>,
) -> Result<(), String> {
    let client = client_for(&sessions, &session_id)?;
    client.subscribe(topic, qos(qos_level)?).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn kapi_mqtt_unsubscribe(session_id: String, topic: String, sessions: State<'_, MqttSessions>) -> Result<(), String> {
    let client = client_for(&sessions, &session_id)?;
    client.unsubscribe(topic).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn kapi_mqtt_publish(
    session_id: String,
    topic: String,
    payload: String,
    qos_level: u8,
    retain: bool,
    sessions: State<'_, MqttSessions>,
) -> Result<(), String> {
    if topic.contains('+') || topic.contains('#') {
        return Err("Wildcards (+, #) are only for subscribing — publish to a concrete topic".into());
    }
    let client = client_for(&sessions, &session_id)?;
    client
        .publish(topic, qos(qos_level)?, retain, payload.into_bytes())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn kapi_mqtt_disconnect(session_id: String, sessions: State<'_, MqttSessions>) -> Result<(), String> {
    let entry = sessions.0.lock().unwrap().remove(&session_id);
    if let Some((client, task)) = entry {
        let _ = client.disconnect().await;
        // Give the event loop a moment to send DISCONNECT, then stop it either way.
        tokio::time::sleep(Duration::from_millis(200)).await;
        task.abort();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_broker_addresses() {
        assert_eq!(
            parse_url("mqtt://broker.local").unwrap(),
            BrokerAddress {
                scheme: "mqtt",
                host: "broker.local".into(),
                port: 1883,
                ws_url: None
            }
        );
        assert_eq!(parse_url("broker.local:1884").unwrap().port, 1884);
        assert_eq!(
            parse_url("mqtts://b:8884").unwrap(),
            BrokerAddress {
                scheme: "mqtts",
                host: "b".into(),
                port: 8884,
                ws_url: None
            }
        );
        assert_eq!(
            parse_url("ws://localhost:9001").unwrap().ws_url.as_deref(),
            Some("ws://localhost:9001/mqtt")
        );
        assert_eq!(
            parse_url("wss://b.example.com/ws/mqtt").unwrap().ws_url.as_deref(),
            Some("wss://b.example.com:443/ws/mqtt")
        );
        assert!(parse_url("http://x").is_err());
        assert!(parse_url("mqtt://x:notaport").is_err());
    }

    #[test]
    fn builds_tls_options_with_ring() {
        let config = MqttConfig {
            url: "mqtts://localhost:8883".into(),
            client_id: "kapi-test".into(),
            username: Some("u".into()),
            password: Some("p".into()),
            keep_alive_secs: 30,
            clean_session: true,
            ca_cert_pem: None,
            client_cert_pem: None,
            client_key_pem: None,
        };
        options_for(&config).unwrap();
        assert!(qos(3).is_err());
    }
}

/// Against a real broker: only runs when `KAPI_MQTT_TEST_ADDR` points at one
/// (e2e/desktop/servers.js starts an aedes broker on 127.0.0.1:18883, plus
/// WebSocket on :18884).
#[cfg(test)]
mod live_tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    fn collect() -> (Channel<MqttEvent>, Arc<StdMutex<Vec<serde_json::Value>>>) {
        let seen = Arc::new(StdMutex::new(Vec::new()));
        let sink = seen.clone();
        let channel = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                sink.lock().unwrap().push(serde_json::from_str(&json).unwrap());
            }
            Ok(())
        });
        (channel, seen)
    }

    async fn round_trip(url: &str) {
        let config = MqttConfig {
            url: url.into(),
            client_id: format!("kapi-live-{}", url.len()),
            username: None,
            password: None,
            keep_alive_secs: 30,
            clean_session: true,
            ca_cert_pem: None,
            client_cert_pem: None,
            client_key_pem: None,
        };
        let options = options_for(&config).unwrap();
        let (client, mut eventloop) = AsyncClient::new(options, 16);
        let (events, seen) = collect();
        let task = tokio::spawn(async move {
            while let Ok(event) = eventloop.poll().await {
                if let Event::Incoming(Packet::Publish(p)) = event {
                    let _ = events.send(MqttEvent::Message {
                        topic: p.topic,
                        text: String::from_utf8(p.payload.to_vec()).ok(),
                        base64: None,
                        bytes: p.payload.len(),
                        qos: p.qos as u8,
                        retain: p.retain,
                        at_ms: 0,
                    });
                }
            }
        });
        client.subscribe("kapi/test/#", QoS::AtLeastOnce).await.unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        client
            .publish("kapi/test/hello", QoS::AtLeastOnce, false, b"hi from kapi".to_vec())
            .await
            .unwrap();
        for _ in 0..40 {
            if !seen.lock().unwrap().is_empty() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        task.abort();
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1, "{url}: {seen:?}");
        assert_eq!(seen[0]["topic"], "kapi/test/hello");
        assert_eq!(seen[0]["text"], "hi from kapi");
        assert_eq!(seen[0]["qos"], 1);
    }

    #[test]
    fn publishes_and_receives_over_tcp_and_websocket() {
        let Ok(addr) = std::env::var("KAPI_MQTT_TEST_ADDR") else { return };
        let ws = std::env::var("KAPI_MQTT_TEST_WS").unwrap_or_default();
        tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                round_trip(&format!("mqtt://{addr}")).await;
                if !ws.is_empty() {
                    round_trip(&ws).await;
                }
            });
    }
}
