//! Startup configuration read from an INI file next to the executable.
//!
//! Lookup order (first file found wins):
//!   1. `--config <path>` on the command line
//!   2. `<exe folder>/<exe name>.ini`        e.g. VisionStudio.ini
//!   3. `<exe folder>/vision-studio.ini`
//!   4. `<user config dir>/vision-studio.ini` (e.g. %APPDATA%\com.visionstudio.cameraconfig)
//!   5. `<resource dir>/vision-studio.ini`    (installed copy)
//! Command-line flags `--mode`, `--host`, `--port`, `--no-browser` override the file.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Desktop,
    Web,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub mode: Mode,
    pub width: f64,
    pub height: f64,
    pub maximized: bool,
    pub host: String,
    pub port: u16,
    pub open_browser: bool,
    /// `[app] ui_config` as written (path of the dropdown lists file).
    pub ui_config: String,
    /// `[app] project_dir` as written (folder the configurations are saved in).
    pub project_dir: String,
    /// `[app] tester_dir`, `bitfile_dir`, `datalogger_dir` as written.
    pub tester_dir: String,
    pub bitfile_dir: String,
    pub datalogger_dir: String,
    pub i2c_dir: String,
    /// The INI file that was used (None = built-in defaults).
    pub source: Option<PathBuf>,
    /// Problems found while reading the file / arguments (shown to the user).
    pub warnings: Vec<String>,
}

pub const DEFAULT_PROJECT_DIR: &str = "../../configurations/project_configuration";
pub const DEFAULT_TESTER_DIR: &str = "../../configurations/tester_configuration";
pub const DEFAULT_BITFILE_DIR: &str = "../../fpga_bitfile";
pub const DEFAULT_DATALOGGER_DIR: &str = "../../datalogger_configuration";
pub const DEFAULT_I2C_DIR: &str = "../../configurations/i2c_configuration";
pub const MIN_WIDTH: f64 = 980.0;
pub const MIN_HEIGHT: f64 = 620.0;

impl Default for Config {
    fn default() -> Self {
        Config {
            mode: Mode::Desktop,
            width: 1440.0,
            height: 900.0,
            maximized: false,
            host: "127.0.0.1".into(),
            port: 8080,
            open_browser: true,
            ui_config: "ui_config.json".into(),
            project_dir: DEFAULT_PROJECT_DIR.into(),
            tester_dir: DEFAULT_TESTER_DIR.into(),
            bitfile_dir: DEFAULT_BITFILE_DIR.into(),
            datalogger_dir: DEFAULT_DATALOGGER_DIR.into(),
            i2c_dir: DEFAULT_I2C_DIR.into(),
            source: None,
            warnings: Vec::new(),
        }
    }
}

fn parse_bool(v: &str) -> Option<bool> {
    match v.to_ascii_lowercase().as_str() {
        "true" | "yes" | "on" | "1" => Some(true),
        "false" | "no" | "off" | "0" => Some(false),
        _ => None,
    }
}

fn parse_mode(v: &str) -> Option<Mode> {
    match v.to_ascii_lowercase().as_str() {
        "desktop" => Some(Mode::Desktop),
        "web" => Some(Mode::Web),
        _ => None,
    }
}

/// Strip an inline comment (`; …` or `# …` preceded by whitespace) and surrounding quotes.
fn clean_value(raw: &str) -> String {
    let mut end = raw.len();
    let bytes = raw.as_bytes();
    for i in 0..bytes.len() {
        if (bytes[i] == b';' || bytes[i] == b'#') && (i == 0 || bytes[i - 1].is_ascii_whitespace()) {
            end = i;
            break;
        }
    }
    let v = raw[..end].trim();
    let v = v.strip_prefix('"').and_then(|s| s.strip_suffix('"')).unwrap_or(v);
    v.to_string()
}

impl Config {
    /// Apply the contents of an INI file on top of the current values.
    pub fn apply_ini(&mut self, text: &str, name: &str) {
        let mut section = String::new();
        for (n, line) in text.lines().enumerate() {
            let line = line.trim().trim_start_matches('\u{feff}');
            if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
                continue;
            }
            if line.starts_with('[') {
                match line.find(']') {
                    Some(end) => section = line[1..end].trim().to_ascii_lowercase(),
                    None => self.warnings.push(format!("{name} line {}: malformed section header '{line}'", n + 1)),
                }
                continue;
            }
            let Some((k, v)) = line.split_once('=') else {
                self.warnings.push(format!("{name} line {}: expected 'key = value', found '{line}'", n + 1));
                continue;
            };
            let key = k.trim().to_ascii_lowercase();
            let value = clean_value(v);
            self.set(&section, &key, &value, &format!("{name} line {}", n + 1));
        }
    }

    fn set(&mut self, section: &str, key: &str, value: &str, at: &str) {
        let bad = |what: &str| format!("{at}: invalid {what} '{value}'");
        match (section, key) {
            ("app", "mode") => match parse_mode(value) {
                Some(m) => self.mode = m,
                None => self.warnings.push(format!("{} – use 'desktop' or 'web'; starting in {} mode", bad("mode"),
                    if self.mode == Mode::Web { "web" } else { "desktop" })),
            },
            ("app", "ui_config") => {
                if value.is_empty() { self.warnings.push(bad("ui_config path")); } else { self.ui_config = value.to_string(); }
            }
            ("app", "project_dir") | ("app", "tester_dir") | ("app", "bitfile_dir") | ("app", "datalogger_dir") | ("app", "i2c_dir") => {
                if value.is_empty() {
                    self.warnings.push(bad(&format!("{key} path")));
                } else {
                    let v = value.to_string();
                    match key { "project_dir" => self.project_dir = v, "tester_dir" => self.tester_dir = v, "bitfile_dir" => self.bitfile_dir = v, "i2c_dir" => self.i2c_dir = v, _ => self.datalogger_dir = v }
                }
            }
            ("desktop", "width") => match value.parse::<f64>() {
                Ok(w) if w.is_finite() && w > 0.0 => self.width = w.max(MIN_WIDTH),
                _ => self.warnings.push(bad("width")),
            },
            ("desktop", "height") => match value.parse::<f64>() {
                Ok(h) if h.is_finite() && h > 0.0 => self.height = h.max(MIN_HEIGHT),
                _ => self.warnings.push(bad("height")),
            },
            ("desktop", "maximized") | ("desktop", "maximised") => match parse_bool(value) {
                Some(b) => self.maximized = b,
                None => self.warnings.push(bad("true/false value")),
            },
            ("web", "host") => {
                if value.is_empty() || value.contains(char::is_whitespace) {
                    self.warnings.push(bad("host"));
                } else {
                    self.host = value.to_string();
                }
            }
            ("web", "port") => match value.parse::<u16>() {
                Ok(p) if p > 0 => self.port = p,
                _ => self.warnings.push(format!("{} – use a number from 1 to 65535", bad("port"))),
            },
            ("web", "open_browser") => match parse_bool(value) {
                Some(b) => self.open_browser = b,
                None => self.warnings.push(bad("true/false value")),
            },
            _ => self.warnings.push(format!("{at}: unknown setting [{section}] {key} (ignored)")),
        }
    }

    /// Apply `--mode`, `--host`, `--port` (both `--key value` and `--key=value`) and `--no-browser`.
    pub fn apply_args(&mut self, args: &[String]) {
        let mut i = 0;
        while i < args.len() {
            let a = &args[i];
            let (flag, inline) = match a.split_once('=') {
                Some((f, v)) if f.starts_with("--") => (f.to_string(), Some(v.to_string())),
                _ => (a.clone(), None),
            };
            if flag == "--no-browser" {
                self.open_browser = false;
                i += 1;
                continue;
            }
            let section_key = match flag.as_str() {
                "--mode" => Some(("app", "mode")),
                "--host" => Some(("web", "host")),
                "--port" => Some(("web", "port")),
                _ => None,
            };
            if let Some((section, key)) = section_key {
                let value = inline.or_else(|| { i += 1; args.get(i).cloned() });
                match value {
                    Some(v) => self.set(section, key, &v, &format!("command line {flag}")),
                    None => self.warnings.push(format!("command line: {flag} needs a value")),
                }
            }
            i += 1;
        }
    }

    /// Absolute path of ui_config.json: relative to the INI file's folder,
    /// or to the executable's folder when no INI file was found.
    pub fn ui_config_path(&self) -> PathBuf {
        crate::ui_config::resolve(&self.ui_config, &self.base_dir())
    }

    /// Absolute path of the project folder (same rule as ui_config).
    pub fn project_dir_path(&self) -> PathBuf {
        crate::ui_config::resolve(&self.project_dir, &self.base_dir())
    }

    /// The bench folders (project, tester, bit files, datalogger configurations).
    pub fn folders(&self) -> crate::projects::Folders {
        use crate::projects::ProjectDir;
        let p = |v: &str| crate::ui_config::resolve(v, &self.base_dir());
        crate::projects::Folders {
            project: ProjectDir::new(self.project_dir_path()),
            tester: ProjectDir::new(p(&self.tester_dir)),
            bitfile: ProjectDir::read_only(p(&self.bitfile_dir), ".lvbitx"),
            datalogger: ProjectDir::read_only(p(&self.datalogger_dir), ".json"),
            i2c: ProjectDir::read_only(p(&self.i2c_dir), ".txt"),
        }
    }

    fn base_dir(&self) -> PathBuf {
        self.source.as_ref().and_then(|p| p.parent().map(Path::to_path_buf))
            .or_else(|| std::env::current_exe().ok().and_then(|e| e.parent().map(Path::to_path_buf)))
            .unwrap_or_else(|| PathBuf::from("."))
    }

    pub fn url(&self) -> String {
        let host = match self.host.as_str() {
            "0.0.0.0" | "::" | "[::]" => "localhost",
            h => h,
        };
        if host.contains(':') && !host.starts_with('[') {
            format!("http://[{host}]:{}/", self.port)
        } else {
            format!("http://{host}:{}/", self.port)
        }
    }
}

/// Value of `--config <path>` / `--config=<path>`.
pub fn config_arg(args: &[String]) -> Option<PathBuf> {
    let mut it = args.iter();
    while let Some(a) = it.next() {
        if let Some(p) = a.strip_prefix("--config=") {
            return Some(PathBuf::from(p));
        }
        if a == "--config" {
            return it.next().map(PathBuf::from);
        }
    }
    None
}

/// Candidate INI files in lookup order.
pub fn candidates(args: &[String], exe: Option<&Path>, extra_dirs: &[PathBuf]) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(p) = config_arg(args) {
        out.push(p);
        return out; // an explicit --config must exist; no silent fallback
    }
    if let Some(exe) = exe {
        if let Some(dir) = exe.parent() {
            if let Some(stem) = exe.file_stem() {
                out.push(dir.join(format!("{}.ini", stem.to_string_lossy())));
            }
            out.push(dir.join("vision-studio.ini"));
        }
    }
    for d in extra_dirs {
        out.push(d.join("vision-studio.ini"));
    }
    out.dedup();
    out
}

/// Build the configuration: defaults → first INI found → command-line flags.
pub fn load(args: &[String], extra_dirs: &[PathBuf]) -> Config {
    let mut cfg = Config::default();
    let exe = std::env::current_exe().ok();
    let explicit = config_arg(args).is_some();
    for path in candidates(args, exe.as_deref(), extra_dirs) {
        match std::fs::read_to_string(&path) {
            Ok(text) => {
                let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                cfg.apply_ini(&text, &name);
                cfg.source = Some(path);
                break;
            }
            Err(e) if explicit => cfg.warnings.push(format!("Could not read {}: {e}. Using defaults.", path.display())),
            Err(_) => {}
        }
    }
    cfg.apply_args(args);
    cfg
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = include_str!("../../config/vision-studio.ini");

    #[test]
    fn shipped_ini_parses_cleanly_to_defaults() {
        let mut c = Config::default();
        c.apply_ini(SAMPLE, "vision-studio.ini");
        assert!(c.warnings.is_empty(), "{:?}", c.warnings);
        assert_eq!(c.mode, Mode::Desktop);
        assert_eq!((c.width, c.height, c.maximized), (1440.0, 900.0, false));
        assert_eq!((c.host.as_str(), c.port, c.open_browser), ("127.0.0.1", 8080, true));
        assert_eq!(c.ui_config, "ui_config.json");
        assert_eq!(c.project_dir, DEFAULT_PROJECT_DIR);
    }

    #[test]
    fn parses_web_mode_with_comments_case_and_crlf() {
        let mut c = Config::default();
        c.apply_ini("\u{feff}[APP]\r\nMode = Web   ; serve in browser\r\n[web]\r\nport=9000 # custom\r\nhost = \"0.0.0.0\"\r\nopen_browser = no\r\n", "t.ini");
        assert!(c.warnings.is_empty(), "{:?}", c.warnings);
        assert_eq!(c.mode, Mode::Web);
        assert_eq!(c.port, 9000);
        assert_eq!(c.host, "0.0.0.0");
        assert!(!c.open_browser);
        assert_eq!(c.url(), "http://localhost:9000/");
    }

    #[test]
    fn invalid_values_keep_defaults_and_warn() {
        let mut c = Config::default();
        c.apply_ini("[app]\nmode = webb\n[web]\nport = 70000\n[desktop]\nwidth = 300\nfoo = 1\n", "t.ini");
        assert_eq!(c.mode, Mode::Desktop);
        assert_eq!(c.port, 8080);
        assert_eq!(c.width, MIN_WIDTH); // clamped, not rejected
        assert_eq!(c.warnings.len(), 3, "{:?}", c.warnings);
        assert!(c.warnings[0].contains("use 'desktop' or 'web'"));
    }

    #[test]
    fn command_line_overrides_file() {
        let mut c = Config::default();
        c.apply_ini("[app]\nmode = desktop\n", "t.ini");
        c.apply_args(&["app.exe".into(), "--mode".into(), "web".into(), "--port=9100".into()]);
        assert_eq!((c.mode, c.port), (Mode::Web, 9100));
        c.apply_args(&["--no-browser".into()]);
        assert!(!c.open_browser);
        c.apply_args(&["--port".into()]);
        assert!(c.warnings.iter().any(|w| w.contains("needs a value")));
    }

    #[test]
    fn lookup_order_prefers_exe_named_ini_and_explicit_config() {
        let exe = Path::new("C:/Tools/VisionStudio/VisionStudio.exe");
        let c = candidates(&[], Some(exe), &[PathBuf::from("C:/Users/me/AppData")]);
        let names: Vec<String> = c.iter().map(|p| p.to_string_lossy().replace('\\', "/")).collect();
        assert_eq!(names, vec![
            "C:/Tools/VisionStudio/VisionStudio.ini",
            "C:/Tools/VisionStudio/vision-studio.ini",
            "C:/Users/me/AppData/vision-studio.ini",
        ]);
        let explicit = candidates(&["x".into(), "--config".into(), "D:/bench.ini".into()], Some(exe), &[]);
        assert_eq!(explicit, vec![PathBuf::from("D:/bench.ini")]);
    }

    #[test]
    fn ui_config_path_is_relative_to_the_ini() {
        let mut c = Config::default();
        c.apply_ini("[app]\nui_config = lists/ui.json\n", "t.ini");
        c.source = Some(PathBuf::from("/opt/vs/VisionStudio.ini"));
        assert_eq!(c.ui_config_path(), PathBuf::from("/opt/vs/lists/ui.json"));
        assert_eq!(c.project_dir_path(), PathBuf::from("/opt/vs/../../configurations/project_configuration"));
        c.apply_ini("[app]\nproject_dir = D:/bench/projects\ntester_dir = T\nbitfile_dir = B\ndatalogger_dir = L\ni2c_dir = I\n", "t.ini");
        assert_eq!(c.i2c_dir, "I");
        assert_eq!((c.tester_dir.as_str(), c.bitfile_dir.as_str(), c.datalogger_dir.as_str()), ("T", "B", "L"));
        assert!(c.warnings.is_empty(), "{:?}", c.warnings);
    }

    #[test]
    fn ipv6_url() {
        let c = Config { host: "::1".into(), port: 8080, ..Config::default() };
        assert_eq!(c.url(), "http://[::1]:8080/");
    }
}
