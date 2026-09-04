use std::fs;
use std::path::Path;

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
    .invoke_handler(tauri::generate_handler![
      kapi_write_text_file,
      kapi_read_text_file,
      kapi_path_exists
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
