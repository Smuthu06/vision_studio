//! `ui_config.json`: the dropdown lists maintained in the Settings window.
//!
//! The native side only stores the file; the UI owns its meaning. Every save
//! is checked to be JSON, written atomically, and refused when the file
//! changed on disk since the caller loaded it (another user / editor), so a
//! shared file is never overwritten by accident.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

/// Largest file accepted (the lists are a few KB; this only guards the API).
pub const MAX_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UiConfigFile {
    /// Absolute path of the file (shown in the Settings window).
    pub path: String,
    /// File contents, or None when the file does not exist yet.
    pub text: Option<String>,
    /// Modification time in ms since the epoch (None = no file). Sent back on save.
    pub modified: Option<u64>,
    /// Whether this caller may save (web mode: only the PC running Vision Studio).
    pub can_save: bool,
    /// Read error or invalid JSON (with line and column).
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SaveError {
    /// "conflict" | "invalid" | "forbidden" | "io"
    pub kind: String,
    pub message: String,
    /// For conflicts: the file as it is on disk now.
    pub current: Option<Box<UiConfigFile>>, // boxed: keeps the Err variant small
}

impl SaveError {
    fn new(kind: &str, message: impl Into<String>) -> Self {
        SaveError { kind: kind.into(), message: message.into(), current: None }
    }
}

pub struct Store {
    path: PathBuf,
    lock: Mutex<()>,
}

fn mtime_ms(path: &Path) -> Option<u64> {
    let m = fs::metadata(path).ok()?.modified().ok()?;
    Some(m.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64)
}

fn json_error(name: &str, text: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(text)
        .err()
        .map(|e| format!("{name} is not valid JSON (line {}, column {}): {e}", e.line(), e.column()))
}

impl Store {
    pub fn new(path: PathBuf) -> Self {
        Store { path, lock: Mutex::new(()) }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn name(&self) -> String {
        self.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "ui_config.json".into())
    }

    pub fn load(&self, can_save: bool) -> UiConfigFile {
        let path = self.path.display().to_string();
        match fs::read_to_string(&self.path) {
            Ok(text) => {
                let text = text.trim_start_matches('\u{feff}').to_string();
                let error = json_error(&self.name(), &text);
                UiConfigFile { path, modified: mtime_ms(&self.path), text: Some(text), can_save, error }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                UiConfigFile { path, text: None, modified: None, can_save, error: None }
            }
            Err(e) => UiConfigFile {
                path, text: None, modified: mtime_ms(&self.path), can_save,
                error: Some(format!("Could not read {}: {e}", self.path.display())),
            },
        }
    }

    /// Save `text` if the file is still at `base_modified` (None = it did not exist).
    pub fn save(&self, text: &str, base_modified: Option<u64>) -> Result<UiConfigFile, SaveError> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        if text.len() > MAX_BYTES {
            return Err(SaveError::new("invalid", "The settings are too large to save"));
        }
        if let Some(msg) = json_error("The settings", text) {
            return Err(SaveError::new("invalid", msg));
        }
        let current = mtime_ms(&self.path);
        if current != base_modified {
            let mut err = SaveError::new("conflict", format!("{} was changed by someone else after you opened it", self.name()));
            err.current = Some(Box::new(self.load(true)));
            return Err(err);
        }
        let dir = self.path.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
        fs::create_dir_all(dir).map_err(|e| SaveError::new("io", format!("Could not create {}: {e}", dir.display())))?;
        let tmp = dir.join(format!(".{}.{}.tmp", self.name(), std::process::id()));
        let body = if text.ends_with('\n') { text.to_string() } else { format!("{text}\n") };
        fs::write(&tmp, body.as_bytes())
            .and_then(|_| fs::rename(&tmp, &self.path))
            .map_err(|e| {
                let _ = fs::remove_file(&tmp);
                SaveError::new("io", format!("Could not save {}: {e}", self.path.display()))
            })?;
        Ok(self.load(true))
    }
}

/// Resolve the `ui_config` setting: absolute paths as given, relative ones
/// against the folder of the INI file (or of the executable when there is none).
pub fn resolve(setting: &str, base_dir: &Path) -> PathBuf {
    let p = PathBuf::from(setting);
    if p.is_absolute() { p } else { base_dir.join(p) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store(name: &str) -> (Store, PathBuf) {
        let dir = std::env::temp_dir().join(format!("vs-uicfg-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let path = dir.join("ui_config.json");
        (Store::new(path.clone()), dir)
    }

    #[test]
    fn missing_file_then_create_then_conflict() {
        let (store, dir) = temp_store("flow");
        let f = store.load(true);
        assert_eq!((f.text.clone(), f.modified, f.error.clone()), (None, None, None));
        // create (base = None because the file did not exist)
        let saved = store.save("{\"imagers\":[\"IMX490\"]}", None).expect("create");
        assert!(saved.text.as_deref().unwrap().contains("IMX490"));
        assert!(saved.text.as_deref().unwrap().ends_with('\n'));
        // a second writer that still thinks the file is missing → conflict with the current file
        let err = store.save("{}", None).unwrap_err();
        assert_eq!(err.kind, "conflict");
        assert!(err.current.unwrap().text.unwrap().contains("IMX490"));
        // saving on top of the version we loaded works
        assert!(store.save("{\"imagers\":[]}", saved.modified).is_ok());
        assert!(fs::read_dir(&dir).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".tmp")));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn invalid_json_is_reported_and_never_written() {
        let (store, dir) = temp_store("invalid");
        fs::create_dir_all(&dir).unwrap();
        fs::write(store.path(), "{\n  \"imagers\": [\"A\",]\n}").unwrap();
        let f = store.load(true);
        let msg = f.error.expect("error");
        assert!(msg.contains("line 2"), "{msg}");
        let err = store.save("{ not json", f.modified).unwrap_err();
        assert_eq!(err.kind, "invalid");
        assert!(fs::read_to_string(store.path()).unwrap().contains("\"A\","));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn resolves_relative_to_the_ini_folder() {
        let base = Path::new("/opt/vision");
        assert_eq!(resolve("ui_config.json", base), PathBuf::from("/opt/vision/ui_config.json"));
        assert_eq!(resolve("/srv/shared/ui.json", base), PathBuf::from("/srv/shared/ui.json"));
    }
}
