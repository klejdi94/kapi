use std::fs;
use std::path::Path;

mod appmenu;
mod claude_cli;
mod mock;
use claude_cli::{kapi_claude_available, kapi_claude_prompt};
use mock::{kapi_mock_is_running, kapi_mock_start, kapi_mock_stop, MockState};

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
    .manage(MockState::default())
    .invoke_handler(tauri::generate_handler![
      kapi_write_text_file,
      kapi_write_binary_file,
      kapi_read_text_file,
      kapi_path_exists,
      kapi_mock_start,
      kapi_mock_stop,
      kapi_mock_is_running,
      kapi_claude_prompt,
      kapi_claude_available
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
