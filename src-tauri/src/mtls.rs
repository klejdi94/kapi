use serde::{Deserialize, Serialize};
use std::time::Duration;

/// One field of a form-data body — `kind` picks which of the other fields
/// are populated. File bytes travel whole through IPC rather than a path,
/// since the browser-side `File` object is what kapi already has in hand.
#[derive(Deserialize)]
pub struct MultipartField {
    pub name: String,
    pub kind: String, // "text" | "file"
    pub value: Option<String>,
    pub file_bytes: Option<Vec<u8>>,
    pub file_name: Option<String>,
    pub content_type: Option<String>,
}

/// Only the one shape kapi's `run()` actually needs to send/receive — not a
/// general-purpose reqwest wrapper. `body` and `multipart` are mutually
/// exclusive: a plain body is raw bytes, a form-data one arrives as
/// structured fields and gets rebuilt into a real multipart body here
/// (reqwest generates the boundary — same reason the JS side never sets a
/// manual Content-Type for it either).
#[derive(Deserialize)]
pub struct MtlsRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
    pub multipart: Option<Vec<MultipartField>>,
    pub timeout_ms: u64,
    pub follow_redirects: bool,
    pub client_cert_pem: String,
    pub client_key_pem: String,
    /// One or more PEM certificates to trust in addition to the system root store.
    pub ca_cert_pem: Option<String>,
    pub accept_invalid_certs: bool,
    pub accept_invalid_hostnames: bool,
    pub proxy_url: Option<String>,
}

fn build_multipart_form(fields: Vec<MultipartField>) -> Result<reqwest::blocking::multipart::Form, String> {
    let mut form = reqwest::blocking::multipart::Form::new();
    for field in fields {
        form = if field.kind == "file" {
            let bytes = field
                .file_bytes
                .ok_or_else(|| format!("File field \"{}\" had no bytes", field.name))?;
            let mut part = reqwest::blocking::multipart::Part::bytes(bytes);
            if let Some(file_name) = field.file_name {
                part = part.file_name(file_name);
            }
            if let Some(content_type) = field.content_type {
                part = part.mime_str(&content_type).map_err(|e| e.to_string())?;
            }
            form.part(field.name, part)
        } else {
            form.text(field.name, field.value.unwrap_or_default())
        };
    }
    Ok(form)
}

#[derive(Serialize)]
pub struct MtlsResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    pub final_url: String,
}

/// The one case `run()` (transport.ts) can't send through
/// `@tauri-apps/plugin-http`'s `fetch()` — it has no client-certificate
/// option — so this builds a dedicated `reqwest` client instead, per call
/// (a client identity isn't something to leave cached across unrelated
/// requests). Runs inside `spawn_blocking`, same reasoning as the Claude CLI
/// and OAuth listener commands: reqwest's blocking API blocks a real thread
/// for the round trip, and a synchronous command would do that on the main
/// thread instead.
#[tauri::command]
pub async fn kapi_send_mtls(req: MtlsRequest) -> Result<MtlsResponse, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<MtlsResponse, String> {
        let identity_pem = format!("{}\n{}", req.client_key_pem, req.client_cert_pem);
        let identity = reqwest::Identity::from_pem(identity_pem.as_bytes()).map_err(|e| format!("Invalid client certificate/key: {e}"))?;

        let mut builder = reqwest::blocking::Client::builder()
            .identity(identity)
            .danger_accept_invalid_certs(req.accept_invalid_certs)
            .danger_accept_invalid_hostnames(req.accept_invalid_hostnames)
            .redirect(if req.follow_redirects {
                reqwest::redirect::Policy::limited(20)
            } else {
                reqwest::redirect::Policy::none()
            })
            .timeout(Duration::from_millis(req.timeout_ms.max(1000)));

        if let Some(ca_pem) = &req.ca_cert_pem {
            if !ca_pem.trim().is_empty() {
                let cert = reqwest::Certificate::from_pem(ca_pem.as_bytes()).map_err(|e| format!("Invalid CA certificate: {e}"))?;
                builder = builder.add_root_certificate(cert);
            }
        }

        if let Some(proxy_url) = &req.proxy_url {
            if !proxy_url.trim().is_empty() {
                let proxy = reqwest::Proxy::all(proxy_url).map_err(|e| format!("Invalid proxy URL: {e}"))?;
                builder = builder.proxy(proxy);
            }
        }

        let client = builder.build().map_err(|e| e.to_string())?;

        let method = reqwest::Method::from_bytes(req.method.as_bytes()).map_err(|e| e.to_string())?;
        let mut request_builder = client.request(method, &req.url);
        for (key, value) in &req.headers {
            request_builder = request_builder.header(key, value);
        }
        if let Some(fields) = req.multipart {
            request_builder = request_builder.multipart(build_multipart_form(fields)?);
        } else if let Some(body) = req.body {
            request_builder = request_builder.body(body);
        }

        let response = request_builder.send().map_err(|e| e.to_string())?;
        let status = response.status().as_u16();
        let status_text = response.status().canonical_reason().unwrap_or("").to_string();
        let final_url = response.url().to_string();
        let headers = response
            .headers()
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
            .collect();
        let body = response.bytes().map_err(|e| e.to_string())?.to_vec();

        Ok(MtlsResponse {
            status,
            status_text,
            headers,
            body,
            final_url,
        })
    })
    .await
    .map_err(|e| format!("mTLS request task failed: {e}"))?
}
