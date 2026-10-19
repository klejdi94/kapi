fn main() {
    // Every command the app registers, listed explicitly so Tauri generates
    // per-command `allow-*`/`deny-*` permissions instead of leaving them
    // callable from any window by default — the discovery window loads
    // arbitrary third-party sites and must only ever reach the one capture
    // command it needs (see capabilities/discovery.json), never the
    // filesystem or shell commands the main window uses.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "kapi_write_text_file",
            "kapi_write_binary_file",
            "kapi_read_text_file",
            "kapi_path_exists",
            "kapi_mock_start",
            "kapi_mock_stop",
            "kapi_mock_is_running",
            "kapi_open_discovery",
            "kapi_discovery_report",
            "kapi_oauth_listen",
            "kapi_oauth_cancel",
            "kapi_send_mtls",
            "kapi_ai_list_available",
            "kapi_ai_prompt",
        ])),
    )
    .expect("failed to run tauri-build");
}
