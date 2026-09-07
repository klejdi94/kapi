use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// One HTTP call captured while the user browses inside the discovery
/// window. Sensitive header values are already redacted by the capture
/// script before this ever reaches Rust — see `CAPTURE_SCRIPT` below.
#[derive(Serialize, Deserialize, Clone)]
pub struct CapturedCall {
    pub method: String,
    pub url: String,
    pub status: Option<u16>,
    #[serde(rename = "requestHeaders")]
    pub request_headers: Vec<(String, String)>,
    #[serde(rename = "responseContentType")]
    pub response_content_type: String,
    pub at: f64,
}

/// Opens (or refocuses, after a fresh navigation) a window that loads the
/// user-given site directly — real cookies, real login session — and quietly
/// watches its network traffic via `CAPTURE_SCRIPT`. That window's IPC access
/// is deliberately the narrowest in the app: see `capabilities/discovery.json`,
/// which grants it exactly one command (`kapi_discovery_report`) and nothing
/// that touches the filesystem, shell or Claude CLI, no matter what the
/// visited site's own JavaScript tries to call.
#[tauri::command]
pub fn kapi_open_discovery(app: AppHandle, url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Only http:// and https:// URLs can be opened here.".into());
    }
    let target: tauri::Url = url.parse().map_err(|_| "That doesn't look like a valid URL.".to_string())?;

    // Re-navigating in place (rather than reusing the existing webview) keeps
    // capture state from a previous run from bleeding into a new one.
    if let Some(existing) = app.get_webview_window("kapi-discovery") {
        existing.close().map_err(|e| e.to_string())?;
    }

    WebviewWindowBuilder::new(&app, "kapi-discovery", WebviewUrl::External(target))
        .title("kapi — Discovery (capturing)")
        .inner_size(1180.0, 820.0)
        .initialization_script(CAPTURE_SCRIPT)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Forwarded straight to the main window as an event; the discovery UI there
/// is already listening (`kapi://discovery-capture`) and does the
/// deduplication/grouping in TypeScript rather than here.
#[tauri::command]
pub fn kapi_discovery_report(app: AppHandle, entries: Vec<CapturedCall>) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        main.emit("kapi://discovery-capture", entries).map_err(|e| e.to_string())?;
    }
    Ok(())
}

const CAPTURE_SCRIPT: &str = r#"(function () {
  if (window.__kapiDiscoveryInstalled) return;
  window.__kapiDiscoveryInstalled = true;

  var SENSITIVE = ['authorization', 'cookie', 'x-api-key', 'x-auth-token', 'x-csrf-token', 'proxy-authorization'];
  function sanitize(pairs) {
    return pairs.map(function (pair) {
      var redacted = SENSITIVE.indexOf(pair[0].toLowerCase()) !== -1;
      return [pair[0], redacted ? '<redacted>' : pair[1]];
    });
  }
  function absolute(url) {
    try { return new URL(url, location.href).href; } catch (e) { return String(url); }
  }

  var buffer = [];
  function push(entry) { buffer.push(entry); }
  function flush() {
    if (!buffer.length) return;
    var batch = buffer.splice(0, buffer.length);
    try {
      window.__TAURI_INTERNALS__.invoke('kapi_discovery_report', { entries: batch });
    } catch (e) { /* best effort — a page without our bridge just isn't captured */ }
  }
  setInterval(flush, 700);
  window.addEventListener('pagehide', flush);

  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      var method = (init && init.method) || (input && input.method) || 'GET';
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      var headers = [];
      try {
        new Headers((init && init.headers) || (input && input.headers) || undefined).forEach(function (v, k) { headers.push([k, v]); });
      } catch (e) {}
      var at = Date.now();
      return origFetch.apply(this, arguments).then(function (res) {
        try {
          push({ method: method.toUpperCase(), url: absolute(url), status: res.status, requestHeaders: sanitize(headers), responseContentType: res.headers.get('content-type') || '', at: at });
        } catch (e) {}
        return res;
      }, function (err) {
        try { push({ method: method.toUpperCase(), url: absolute(url), status: null, requestHeaders: sanitize(headers), responseContentType: '', at: at }); } catch (e) {}
        throw err;
      });
    };
  }

  var Orig = window.XMLHttpRequest;
  if (Orig) {
    var origOpen = Orig.prototype.open;
    var origSend = Orig.prototype.send;
    var origSetHeader = Orig.prototype.setRequestHeader;
    Orig.prototype.open = function (method, url) {
      this.__kapi = { method: String(method || 'GET').toUpperCase(), url: url, headers: [] };
      return origOpen.apply(this, arguments);
    };
    Orig.prototype.setRequestHeader = function (name, value) {
      if (this.__kapi) this.__kapi.headers.push([name, value]);
      return origSetHeader.apply(this, arguments);
    };
    Orig.prototype.send = function () {
      var info = this.__kapi;
      var self = this;
      if (info) {
        var at = Date.now();
        this.addEventListener('loadend', function () {
          try {
            push({ method: info.method, url: absolute(info.url), status: self.status || null, requestHeaders: sanitize(info.headers), responseContentType: self.getResponseHeader('content-type') || '', at: at });
          } catch (e) {}
        });
      }
      return origSend.apply(this, arguments);
    };
  }
})();"#;
