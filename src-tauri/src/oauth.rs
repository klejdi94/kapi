use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tiny_http::{Header, Response, Server};

const CALLBACK_HTML: &str = "<html><body style=\"font-family:-apple-system,sans-serif;padding:48px;color:#333\">\
Signed in — you can close this tab and go back to kapi.</body></html>";

/// Lets a pending `kapi_oauth_listen` be cancelled from the UI (closing the
/// "waiting for the browser" dialog) instead of tying up the loopback port
/// for the rest of its timeout.
#[derive(Default)]
pub struct OAuthListenState(pub Mutex<Option<Arc<AtomicBool>>>);

/// Binds the fixed OAuth loopback port and waits for exactly one redirect to
/// `/callback`, returning its raw query string (`code=...&state=...`, or
/// `error=...` if the user denied consent). Used for the Authorization Code
/// + PKCE grant: the system browser sends the IdP's redirect here once the
/// user finishes signing in there.
///
/// Runs inside `spawn_blocking` — like the Claude CLI calls, this blocks for
/// real time (up to two minutes for a human to finish an SSO login), and a
/// synchronous `#[tauri::command]` would freeze the whole window for that.
#[tauri::command]
pub async fn kapi_oauth_listen(state: tauri::State<'_, OAuthListenState>, port: u16) -> Result<String, String> {
    let cancel_flag = Arc::new(AtomicBool::new(false));
    *state.0.lock().map_err(|e| e.to_string())? = Some(cancel_flag.clone());

    let result = tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let server = Server::http(("127.0.0.1", port))
            .map_err(|e| format!("Could not listen on 127.0.0.1:{port} ({e}) — is another kapi window already waiting?"))?;

        let deadline = Instant::now() + Duration::from_secs(120);
        loop {
            if cancel_flag.load(Ordering::Relaxed) {
                return Err("Cancelled.".into());
            }
            if Instant::now() > deadline {
                return Err("Timed out waiting for the browser redirect — try again.".into());
            }
            match server.recv_timeout(Duration::from_millis(300)) {
                Ok(Some(request)) => {
                    let url = request.url().to_string();
                    let query = url.split_once('?').map(|(_, q)| q).unwrap_or("").to_string();
                    let mut response = Response::from_string(CALLBACK_HTML);
                    if let Ok(header) = Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]) {
                        response = response.with_header(header);
                    }
                    let _ = request.respond(response);
                    return Ok(query);
                }
                Ok(None) => continue,
                Err(e) => return Err(e.to_string()),
            }
        }
    })
    .await
    .map_err(|e| format!("OAuth listener task failed: {e}"))?;

    *state.0.lock().map_err(|e| e.to_string())? = None;
    result
}

/// Releases a pending `kapi_oauth_listen` immediately rather than waiting out its timeout.
#[tauri::command]
pub fn kapi_oauth_cancel(state: tauri::State<'_, OAuthListenState>) -> Result<(), String> {
    if let Some(flag) = state.0.lock().map_err(|e| e.to_string())?.as_ref() {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}
