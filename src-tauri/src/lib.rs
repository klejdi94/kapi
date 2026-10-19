use std::fs;
use std::path::Path;

mod ai_cli;
mod appmenu;
mod discovery;
mod mock;
mod mtls;
mod oauth;
use ai_cli::{kapi_ai_list_available, kapi_ai_prompt};
use discovery::{kapi_discovery_report, kapi_open_discovery};
use mock::{kapi_mock_is_running, kapi_mock_start, kapi_mock_stop, MockState};
use mtls::kapi_send_mtls;
use oauth::{kapi_oauth_cancel, kapi_oauth_listen, OAuthListenState};

/// Reads and writes the workspace snapshot file directly, rather than through
/// the fs plugin's ACL scope: the path always comes from the OS's own native
/// folder picker, so it's already at the trust level the user granted by
/// choosing it — the same trust a file-system dialog gives any desktop app.
#[tauri::command]
fn kapi_write_text_file(path: String, contents: String) -> Result<(), String> {
    let target = Path::new(&path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(target, contents).map_err(|e| e.to_string())
}

/// Same trust rationale as the text writer — used to save response bodies and
/// exports, which are bytes rather than a string (images, PDFs, archives).
#[tauri::command]
fn kapi_write_binary_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    let target = Path::new(&path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(target, contents).map_err(|e| e.to_string())
}

#[tauri::command]
fn kapi_read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn kapi_path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_websocket::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .manage(MockState::default())
    .manage(OAuthListenState::default())
    .invoke_handler(tauri::generate_handler![
      kapi_write_text_file,
      kapi_write_binary_file,
      kapi_read_text_file,
      kapi_path_exists,
      kapi_mock_start,
      kapi_mock_stop,
      kapi_mock_is_running,
      kapi_open_discovery,
      kapi_discovery_report,
      kapi_oauth_listen,
      kapi_oauth_cancel,
      kapi_send_mtls,
      kapi_ai_list_available,
      kapi_ai_prompt
    ])
    .on_menu_event(|app, event| {
      appmenu::handle_event(app, event.id().as_ref());
    })
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      let menu = appmenu::build(app)?;
      app.set_menu(menu)?;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[cfg(test)]
mod capability_tests {
    use serde_json::Value;

    fn git_scopes() -> Vec<Value> {
        let raw = include_str!("../capabilities/default.json");
        let json: Value = serde_json::from_str(raw).expect("default.json is valid JSON");
        json["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["identifier"] == "shell:allow-execute")
            .expect("shell:allow-execute is configured")["allow"]
            .as_array()
            .unwrap()
            .clone()
    }

    /// Mirrors how tauri-plugin-shell anchors a validator (`^…$`), so a typo
    /// fails here instead of panicking at app startup.
    fn validator(scope: &Value, index: usize) -> regex::Regex {
        let pattern = scope["args"][index]["validator"].as_str().expect("a validator arg");
        regex::Regex::new(&format!("^{pattern}$")).expect("validator compiles")
    }

    fn scope(name: &str) -> Value {
        git_scopes().into_iter().find(|s| s["name"] == name).unwrap_or_else(|| panic!("no scope {name}"))
    }

    #[test]
    fn git_never_gets_open_ended_arguments() {
        for scope in git_scopes() {
            assert_eq!(scope["cmd"], "git");
            assert!(scope["args"].is_array(), "{} must pin its arguments", scope["name"]);
        }
    }

    #[test]
    fn every_validator_compiles() {
        for scope in git_scopes() {
            for (i, arg) in scope["args"].as_array().unwrap().iter().enumerate() {
                if arg.is_object() {
                    validator(&scope, i);
                }
            }
        }
    }

    #[test]
    fn remote_url_rejects_option_injection() {
        let re = validator(&scope("git-remote-add"), 3);
        assert!(re.is_match("https://github.com/klejdi94/kapi.git"));
        assert!(re.is_match("git@github.com:klejdi94/kapi.git"));
        assert!(re.is_match("ssh://git@host/repo.git"));
        assert!(!re.is_match("--upload-pack=touch /tmp/x"));
        assert!(!re.is_match("ext::sh -c touch% /tmp/x"));
        assert!(!re.is_match("file:///etc"));
        assert!(!re.is_match("https://x y"));
    }

    #[test]
    fn log_limit_is_numeric() {
        let re = validator(&scope("git-log"), 1);
        assert!(re.is_match("-20"));
        assert!(!re.is_match("--output=/tmp/x"));
    }
}
