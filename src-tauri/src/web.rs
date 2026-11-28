//! Web mode: serves the UI that is embedded in the executable over plain HTTP,
//! so any browser can use Vision Studio. No files are read from disk.

use std::thread;
use tauri::{AppHandle, Runtime};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

/// Start the server on a background thread. Returns an error message if the
/// address cannot be bound (e.g. the port is already in use).
pub fn serve<R: Runtime>(app: AppHandle<R>, host: &str, port: u16) -> Result<(), String> {
    let addr = if host.contains(':') && !host.starts_with('[') { format!("[{host}]:{port}") } else { format!("{host}:{port}") };
    let server = Server::http(&addr).map_err(|e| format!("Could not start the web server on {addr}: {e}"))?;
    thread::Builder::new()
        .name("vision-studio-web".into())
        .spawn(move || {
            for request in server.incoming_requests() {
                handle(&app, request);
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("valid header")
}

/// Map a request path to an embedded asset path ("/" → "index.html").
pub fn asset_path(url: &str) -> Option<String> {
    let path = url.split(['?', '#']).next().unwrap_or("/");
    let path = path.trim_start_matches('/');
    if path.split('/').any(|seg| seg == "..") {
        return None;
    }
    Some(if path.is_empty() { "index.html".to_string() } else { path.to_string() })
}

fn handle<R: Runtime>(app: &AppHandle<R>, request: Request) {
    let method = request.method().clone();
    if method != Method::Get && method != Method::Head {
        let _ = request.respond(Response::from_string("Method not allowed").with_status_code(StatusCode(405)));
        return;
    }
    let Some(path) = asset_path(request.url()) else {
        let _ = request.respond(Response::from_string("Bad request").with_status_code(StatusCode(400)));
        return;
    };
    let resolver = app.asset_resolver();
    // Tauri's resolver falls back to index.html for unknown paths. That is right for
    // client-side routes, but a missing *file* (it has an extension) must be a 404.
    let shell = resolver.get("index.html".into()).map(|a| a.bytes);
    let asset = resolver.get(path.clone())
        .filter(|a| !(names_file(&path) && shell.as_deref() == Some(a.bytes.as_slice())));
    let response = match asset {
        Some(asset) => {
            let cache = if path.ends_with(".html") || path == "index.html" { "no-cache" } else { "public, max-age=3600" };
            let mut r = Response::from_data(if method == Method::Head { Vec::new() } else { asset.bytes })
                .with_header(header("Content-Type", &asset.mime_type))
                .with_header(header("Cache-Control", cache))
                .with_header(header("X-Content-Type-Options", "nosniff"));
            if let Some(csp) = asset.csp_header {
                r = r.with_header(header("Content-Security-Policy", &csp));
            }
            r
        }
        None => Response::from_string("Not found").with_status_code(StatusCode(404)),
    };
    let _ = request.respond(response);
}

/// True when `path` names a file (has an extension) other than the app shell itself.
pub fn names_file(path: &str) -> bool {
    let last = path.rsplit('/').next().unwrap_or("");
    last.contains('.') && path != "index.html"
}

#[cfg(test)]
mod tests {
    use super::{asset_path, names_file};

    #[test]
    fn distinguishes_files_from_client_routes() {
        assert!(names_file("missing.png"));
        assert!(names_file("assets/app.js"));
        assert!(!names_file("index.html"));
        assert!(!names_file("settings")); // client-side route → app shell is fine
    }

    #[test]
    fn maps_paths_safely() {
        assert_eq!(asset_path("/").as_deref(), Some("index.html"));
        assert_eq!(asset_path("/?x=1").as_deref(), Some("index.html"));
        assert_eq!(asset_path("/assets/index-abc.js").as_deref(), Some("assets/index-abc.js"));
        assert_eq!(asset_path("/../secret.txt"), None);
        assert_eq!(asset_path("/assets/../../x"), None);
    }
}
