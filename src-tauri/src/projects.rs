//! The bench folders Vision Studio works with (all set in the INI):
//!
//! | kind         | INI key          | files     | written by Vision Studio |
//! |--------------|------------------|-----------|--------------------------|
//! | `project`    | `project_dir`    | `*.json`  | yes – `<project>_v<version>.json` |
//! | `tester`     | `tester_dir`     | `*.json`  | yes – `<tester>_v<version>.json`  |
//! | `bitfile`    | `bitfile_dir`    | `*.lvbitx`| no (listed for the Bit File dropdown) |
//! | `datalogger` | `datalogger_dir` | `*.json`  | no (listed for the Datalogger dropdown) |
//! | `i2c`        | `i2c_dir`        | `*.txt`   | no (listed for the I2C Initialisation File dropdown) |
//!
//! Only plain file names inside a folder are accepted, so the API can never
//! read or write anywhere else. Writes are atomic, and an existing file is
//! replaced only when the caller says so (after asking the user).

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

pub const MAX_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub modified: Option<u64>,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    /// Absolute folder path (shown in the UI).
    pub dir: String,
    /// Configurations in the folder, newest first.
    pub files: Vec<Entry>,
    /// Whether this caller may save (web mode: only the PC running Vision Studio).
    pub can_save: bool,
    /// Folder could not be read (it does not exist yet → empty list, no error).
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub name: String,
    pub path: String,
    pub modified: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileError {
    /// "exists" | "invalid" | "forbidden" | "notFound" | "io"
    pub kind: String,
    pub message: String,
}

impl FileError {
    pub fn new(kind: &str, message: impl Into<String>) -> Self {
        FileError { kind: kind.into(), message: message.into() }
    }
}

pub struct ProjectDir {
    dir: PathBuf,
    ext: &'static str,
    writable: bool,
    lock: Mutex<()>,
}

/// All folders by kind (see the module docs).
pub struct Folders {
    pub project: ProjectDir,
    pub tester: ProjectDir,
    pub bitfile: ProjectDir,
    pub datalogger: ProjectDir,
    pub i2c: ProjectDir,
}

impl Folders {
    pub fn get(&self, kind: &str) -> Result<&ProjectDir, FileError> {
        match kind {
            "project" => Ok(&self.project),
            "tester" => Ok(&self.tester),
            "bitfile" => Ok(&self.bitfile),
            "datalogger" => Ok(&self.datalogger),
            "i2c" => Ok(&self.i2c),
            _ => Err(FileError::new("invalid", format!("Unknown folder '{kind}'"))),
        }
    }
}

fn mtime_ms(path: &Path) -> Option<u64> {
    let m = fs::metadata(path).ok()?.modified().ok()?;
    Some(m.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64)
}

/// A plain `*.json` file name: no folders, no `..`, no characters Windows rejects.
#[cfg(test)]
pub fn valid_name(name: &str) -> bool {
    valid_name_ext(name, ".json")
}

/// A plain file name with extension `ext` (lower case, with the dot).
pub fn valid_name_ext(name: &str, ext: &str) -> bool {
    let bad = |c: char| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control();
    !name.is_empty()
        && name.len() <= 200
        && name.to_ascii_lowercase().ends_with(ext)
        && name.len() > ext.len()
        && !name.starts_with('.')
        && !name.chars().any(bad)
        && !name.ends_with(' ')
}

/// Remove `.` and `..` components lexically so the folder shows as e.g.
/// `C:\bench\configurations\project_configuration` rather than `…\bin\..\..\…`.
fn normalize(p: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() { out.push(".."); }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

impl ProjectDir {
    /// A folder of JSON configurations that Vision Studio saves into.
    pub fn new(dir: PathBuf) -> Self {
        ProjectDir { dir: normalize(&dir), ext: ".json", writable: true, lock: Mutex::new(()) }
    }

    /// A folder that is only listed (bit files, datalogger configurations).
    pub fn read_only(dir: PathBuf, ext: &'static str) -> Self {
        ProjectDir { dir: normalize(&dir), ext, writable: false, lock: Mutex::new(()) }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn file(&self, name: &str) -> Result<PathBuf, FileError> {
        if valid_name_ext(name, self.ext) { Ok(self.dir.join(name)) } else { Err(FileError::new("invalid", format!("'{name}' is not a valid file name"))) }
    }

    pub fn list(&self, can_save: bool) -> Listing {
        let dir = self.dir.display().to_string();
        let mut files = Vec::new();
        let error = match fs::read_dir(&self.dir) {
            Ok(rd) => {
                for e in rd.flatten() {
                    let name = e.file_name().to_string_lossy().into_owned();
                    let Ok(meta) = e.metadata() else { continue };
                    if meta.is_file() && valid_name_ext(&name, self.ext) {
                        files.push(Entry { modified: mtime_ms(&e.path()), size: meta.len(), name });
                    }
                }
                None
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => Some(format!("Could not read {dir}: {e}")),
        };
        files.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.name.cmp(&b.name)));
        Listing { dir, files, can_save: can_save && self.writable, error }
    }

    pub fn read(&self, name: &str) -> Result<String, FileError> {
        let path = self.file(name)?;
        fs::read_to_string(&path)
            .map(|t| t.trim_start_matches('\u{feff}').to_string())
            .map_err(|e| if e.kind() == std::io::ErrorKind::NotFound {
                FileError::new("notFound", format!("{name} is no longer in {}", self.dir.display()))
            } else {
                FileError::new("io", format!("Could not read {}: {e}", path.display()))
            })
    }

    /// Write `name`. Fails with kind "exists" if the file is there and `overwrite` is false.
    pub fn save(&self, name: &str, text: &str, overwrite: bool) -> Result<Saved, FileError> {
        let _guard = self.lock.lock().unwrap_or_else(|p| p.into_inner());
        if !self.writable {
            return Err(FileError::new("forbidden", format!("{} is read-only for Vision Studio", self.dir.display())));
        }
        let path = self.file(name)?;
        if text.len() > MAX_BYTES {
            return Err(FileError::new("invalid", "The configuration is too large to save"));
        }
        if let Err(e) = serde_json::from_str::<serde_json::Value>(text) {
            return Err(FileError::new("invalid", format!("Not valid JSON: {e}")));
        }
        if !overwrite && path.exists() {
            return Err(FileError::new("exists", format!("{name} already exists in {}", self.dir.display())));
        }
        fs::create_dir_all(&self.dir).map_err(|e| FileError::new("io", format!("Could not create {}: {e}", self.dir.display())))?;
        let tmp = self.dir.join(format!(".{name}.{}.tmp", std::process::id()));
        let body = if text.ends_with('\n') { text.to_string() } else { format!("{text}\n") };
        fs::write(&tmp, body.as_bytes()).and_then(|_| fs::rename(&tmp, &path)).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            FileError::new("io", format!("Could not save {}: {e}", path.display()))
        })?;
        Ok(Saved { name: name.to_string(), path: path.display().to_string(), modified: mtime_ms(&path) })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> (ProjectDir, PathBuf) {
        let base = std::env::temp_dir().join(format!("vs-proj-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let dir = base.join("bin/x/../../configurations/project_configuration");
        (ProjectDir::new(dir), base)
    }

    #[test]
    fn read_only_folders_list_their_extension_and_refuse_writes() {
        let (_, base) = temp("ro");
        let dir = base.join("fpga_bitfile");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("FPGA_8IN_NI1486_capture_v10.0.0.lvbitx"), "x").unwrap();
        fs::write(dir.join("notes.json"), "{}").unwrap();
        let f = ProjectDir::read_only(dir, ".lvbitx");
        let l = f.list(true);
        assert!(!l.can_save);
        assert_eq!(l.files.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), vec!["FPGA_8IN_NI1486_capture_v10.0.0.lvbitx"]);
        assert_eq!(f.save("x.lvbitx", "{}", true).unwrap_err().kind, "forbidden");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn names_are_plain_json_files() {
        assert!(valid_name("sample_v1.0.0.json"));
        assert!(valid_name("Front Cam_v2.1.0.JSON"));
        for bad in ["", ".json", "../x.json", "a/b.json", "a\\b.json", "C:x.json", "x.txt", ".hidden.json", "a?.json"] {
            assert!(!valid_name(bad), "{bad}");
        }
    }

    #[test]
    fn creates_folder_saves_lists_and_protects_existing_files() {
        let (p, base) = temp("flow");
        assert!(!p.dir().to_string_lossy().contains(".."), "{}", p.dir().display());
        let l = p.list(true);
        assert_eq!((l.files.len(), l.error), (0, None)); // missing folder = empty, not an error
        let s = p.save("sample_v1.0.0.json", "{\"a\":1}", false).expect("first save");
        assert!(s.path.ends_with("sample_v1.0.0.json"));
        assert_eq!(p.read("sample_v1.0.0.json").unwrap(), "{\"a\":1}\n");
        assert_eq!(p.save("sample_v1.0.0.json", "{\"a\":2}", false).unwrap_err().kind, "exists");
        assert!(p.save("sample_v1.0.0.json", "{\"a\":2}", true).is_ok());
        assert_eq!(p.save("bad.json", "{ nope", true).unwrap_err().kind, "invalid");
        assert_eq!(p.save("../escape.json", "{}", true).unwrap_err().kind, "invalid");
        assert_eq!(p.read("gone.json").unwrap_err().kind, "notFound");
        fs::write(p.dir().join("notes.txt"), "x").unwrap();
        let names: Vec<String> = p.list(true).files.into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["sample_v1.0.0.json"]);
        let _ = fs::remove_dir_all(base);
    }
}
