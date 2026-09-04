use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use tauri::{AppHandle, Emitter, State};
use tiny_http::{Header, Response, Server};

#[derive(Debug, Clone, Deserialize)]
pub struct MockHeader {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MockRoute {
    pub method: String,
    /// `/users/:id` — `:segments` match anything and aren't otherwise validated.
    pub path: String,
    pub status: u16,
    pub headers: Vec<MockHeader>,
    pub body: String,
    pub delay_ms: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MockConfig {
    /// 0 asks the OS for any free port.
    pub port: u16,
    pub routes: Vec<MockRoute>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MockHit {
    pub method: String,
    pub path: String,
    pub status: u16,
    pub matched: bool,
    pub at: u64,
}

pub(crate) struct RunningServer {
    handle: JoinHandle<()>,
    stop_flag: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct MockState(pub Mutex<Option<RunningServer>>);

fn path_matches(pattern: &str, actual: &str) -> bool {
    let pat: Vec<&str> = pattern.trim_matches('/').split('/').filter(|s| !s.is_empty()).collect();
    let act: Vec<&str> = actual.trim_matches('/').split('/').filter(|s| !s.is_empty()).collect();
    if pat.len() != act.len() {
        return false;
    }
    pat.iter().zip(act.iter()).all(|(p, a)| p.starts_with(':') || *p == *a)
}

fn find_route<'a>(routes: &'a [MockRoute], method: &str, path: &str) -> Option<&'a MockRoute> {
    routes
        .iter()
        .find(|r| r.method.eq_ignore_ascii_case(method) && path_matches(&r.path, path))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn kapi_mock_start(app: AppHandle, state: State<MockState>, config: MockConfig) -> Result<u16, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Err("A mock server is already running. Stop it first.".into());
    }

    let server = Server::http(("127.0.0.1", config.port)).map_err(|e| e.to_string())?;
    let actual_port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(config.port);

    let stop_flag = Arc::new(AtomicBool::new(false));
    let thread_stop_flag = stop_flag.clone();
    let routes = config.routes;

    let handle = std::thread::spawn(move || {
        // recv_timeout lets the loop check the stop flag periodically instead
        // of blocking forever on a request that may never arrive.
        loop {
            if thread_stop_flag.load(Ordering::Relaxed) {
                break;
            }
            match server.recv_timeout(std::time::Duration::from_millis(300)) {
                Ok(Some(request)) => {
                    let method = request.method().to_string();
                    let path = request.url().split('?').next().unwrap_or("").to_string();
                    let route = find_route(&routes, &method, &path);

                    let (status, hit) = match route {
                        Some(r) => {
                            if r.delay_ms > 0 {
                                std::thread::sleep(std::time::Duration::from_millis(r.delay_ms));
                            }
                            (r.status, true)
                        }
                        None => (404, false),
                    };

                    let body = match route {
                        Some(r) => r.body.clone(),
                        None => format!("{{\"error\":\"No mock route matches {method} {path}\"}}"),
                    };

                    let mut response = Response::from_string(body).with_status_code(status);
                    if let Some(r) = route {
                        for h in &r.headers {
                            if let Ok(header) = Header::from_bytes(h.key.as_bytes(), h.value.as_bytes()) {
                                response = response.with_header(header);
                            }
                        }
                    } else if let Ok(header) = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]) {
                        response = response.with_header(header);
                    }

                    let _ = request.respond(response);
                    let _ = app.emit(
                        "kapi://mock-hit",
                        MockHit { method, path, status, matched: hit, at: now_ms() },
                    );
                }
                Ok(None) => continue, // timed out waiting, loop to recheck stop_flag
                Err(_) => break,
            }
        }
    });

    *guard = Some(RunningServer { handle, stop_flag });
    Ok(actual_port)
}

#[tauri::command]
pub fn kapi_mock_stop(state: State<MockState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(running) = guard.take() {
        running.stop_flag.store(true, Ordering::Relaxed);
        // The server thread wakes from recv_timeout within ~300ms on its own;
        // joining here would block the UI thread, so let it finish naturally.
        drop(running.handle);
    }
    Ok(())
}

#[tauri::command]
pub fn kapi_mock_is_running(state: State<MockState>) -> Result<bool, String> {
    let guard = state.0.lock().map_err(|e| e.to_string())?;
    Ok(guard.is_some())
}
