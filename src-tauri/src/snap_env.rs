//! Linux: started from a terminal of a snap application (e.g. the VS Code snap), the
//! environment points GTK / GIO at the snap's own libraries (GTK_PATH=/snap/code/…,
//! GIO_MODULE_DIR=/snap/…). Loading those next to the system libraries fails with
//!   symbol lookup error: /snap/core20/current/lib/x86_64-linux-gnu/libpthread.so.0:
//!   undefined symbol: __libc_pthread_init
//! So before anything loads, drop such variables (and /snap/ entries from path lists)
//! and restart once with the cleaned environment.

/// Variables that make GTK / GIO / the loader pick up libraries or modules.
const LIB_VARS: &[&str] = &[
    "GTK_PATH", "GTK_EXE_PREFIX", "GTK_IM_MODULE_FILE", "GIO_MODULE_DIR", "GIO_LAUNCHED_DESKTOP_FILE",
    "GDK_PIXBUF_MODULE_FILE", "GDK_PIXBUF_MODULEDIR", "GSETTINGS_SCHEMA_DIR", "LOCPATH",
    "LD_LIBRARY_PATH", "LD_PRELOAD", "GST_PLUGIN_PATH", "GST_PLUGIN_SYSTEM_PATH",
];
/// Colon-separated lists from which only the /snap/ entries are removed.
const PATH_VARS: &[&str] = &["XDG_DATA_DIRS", "XDG_CONFIG_DIRS"];

const MARK: &str = "VISION_STUDIO_SNAP_ENV_CLEANED";

fn is_snap(p: &str) -> bool {
    // /snap/<name>/… (the snap itself) and ~/snap/<name>/… (its per-user data, e.g. gio-modules)
    p.starts_with("/snap/") || p.contains("/snap/") || p.starts_with("/var/lib/snapd/")
}

/// The changes to make: Some(value) = set, None = remove. Empty when nothing points into a snap.
pub fn cleanup(get: impl Fn(&str) -> Option<String>) -> Vec<(&'static str, Option<String>)> {
    let mut out = Vec::new();
    for &k in LIB_VARS {
        if let Some(v) = get(k) {
            if v.split(':').any(is_snap) {
                let kept: Vec<&str> = v.split(':').filter(|p| !p.is_empty() && !is_snap(p)).collect();
                // single-path variables are dropped; real library lists keep their non-snap part
                let list = matches!(k, "LD_LIBRARY_PATH" | "GST_PLUGIN_PATH" | "GST_PLUGIN_SYSTEM_PATH");
                out.push((k, if list && !kept.is_empty() { Some(kept.join(":")) } else { None }));
            }
        }
    }
    for &k in PATH_VARS {
        if let Some(v) = get(k) {
            if v.split(':').any(is_snap) {
                let kept: Vec<&str> = v.split(':').filter(|p| !p.is_empty() && !is_snap(p)).collect();
                out.push((k, if kept.is_empty() { None } else { Some(kept.join(":")) }));
            }
        }
    }
    out
}

/// Restart with a clean environment if needed (Linux only; never when running as a snap itself).
pub fn fix() {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        if std::env::var_os("SNAP").is_some() || std::env::var_os(MARK).is_some() {
            return;
        }
        let changes = cleanup(|k| std::env::var(k).ok());
        if changes.is_empty() {
            return;
        }
        let Ok(exe) = std::env::current_exe() else { return };
        let mut cmd = std::process::Command::new(exe);
        cmd.args(std::env::args_os().skip(1)).env(MARK, "1");
        for (k, v) in &changes {
            match v { Some(v) => { cmd.env(k, v); } None => { cmd.env_remove(k); } }
        }
        eprintln!("Vision Studio: ignoring snap library settings from this terminal ({})",
            changes.iter().map(|(k, _)| *k).collect::<Vec<_>>().join(", "));
        let err = cmd.exec(); // only returns on failure
        eprintln!("Vision Studio: could not restart with a clean environment: {err}");
    }
}

#[cfg(test)]
mod tests {
    use super::cleanup;
    use std::collections::HashMap;

    #[test]
    fn drops_snap_library_settings_only() {
        let env: HashMap<&str, &str> = [
            ("GTK_PATH", "/snap/code/current/usr/lib/x86_64-linux-gnu/gtk-3.0"),
            ("GIO_MODULE_DIR", "/home/u/snap/code/common/.cache/gio-modules"),
            ("LD_LIBRARY_PATH", "/opt/ni/lib:/snap/core20/current/lib"),
            ("XDG_DATA_DIRS", "/usr/share:/snap/code/current/usr/share:/usr/local/share"),
            ("GSETTINGS_SCHEMA_DIR", "/usr/share/glib-2.0/schemas"),
        ].into_iter().collect();
        let mut got = cleanup(|k| env.get(k).map(|v| v.to_string()));
        got.sort();
        assert_eq!(got, vec![
            ("GIO_MODULE_DIR", None),
            ("GTK_PATH", None),
            ("LD_LIBRARY_PATH", Some("/opt/ni/lib".to_string())),
            ("XDG_DATA_DIRS", Some("/usr/share:/usr/local/share".to_string())),
        ]);
    }

    #[test]
    fn nothing_to_do_outside_snaps() {
        assert!(cleanup(|k| (k == "GTK_PATH").then(|| "/usr/lib/gtk-3.0".to_string())).is_empty());
    }
}
