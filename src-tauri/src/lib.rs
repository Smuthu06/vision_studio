//! Native shell for Vision Studio. All editor logic lives in the shared web UI.
//!
//! The INI file next to the executable decides how the app runs (see config.rs):
//!   mode = desktop  → the editor opens in its own window (native file dialogs)
//!   mode = web      → the embedded UI is served over HTTP and opened in the browser;
//!                     a tray icon offers "Open in browser" and "Quit".

mod config;
mod web;

use config::{Config, Mode, MIN_HEIGHT, MIN_WIDTH};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{App, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(move |app| {
            let mut extra = Vec::new();
            if let Ok(d) = app.path().app_config_dir() { extra.push(d); }
            if let Ok(d) = app.path().resource_dir() { extra.push(d); }
            let cfg = config::load(&args, &extra);
            match &cfg.source {
                Some(p) => eprintln!("Vision Studio: using {}", p.display()),
                None => eprintln!("Vision Studio: no INI file found, using defaults"),
            }
            match cfg.mode {
                Mode::Desktop => open_desktop_window(app, &cfg)?,
                Mode::Web => start_web_mode(app, &cfg)?,
            }
            if !cfg.warnings.is_empty() {
                let file = cfg.source.as_ref().map(|p| p.display().to_string()).unwrap_or_else(|| "the command line".into());
                app.dialog()
                    .message(format!("Some settings in {file} were ignored:\n\n• {}", cfg.warnings.join("\n• ")))
                    .title("Vision Studio configuration")
                    .kind(MessageDialogKind::Warning)
                    .show(|_| {});
            }
            app.manage(cfg);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Vision Studio");

    app.run(|handle, event| {
        // Web mode has no window: keep running until "Quit" is chosen in the tray.
        if let RunEvent::ExitRequested { api, code, .. } = event {
            let web = handle.try_state::<Config>().map(|c| c.mode == Mode::Web).unwrap_or(false);
            if web && code.is_none() {
                api.prevent_exit();
            }
        }
    });
}

fn open_desktop_window(app: &mut App, cfg: &Config) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Vision Studio")
        .inner_size(cfg.width, cfg.height)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .center()
        .maximized(cfg.maximized)
        .disable_drag_drop_handler() // let the page handle dropped JSON files
        .build()?;
    Ok(())
}

fn start_web_mode(app: &mut App, cfg: &Config) -> tauri::Result<()> {
    let url = cfg.url();
    if let Err(msg) = web::serve(app.handle().clone(), &cfg.host, cfg.port) {
        let handle = app.handle().clone();
        app.dialog()
            .message(format!("{msg}\n\nChange [web] port in the INI file (or close the program using it) and start Vision Studio again."))
            .title("Vision Studio – web mode")
            .kind(MessageDialogKind::Error)
            .show(move |_| handle.exit(1));
        return Ok(());
    }
    eprintln!("Vision Studio: web mode on {url}");

    let open_item = MenuItem::with_id(app, "open", "Open Vision Studio in browser", true, None::<&str>)?;
    let addr_item = MenuItem::with_id(app, "addr", format!("Serving {url}"), false, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Vision Studio", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&addr_item, &open_item, &PredefinedMenuItem::separator(app)?, &quit_item])?;
    let tray_url = url.clone();
    let mut tray = TrayIconBuilder::with_id("vision-studio")
        .tooltip(format!("Vision Studio – web mode – {url}"))
        .menu(&menu)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open" => { let _ = open::that_detached(&tray_url); }
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    if let Err(e) = tray.build(app) {
        // e.g. a Linux desktop without a status tray: the server keeps running
        eprintln!("Vision Studio: tray icon unavailable ({e}); stop the program to quit web mode");
    }

    if cfg.open_browser {
        if let Err(e) = open::that_detached(&url) {
            eprintln!("Vision Studio: could not open a browser ({e}); open {url} manually");
        }
    }
    Ok(())
}
