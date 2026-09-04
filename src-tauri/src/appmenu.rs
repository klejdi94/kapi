use tauri::{
    menu::{AboutMetadata, Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    App, Emitter, Runtime,
};

/// Every custom item just emits its id to the frontend on `kapi://menu`, where
/// the same handlers already wired to keyboard shortcuts run — the menu is a
/// second way to reach them, not a second implementation of them.
pub fn build<R: Runtime>(app: &App<R>) -> tauri::Result<Menu<R>> {
    let app_menu = SubmenuBuilder::new(app, "kapi")
        .item(&PredefinedMenuItem::about(
            app,
            Some("About kapi"),
            Some(AboutMetadata {
                name: Some("kapi".into()),
                version: Some(env!("CARGO_PKG_VERSION").into()),
                ..Default::default()
            }),
        )?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&MenuItemBuilder::with_id("new-tab", "New Request Tab").accelerator("CmdOrCtrl+T").build(app)?)
        .item(&MenuItemBuilder::with_id("new-ws-tab", "New WebSocket Tab").build(app)?)
        .item(&MenuItemBuilder::with_id("close-tab", "Close Tab").accelerator("CmdOrCtrl+W").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("save", "Save").accelerator("CmdOrCtrl+S").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("import", "Import…").build(app)?)
        .item(&MenuItemBuilder::with_id("export-workspace", "Export Workspace…").build(app)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&MenuItemBuilder::with_id("toggle-sidebar", "Toggle Sidebar").accelerator("CmdOrCtrl+\\").build(app)?)
        .item(&MenuItemBuilder::with_id("toggle-console", "Toggle Console").accelerator("CmdOrCtrl+`").build(app)?)
        .item(&MenuItemBuilder::with_id("command-palette", "Command Palette…").accelerator("CmdOrCtrl+K").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("toggle-theme", "Toggle Dark / Light Theme").build(app)?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("view-source", "kapi on GitHub").build(app)?)
        .build()?;

    Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu, &help_menu])
}

pub fn handle_event<R: Runtime>(app: &tauri::AppHandle<R>, event_id: &str) {
    let _ = app.emit("kapi://menu", event_id);
}
