use crate::engine::format::Selection;
use crate::engine::queue::{Engine, HistoryStatus};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const COPY_BUFFER_BYTES: usize = 1024 * 1024;

#[derive(Clone, serde::Serialize)]
struct TransferProgress {
    id: String,
    percent: f64,
}

pub fn item_stage_dir(data_dir: &Path, url: &str, selection: &Selection) -> PathBuf {
    let selection = serde_json::to_vec(selection).unwrap_or_default();
    let mut digest = Sha256::new();
    digest.update(url.as_bytes());
    digest.update([0]);
    digest.update(selection);
    data_dir.join("temp").join(hex::encode(digest.finalize()))
}

pub fn cleanup_orphans(data_dir: &Path, referenced: &[PathBuf]) {
    let root = data_dir.join("temp");
    let Ok(entries) = fs::read_dir(&root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() && !referenced.iter().any(|candidate| candidate == &path) {
            let _ = fs::remove_dir_all(path);
        }
    }
}

pub fn cleanup_engine_orphans(data_dir: &Path, engine: &Engine) {
    let referenced = engine
        .pending
        .iter()
        .chain(engine.active.iter())
        .map(|item| item_stage_dir(data_dir, &item.url, &item.selection))
        .chain(
            engine
                .session
                .iter()
                .chain(engine.history.iter())
                .filter(|item| item.status == HistoryStatus::Failed)
                .map(|item| item_stage_dir(data_dir, &item.url, &item.selection)),
        )
        .collect::<Vec<_>>();
    cleanup_orphans(data_dir, &referenced);
}

pub fn publish(
    app: Option<&AppHandle>,
    stage_dir: &Path,
    download_dir: &Path,
    item_id: &str,
    primary: &Path,
) -> Result<String, String> {
    fs::create_dir_all(download_dir).map_err(|err| err.to_string())?;
    let mut sources = fs::read_dir(stage_dir)
        .map_err(|err| err.to_string())?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_string_lossy();
            (path.is_file() && !is_partial(&name)).then_some(path)
        })
        .collect::<Vec<_>>();
    sources.sort();
    if !sources.iter().any(|source| source == primary) {
        return Err("download output not found in staging directory".into());
    }

    let primary_name = primary
        .file_name()
        .ok_or_else(|| "download output name is missing".to_string())?;
    let primary_target = download_dir.join(primary_name);
    let primary_stem = primary.file_stem().unwrap_or_default().to_string_lossy();
    let suffix = if primary_target.exists() {
        let short_id = &item_id[..8.min(item_id.len())];
        let mut selected = None;
        for index in 1..=10_000 {
            let candidate = copy_suffix(short_id, index);
            let collision = sources.iter().any(|source| {
                let stem = source.file_stem().unwrap_or_default().to_string_lossy();
                if stem != primary_stem {
                    return false;
                }
                let extension = source.extension().map(|value| value.to_string_lossy());
                download_dir.join(output_name(&stem, &candidate, extension.as_deref())).exists()
            });
            if !collision {
                selected = Some(candidate);
                break;
            }
        }
        Some(selected.ok_or_else(|| "could not find an unused output filename".to_string())?)
    } else {
        None
    };
    let mut pairs = Vec::with_capacity(sources.len());
    for source in &sources {
        let name = source
            .file_name()
            .ok_or_else(|| "download output name is missing".to_string())?;
        let stem = source.file_stem().unwrap_or_default().to_string_lossy();
        let extension = source.extension().map(|value| value.to_string_lossy());
        let source_suffix = if stem == primary_stem {
            suffix.clone()
        } else {
            None
        };
        let target_name = source_suffix
            .as_deref()
            .map(|suffix| output_name(&stem, suffix, extension.as_deref()))
            .unwrap_or_else(|| name.to_string_lossy().into_owned());
        let mut target = download_dir.join(&target_name);
        if target.exists() {
            let short_id = &item_id[..8.min(item_id.len())];
            let mut found = None;
            for index in 1..=10_000 {
                let suffix = copy_suffix(short_id, index);
                let candidate = download_dir.join(output_name(&stem, &suffix, extension.as_deref()));
                if !candidate.exists() {
                    found = Some(candidate);
                    break;
                }
            }
            target = found.ok_or_else(|| "could not find an unused output filename".to_string())?;
        }
        pairs.push((source.clone(), target));
    }

    let total_bytes = pairs
        .iter()
        .filter_map(|(source, _)| fs::metadata(source).ok())
        .map(|metadata| metadata.len())
        .sum::<u64>();
    let mut completed_bytes = 0u64;
    let mut published = Vec::new();
    for (source, target) in &pairs {
        match fs::rename(source, target) {
            Ok(()) => {
                if let Ok(metadata) = fs::metadata(target) {
                    completed_bytes = completed_bytes.saturating_add(metadata.len());
                }
                published.push((source.clone(), target.clone(), true));
            }
            Err(error) if is_cross_device(&error) => {
                let temp_target = target.with_file_name(format!(".downly-{item_id}.transfer"));
                if let Err(copy_error) = copy_with_progress(
                    app,
                    item_id,
                    source,
                    &temp_target,
                    &mut completed_bytes,
                    total_bytes,
                ) {
                    let _ = fs::remove_file(&temp_target);
                    rollback(&published);
                    return Err(copy_error);
                }
                if let Err(rename_error) = fs::rename(&temp_target, target) {
                    let _ = fs::remove_file(&temp_target);
                    rollback(&published);
                    return Err(rename_error.to_string());
                }
                published.push((source.clone(), target.clone(), false));
            }
            Err(error) => {
                rollback(&published);
                return Err(error.to_string());
            }
        }
    }

    for (source, _, moved) in &published {
        if !moved {
            let _ = fs::remove_file(source);
        }
    }
    let published_primary = pairs
        .iter()
        .find(|(source, _)| source == primary)
        .map(|(_, target)| target)
        .ok_or_else(|| "published output is missing".to_string())?;
    let _ = fs::remove_dir_all(stage_dir);
    Ok(published_primary.to_string_lossy().into_owned())
}

fn copy_suffix(item_id: &str, index: usize) -> String {
    if index == 1 {
        format!(" (copy {item_id})")
    } else {
        format!(" (copy {item_id} {index})")
    }
}

fn output_name(stem: &str, suffix: &str, extension: Option<&str>) -> String {
    match extension {
        Some(extension) => format!("{stem}{suffix}.{extension}"),
        None => format!("{stem}{suffix}"),
    }
}

fn copy_with_progress(
    app: Option<&AppHandle>,
    item_id: &str,
    source: &Path,
    target: &Path,
    completed_bytes: &mut u64,
    total_bytes: u64,
) -> Result<(), String> {
    let mut input = File::open(source).map_err(|err| err.to_string())?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
        .map_err(|err| err.to_string())?;
    let mut buffer = vec![0; COPY_BUFFER_BYTES];
    let mut last_emit = Instant::now() - Duration::from_millis(250);
    loop {
        let count = input.read(&mut buffer).map_err(|err| err.to_string())?;
        if count == 0 {
            break;
        }
        output.write_all(&buffer[..count]).map_err(|err| err.to_string())?;
        *completed_bytes = completed_bytes.saturating_add(count as u64);
        if total_bytes > 0 && last_emit.elapsed() >= Duration::from_millis(250) {
            if let Some(app) = app {
                let _ = app.emit(
                    "downly-transfer-progress",
                    TransferProgress {
                        id: item_id.to_string(),
                        percent: (*completed_bytes as f64 / total_bytes as f64 * 100.0).min(100.0),
                    },
                );
            }
            last_emit = Instant::now();
        }
    }
    if total_bytes > 0 {
        if let Some(app) = app {
            let _ = app.emit(
                "downly-transfer-progress",
                TransferProgress {
                    id: item_id.to_string(),
                    percent: (*completed_bytes as f64 / total_bytes as f64 * 100.0).min(100.0),
                },
            );
        }
    }
    output.sync_all().map_err(|err| err.to_string())
}

fn rollback(published: &[(PathBuf, PathBuf, bool)]) {
    for (source, target, moved) in published.iter().rev() {
        if *moved {
            let _ = fs::rename(target, source);
        } else {
            let _ = fs::remove_file(target);
        }
    }
}

fn is_partial(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.ends_with(".part")
        || name.ends_with(".ytdl")
        || name.ends_with(".temp")
        || name.ends_with(".transfer")
        || name.contains(".downly-") && name.contains(".tmp.")
}

#[cfg(windows)]
fn is_cross_device(error: &std::io::Error) -> bool {
    error.raw_os_error() == Some(17)
}

#[cfg(unix)]
fn is_cross_device(error: &std::io::Error) -> bool {
    error.raw_os_error() == Some(18)
}

#[cfg(not(any(windows, unix)))]
fn is_cross_device(_error: &std::io::Error) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::publish;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "downly-stage-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn publishes_media_and_sidecars_then_removes_staging() {
        let root = scratch();
        let stage = root.join("stage");
        let downloads = root.join("downloads");
        fs::create_dir_all(&stage).unwrap();
        let media = stage.join("Song [video].mp4");
        fs::write(&media, b"media").unwrap();
        fs::write(stage.join("Song [video].webp"), b"thumbnail").unwrap();

        let path = publish(None, &stage, &downloads, "12345678-item", &media).unwrap();

        assert_eq!(fs::read(&path).unwrap(), b"media");
        assert_eq!(fs::read(downloads.join("Song [video].webp")).unwrap(), b"thumbnail");
        assert!(!stage.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn existing_destination_files_are_preserved() {
        let root = scratch();
        let stage = root.join("stage");
        let downloads = root.join("downloads");
        fs::create_dir_all(&stage).unwrap();
        fs::create_dir_all(&downloads).unwrap();
        let media = stage.join("Song [video].mp4");
        fs::write(&media, b"new media").unwrap();
        fs::write(stage.join("Song [video].webp"), b"new thumbnail").unwrap();
        fs::write(downloads.join("Song [video].mp4"), b"old media").unwrap();
        fs::write(downloads.join("Song [video].webp"), b"old thumbnail").unwrap();

        let path = publish(None, &stage, &downloads, "12345678-item", &media).unwrap();

        assert_eq!(fs::read(downloads.join("Song [video].mp4")).unwrap(), b"old media");
        assert_eq!(fs::read(downloads.join("Song [video].webp")).unwrap(), b"old thumbnail");
        assert_eq!(fs::read(&path).unwrap(), b"new media");
        assert_eq!(fs::read(downloads.join("Song [video] (copy 12345678).webp")).unwrap(), b"new thumbnail");
        let _ = fs::remove_dir_all(root);
    }
}
