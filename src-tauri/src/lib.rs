use std::fs;
use std::path::Path;

mod ai_cli;
mod appmenu;
mod discovery;
mod mock;
mod mtls;
mod oauth;
mod secrets;
use ai_cli::{kapi_ai_list_available, kapi_ai_prompt};
use discovery::{kapi_discovery_report, kapi_open_discovery};
use mock::{kapi_mock_is_running, kapi_mock_start, kapi_mock_stop, MockState};
use mtls::kapi_send_mtls;
use oauth::{kapi_oauth_cancel, kapi_oauth_listen, OAuthListenState};
use secrets::kapi_secrets_key;

/// Writes `contents` to `target` so a crash, power cut or full disk can never
/// leave a half-written file behind: the bytes go to a sibling temp file,
/// are flushed to disk, and only then renamed over the target (an atomic
/// replace on the same filesystem, on every OS kapi ships for). With
/// `backup`, the previous version is kept as `<name>.bak` first — kapi's own
/// data files use that, so a bad write (or a bad version of kapi) is one
/// rename away from undone.
fn write_atomic(target: &Path, contents: &[u8], backup: bool) -> std::io::Result<()> {
    use std::io::Write;
    let parent = target.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let file_name = target.file_name().and_then(|n| n.to_str()).unwrap_or("kapi");
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let tmp = parent.join(format!(".{file_name}.{}-{nanos}.tmp", std::process::id()));

    let result = (|| {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(contents)?;
        file.sync_all()?;
        drop(file);
        if backup && target.exists() {
            let bak = parent.join(format!("{file_name}.bak"));
            fs::copy(target, &bak)?;
        }
        fs::rename(&tmp, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// Reads and writes files directly, rather than through the fs plugin's ACL
/// scope: the path always comes either from kapi's own app-data directory or
/// from the OS's native folder/save picker, so it's already at the trust level
/// the user granted by choosing it — the same trust a file dialog gives any
/// desktop app.
#[tauri::command]
fn kapi_write_text_file(path: String, contents: String, backup: Option<bool>) -> Result<(), String> {
    write_atomic(Path::new(&path), contents.as_bytes(), backup.unwrap_or(false)).map_err(|e| e.to_string())
}

/// Same trust rationale as the text writer — used to save response bodies and
/// exports, which are bytes rather than a string (images, PDFs, archives).
#[tauri::command]
fn kapi_write_binary_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    write_atomic(Path::new(&path), &contents, false).map_err(|e| e.to_string())
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
      kapi_ai_prompt,
      kapi_secrets_key
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
mod write_tests {
    use super::write_atomic;
    use std::fs;

    fn scratch() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("kapi-write-test-{}-{:?}", std::process::id(), std::thread::current().id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn replaces_and_keeps_a_backup() {
        let dir = scratch();
        let file = dir.join("kapi.workspaces.json");
        write_atomic(&file, b"one", true).unwrap();
        assert!(!dir.join("kapi.workspaces.json.bak").exists(), "nothing to back up on first write");
        write_atomic(&file, b"two", true).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "two");
        assert_eq!(fs::read_to_string(dir.join("kapi.workspaces.json.bak")).unwrap(), "one");
        let leftovers: Vec<_> = fs::read_dir(&dir).unwrap().filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().ends_with(".tmp")).collect();
        assert!(leftovers.is_empty(), "temp files are cleaned up");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn creates_missing_directories_and_skips_backup_when_asked() {
        let dir = scratch();
        let file = dir.join("nested/deeper/export.json");
        write_atomic(&file, b"a", false).unwrap();
        write_atomic(&file, b"b", false).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "b");
        assert!(!dir.join("nested/deeper/export.json.bak").exists());
        fs::remove_dir_all(dir).unwrap();
    }
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
