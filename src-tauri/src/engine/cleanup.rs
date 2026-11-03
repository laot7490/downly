use crate::engine::filename::id_marker;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileStamp {
    pub len: u64,
    pub modified: Option<SystemTime>,
}

pub fn snapshot_id(dir: &Path, video_id: &str) -> HashMap<PathBuf, FileStamp> {
    let mut found = HashMap::new();
    if video_id.is_empty() {
        return found;
    }
    let needle = id_marker(video_id);
    let Ok(entries) = fs::read_dir(dir) else {
        return found;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if !name.to_string_lossy().contains(&needle) {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        found.insert(
            entry.path(),
            FileStamp {
                len: meta.len(),
                modified: meta.modified().ok(),
            },
        );
    }
    found
}

pub fn delete_cancelled(
    dir: &Path,
    video_id: &str,
    before: &HashMap<PathBuf, FileStamp>,
    tracked: &[PathBuf],
) {
    delete_part_files(dir, video_id);
    if video_id.is_empty() {
        for path in tracked {
            let _ = fs::remove_file(path);
        }
        return;
    }
    let needle = id_marker(video_id);
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !name.contains(&needle) {
                continue;
            }
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            if !meta.is_file() {
                continue;
            }
            let changed = match before.get(&path) {
                None => true,
                Some(stamp) => stamp.len != meta.len() || stamp.modified != meta.modified().ok(),
            };
            if changed {
                let _ = fs::remove_file(&path);
            }
        }
    }
    for path in tracked {
        if path_changed(path, before) {
            let _ = fs::remove_file(path);
            let mut part = path.as_os_str().to_owned();
            part.push(".part");
            let _ = fs::remove_file(part);
        }
    }
}

pub fn delete_part_files(dir: &Path, video_id: &str) {
    if video_id.is_empty() {
        return;
    }
    let needle = id_marker(video_id);
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.contains(&needle) && is_partial_name(&name) {
            let _ = fs::remove_file(entry.path());
        }
    }
}

fn path_changed(path: &Path, before: &HashMap<PathBuf, FileStamp>) -> bool {
    let Ok(meta) = fs::metadata(path) else {
        return false;
    };
    match before.get(path) {
        None => true,
        Some(stamp) => stamp.len != meta.len() || stamp.modified != meta.modified().ok(),
    }
}

fn is_partial_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".part") || lower.ends_with(".ytdl") || lower.ends_with(".temp")
}

pub fn choose_output(
    final_path: Option<&Path>,
    tracked: &[PathBuf],
    dir: &Path,
    video_id: &str,
) -> Option<String> {
    if let Some(path) = final_path
        && is_output_file(path)
    {
        return Some(path.to_string_lossy().into_owned());
    }
    for path in tracked.iter().rev() {
        if is_output_file(path) {
            return Some(path.to_string_lossy().into_owned());
        }
    }
    newest_output(dir, video_id)
}

fn newest_output(dir: &Path, video_id: &str) -> Option<String> {
    if video_id.is_empty() {
        return None;
    }
    let needle = id_marker(video_id);
    let mut best: Option<(SystemTime, PathBuf)> = None;
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.contains(&needle) || !is_output_name(&name) {
            continue;
        }
        let path = entry.path();
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        if best
            .as_ref()
            .map(|(time, _)| modified >= *time)
            .unwrap_or(true)
        {
            best = Some((modified, path));
        }
    }
    best.map(|(_, path)| path.to_string_lossy().into_owned())
}

fn is_output_file(path: &Path) -> bool {
    path.is_file()
        && path
            .file_name()
            .is_some_and(|name| is_output_name(&name.to_string_lossy()))
}

fn is_output_name(name: &str) -> bool {
    !is_partial_name(name) && !is_fragment_name(name) && !is_image_name(name)
}

fn is_fragment_name(name: &str) -> bool {
    name.split('.').any(|part| {
        let bytes = part.as_bytes();
        bytes.len() > 1 && bytes[0] == b'f' && bytes[1..].iter().all(|byte| byte.is_ascii_digit())
    })
}

fn is_image_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".jpg", ".jpeg", ".png", ".webp", ".gif"]
        .iter()
        .any(|ext| lower.ends_with(ext))
}

#[cfg(test)]
mod tests {
    use super::{choose_output, delete_cancelled, snapshot_id};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "downly-clean-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn cancel_deletes_new_outputs_and_parts_only() {
        let dir = scratch();
        fs::write(dir.join("Keep [abc].mp4"), b"old").unwrap();
        fs::write(dir.join("Other [zzz].mp4"), b"stay").unwrap();
        let before = snapshot_id(&dir, "abc");
        let fresh = dir.join("Song [abc].f137.mp4");
        let part = dir.join("Song [abc].mp4.part");
        fs::write(&fresh, b"partial").unwrap();
        fs::write(&part, b"part").unwrap();
        fs::write(dir.join("Song [abc].webp"), b"thumb").unwrap();
        delete_cancelled(&dir, "abc", &before, std::slice::from_ref(&fresh));
        assert!(dir.join("Keep [abc].mp4").is_file());
        assert!(dir.join("Other [zzz].mp4").is_file());
        assert!(!fresh.exists());
        assert!(!part.exists());
        assert!(!dir.join("Song [abc].webp").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn chooses_final_media_over_fragments() {
        let dir = scratch();
        let part = dir.join("Song [abc].mp4.part");
        let fragment = dir.join("Song [abc].f137.mp4");
        let image = dir.join("Song [abc].webp");
        let media = dir.join("Song [abc].mp4");
        fs::write(&part, b"p").unwrap();
        fs::write(&fragment, b"f").unwrap();
        fs::write(&image, b"i").unwrap();
        fs::write(&media, b"m").unwrap();
        let chosen = choose_output(None, &[fragment, image.clone(), media.clone()], &dir, "abc");
        assert_eq!(chosen.as_deref(), Some(media.to_str().unwrap()));
        let printed = choose_output(Some(&media), &[], &dir, "abc");
        assert_eq!(printed.as_deref(), Some(media.to_str().unwrap()));
        let _ = fs::remove_dir_all(&dir);
    }
}
