use crate::engine::queue::{
    CookiesBrowser, Engine, HistoryItem, Item, Settings, default_download_dir,
};
use serde::Serialize;
use serde::de::DeserializeOwned;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Default, Serialize, serde::Deserialize)]
struct QueueDisk {
    #[serde(default)]
    pending: Vec<Item>,
    #[serde(default)]
    active: Option<Item>,
    #[serde(default)]
    session: Vec<HistoryItem>,
    #[serde(default)]
    order_version: u8,
}

pub fn load(data_dir: &Path, downloads: &Path) -> Engine {
    let settings = read_settings(data_dir, downloads);
    let mut queue = read_json::<QueueDisk>(&data_dir.join("queue.json"));
    let history = read_json::<Vec<HistoryItem>>(&data_dir.join("history.json"));
    let needs_order_migration = queue.order_version == 0;
    let mut pending = std::mem::take(&mut queue.pending);
    if needs_order_migration {
        let mut live = Vec::new();
        let mut regular = Vec::new();
        for item in pending.drain(..) {
            if item.live_mode.is_some() {
                live.push(item);
            } else {
                regular.push(item);
            }
        }
        live.reverse();
        regular.reverse();
        pending = live;
        pending.extend(regular);
    }
    if let Some(active) = queue.active.take() {
        let is_live = active.live_mode.is_some();
        let index = if is_live {
            0
        } else {
            pending
                .iter()
                .position(|item| item.live_mode.is_none())
                .unwrap_or(pending.len())
        };
        pending.insert(index, active);
    }
    let mut engine = Engine::new(settings.download_dir.clone());
    engine.settings = settings;
    engine.pending = pending;
    engine.normalize_pending_order();
    engine.history = history;
    engine.session = queue.session;
    if engine.archive_session_all() || needs_order_migration {
        let _ = save(data_dir, &engine);
    }
    engine
}

pub fn save(data_dir: &Path, engine: &Engine) -> Result<(), String> {
    fs::create_dir_all(data_dir).map_err(|err| err.to_string())?;
    let queue = QueueDisk {
        pending: engine.pending.clone(),
        active: engine
            .active
            .clone()
            .filter(|_| !engine.discard_active_result),
        session: engine.session.clone(),
        order_version: 1,
    };
    write_json(&data_dir.join("queue.json"), &queue)?;
    write_json(&data_dir.join("history.json"), &engine.history)?;
    write_json(&data_dir.join("settings.json"), &engine.settings)?;
    Ok(())
}

pub fn prepare_dir(path: &str) -> Result<PathBuf, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("path is empty".into());
    }
    let buf = PathBuf::from(path);
    if buf.is_file() {
        return Err("path is a file".into());
    }
    fs::create_dir_all(&buf).map_err(|err| err.to_string())?;
    let canonical = fs::canonicalize(&buf).unwrap_or(buf);
    Ok(PathBuf::from(normalize_windows_path(&canonical.to_string_lossy())))
}

fn normalize_windows_path(path: &str) -> String {
    if let Some(path) = path.strip_prefix(r"\\?\UNC\") {
        return format!(r"\{}", path);
    }
    path.strip_prefix(r"\\?\").unwrap_or(path).to_string()
}

fn read_settings(data_dir: &Path, downloads: &Path) -> Settings {
    let path = data_dir.join("settings.json");
    if let Ok(text) = fs::read_to_string(&path) {
        match serde_json::from_str::<Settings>(&text) {
            Ok(mut settings) if !settings.download_dir.trim().is_empty() => {
                settings.download_dir = normalize_windows_path(&settings.download_dir);
                return settings;
            }
            Ok(_) => {}
            Err(_) => {
                let _ = fs::rename(&path, path.with_extension("json.bad"));
            }
        }
    }
    Settings {
        download_dir: default_download_dir(downloads)
            .to_string_lossy()
            .into_owned(),
        cookies_browser: CookiesBrowser::default(),
        cookies_updated_at: None,
        download_speed_limit_bytes_per_second: None,
    }
}

fn read_json<T: DeserializeOwned + Default>(path: &Path) -> T {
    let Ok(text) = fs::read_to_string(path) else {
        return T::default();
    };
    match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(_) => {
            let _ = fs::rename(path, path.with_extension("json.bad"));
            T::default()
        }
    }
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|err| err.to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, &bytes).map_err(|err| err.to_string())?;
    if path.exists() {
        fs::remove_file(path).map_err(|err| err.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::{load, save};
    use crate::engine::format::{Preset, Selection};
    use crate::engine::queue::{Engine, EnqueueItem, HistoryStatus};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn reload_demotes_active_and_keeps_settings() {
        let root = std::env::temp_dir().join(format!(
            "downly-store-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let downloads = root.join("Downloads");
        let data = root.join("data");
        let files = root.join("files");
        fs::create_dir_all(&downloads).unwrap();
        fs::create_dir_all(&files).unwrap();
        let mut engine = Engine::new(files.to_string_lossy().to_string());
        engine.settings.cookies_browser = crate::engine::queue::CookiesBrowser::Firefox;
        engine.enqueue(
            vec![
                EnqueueItem {
                    url: "https://www.youtube.com/watch?v=aaa".into(),
                    video_id: "aaa".into(),
                    title: "A".into(),
                    thumbnail: None,
                    preflight_checked: false,
                    duration_seconds: None,
                    size_bytes: None,
                    selection: Selection::Preset {
                        preset: Preset::Audio320,
                        save_thumbnail: true,
                        label: String::new(),
                        clip: None,
                    },
                    live_mode: None,
                },
                EnqueueItem {
                    url: "https://www.youtube.com/watch?v=bbb".into(),
                    video_id: "bbb".into(),
                    title: "B".into(),
                    thumbnail: None,
                    preflight_checked: false,
                    duration_seconds: None,
                    size_bytes: None,
                    selection: Selection::Preset {
                        preset: Preset::Video720,
                        save_thumbnail: false,
                        label: String::new(),
                        clip: None,
                    },
                    live_mode: None,
                },
            ],
            &files,
        );
        assert!(engine.begin());
        engine.take_next().unwrap();
        engine.finish_active(HistoryStatus::Failed, None, Some("nope".into()));
        assert!(engine.begin() || engine.running || !engine.pending.is_empty());
        if engine.active.is_none() && !engine.pending.is_empty() {
            let _ = engine.begin();
            engine.take_next().unwrap();
        }
        save(&data, &engine).unwrap();
        let loaded = load(&data, &downloads);
        assert!(loaded.active.is_none());
        assert!(!loaded.running);
        assert_eq!(loaded.pending.len(), 1);
        assert_eq!(loaded.pending[0].video_id, "bbb");
        assert!(loaded.session.is_empty());
        assert_eq!(loaded.history.len(), 1);
        assert_eq!(loaded.history[0].error.as_deref(), Some("nope"));
        let again = load(&data, &downloads);
        assert_eq!(again.history.len(), 1);
        assert!(again.session.is_empty());
        assert_eq!(loaded.settings.download_dir, engine.settings.download_dir);
        assert_eq!(loaded.settings.cookies_browser, engine.settings.cookies_browser);
        let fresh = load(&root.join("missing"), &downloads);
        assert!(
            fresh
                .settings
                .download_dir
                .replace('\\', "/")
                .ends_with("Downloads/Downly")
        );
        let _ = fs::remove_dir_all(root);
    }
}
