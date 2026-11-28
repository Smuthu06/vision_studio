//! Web mode: serves the UI that is embedded in the executable over plain HTTP,
//! so any browser can use Vision Studio. No files are read from disk.

use crate::projects::{FileError, ProjectDir};
use crate::ui_config::{SaveError, Store, MAX_BYTES};
use std::io::Read;
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Runtime};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

/// Start the server on a background thread. Returns an error message if the
/// address cannot be bound (e.g. the port is already in use).
pub fn serve<R: Runtime>(app: AppHandle<R>, host: &str, port: u16, store: Arc<Store>, projects: Arc<ProjectDir>) -> Result<(), String> {
    let addr = if host.contains(':') && !host.starts_with('[') { format!("[{host}]:{port}") } else { format!("{host}:{port}") };
    let server = Server::http(&addr).map_err(|e| format!("Could not start the web server on {addr}: {e}"))?;
    thread::Builder::new()
        .name("vision-studio-web".into())
        .spawn(move || {
            for request in server.incoming_requests() {
                let path = request.url().split('?').next().unwrap_or("").to_string();
                if path == "/api/ui-config" {
                    handle_ui_config(&store, request);
                } else if path == "/api/projects" || path.starts_with("/api/projects/") {
                    handle_projects(&projects, &path, request);
                } else {
                    handle(&app, request);
                }
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

/// Saving is allowed only from the PC running Vision Studio: loopback peer
/// address and a loopback Host header (guards against DNS rebinding).
pub fn is_local(peer_is_loopback: bool, host_header: Option<&str>) -> bool {
    let Some(host) = host_header else { return false };
    let name = if let Some(rest) = host.strip_prefix('[') {
        rest.split(']').next().unwrap_or("")
    } else {
        host.rsplit_once(':').map(|(h, _)| h).unwrap_or(host)
    };
    peer_is_loopback && matches!(name.to_ascii_lowercase().as_str(), "localhost" | "127.0.0.1" | "::1")
}

fn json_response(status: u16, body: &impl serde::Serialize) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_data(serde_json::to_vec(body).unwrap_or_default())
        .with_status_code(StatusCode(status))
        .with_header(header("Content-Type", "application/json"))
        .with_header(header("Cache-Control", "no-store"))
}

fn handle_ui_config(store: &Store, mut request: Request) {
    let peer_loopback = request.remote_addr().map(|a| a.ip().is_loopback()).unwrap_or(false);
    let host = request.headers().iter().find(|h| h.field.equiv("Host")).map(|h| h.value.as_str().to_string());
    let local = is_local(peer_loopback, host.as_deref());
    let response = match *request.method() {
        Method::Get | Method::Head => json_response(200, &store.load(local)),
        Method::Put => {
            // custom header → browsers must preflight cross-site requests, which we never approve
            let marked = request.headers().iter().any(|h| h.field.equiv("X-Vision-Studio"));
            if !local || !marked {
                json_response(403, &SaveError { kind: "forbidden".into(),
                    message: "Settings can only be changed on the PC running Vision Studio".into(), current: None })
            } else {
                let mut body = Vec::new();
                let read = request.as_reader().take(MAX_BYTES as u64 + 1024).read_to_end(&mut body);
                #[derive(serde::Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct Put { text: String, base_modified: Option<u64> }
                match read.ok().and_then(|_| serde_json::from_slice::<Put>(&body).ok()) {
                    None => json_response(400, &SaveError { kind: "invalid".into(), message: "Malformed request".into(), current: None }),
                    Some(p) => match store.save(&p.text, p.base_modified) {
                        Ok(f) => json_response(200, &f),
                        Err(e) => json_response(match e.kind.as_str() { "conflict" => 409, "invalid" => 400, _ => 500 }, &e),
                    },
                }
            }
        }
        _ => json_response(405, &SaveError { kind: "invalid".into(), message: "Method not allowed".into(), current: None }),
    };
    let _ = request.respond(response);
}

/// Percent-decode a URL path segment (file names may contain spaces etc.).
pub fn decode_segment(seg: &str) -> Option<String> {
    let b = seg.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// GET /api/projects                → folder listing (anyone who can open the editor)
/// GET /api/projects/<name>         → file text
/// PUT /api/projects/<name>?overwrite=1  {text}  → save (only this PC)
fn handle_projects(projects: &ProjectDir, path: &str, mut request: Request) {
    let peer_loopback = request.remote_addr().map(|a| a.ip().is_loopback()).unwrap_or(false);
    let host = request.headers().iter().find(|h| h.field.equiv("Host")).map(|h| h.value.as_str().to_string());
    let local = is_local(peer_loopback, host.as_deref());
    let err = |status: u16, e: FileError| json_response(status, &e);
    let status_of = |e: &FileError| match e.kind.as_str() { "exists" => 409, "invalid" => 400, "notFound" => 404, "forbidden" => 403, _ => 500 };
    let name = path.strip_prefix("/api/projects/").map(decode_segment);
    let overwrite = request.url().split_once('?').map(|(_, q)| q.split('&').any(|kv| kv == "overwrite=1")).unwrap_or(false);
    let response = match (request.method().clone(), name) {
        (Method::Get | Method::Head, None) => json_response(200, &projects.list(local)),
        (Method::Get | Method::Head, Some(Some(n))) => match projects.read(&n) {
            Ok(text) => Response::from_data(text.into_bytes())
                .with_header(header("Content-Type", "application/json; charset=utf-8"))
                .with_header(header("Cache-Control", "no-store")),
            Err(e) => err(status_of(&e), e),
        },
        (Method::Put, Some(Some(n))) => {
            let marked = request.headers().iter().any(|h| h.field.equiv("X-Vision-Studio"));
            if !local || !marked {
                err(403, FileError::new("forbidden", "Configurations can only be saved on the PC running Vision Studio"))
            } else {
                let mut body = Vec::new();
                let read = request.as_reader().take(crate::projects::MAX_BYTES as u64 + 1024).read_to_end(&mut body);
                #[derive(serde::Deserialize)]
                struct Put { text: String }
                match read.ok().and_then(|_| serde_json::from_slice::<Put>(&body).ok()) {
                    None => err(400, FileError::new("invalid", "Malformed request")),
                    Some(p) => match projects.save(&n, &p.text, overwrite) {
                        Ok(s) => json_response(200, &s),
                        Err(e) => err(status_of(&e), e),
                    },
                }
            }
        }
        (_, Some(None)) => err(400, FileError::new("invalid", "Malformed file name")),
        _ => err(405, FileError::new("invalid", "Method not allowed")),
    };
    let _ = request.respond(response);
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
    use super::{asset_path, decode_segment, is_local, names_file};

    #[test]
    fn decodes_file_names() {
        assert_eq!(decode_segment("Front%20Cam_v1.0.0.json").as_deref(), Some("Front Cam_v1.0.0.json"));
        assert_eq!(decode_segment("a%2F..%2Fb.json").as_deref(), Some("a/../b.json")); // rejected later by valid_name
        assert_eq!(decode_segment("bad%zz"), None);
    }

    #[test]
    fn only_this_pc_may_save() {
        assert!(is_local(true, Some("localhost:8080")));
        assert!(is_local(true, Some("127.0.0.1:8080")));
        assert!(is_local(true, Some("[::1]:8080")));
        assert!(!is_local(false, Some("localhost:8080")));      // another PC
        assert!(!is_local(true, Some("evil.example:8080")));    // DNS rebinding
        assert!(!is_local(true, None));
    }

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
