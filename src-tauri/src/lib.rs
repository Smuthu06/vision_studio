//! Desktop shell for Vision Studio. All editor logic lives in the shared web UI;
//! the native side only provides file dialogs and file-system access.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running Vision Studio");
}
