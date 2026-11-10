use crate::engine::{bins::deno_filename, version::version_is_newer};
use crate::net;
use crate::state::Downly;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter, Manager};
use zip::ZipArchive;

const YTDLP_REPO: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const DENO_REPO: &str = "https://api.github.com/repos/denoland/deno/releases/latest";
const FFMPEG_REPO: &str = "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest";
const MAX_EXE_BYTES: u64 = 300 * 1024 * 1024;
const MAX_FFMPEG_ARCHIVE_BYTES: u64 = 400 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolsAction {
    Ensure,
    Check,
    Update,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolVersion {
    pub id: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToolsStatus {
    pub tools: Vec<ToolVersion>,
    pub update_available: bool,
}

#[derive(Debug, Clone)]
struct ToolUpdate {
    id: ToolId,
    newer: bool,
}

#[derive(Debug, Clone, Serialize)]
struct ToolProgress {
    tool: String,
    phase: String,
    received: u64,
    total: Option<u64>,
}

#[derive(Debug, Clone)]
struct ReleaseInfo {
    id: ToolId,
    version: String,
    tag: String,
    asset_name: String,
    asset_url: String,
    checksum_url: String,
    max_bytes: u64,
    archive: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ToolId {
    Ytdlp,
    Ffmpeg,
    Ffprobe,
    Deno,
}

impl ToolId {
    const ALL: [Self; 4] = [Self::Ytdlp, Self::Ffmpeg, Self::Ffprobe, Self::Deno];

    fn key(self) -> &'static str {
        match self {
            Self::Ytdlp => "yt-dlp",
            Self::Ffmpeg => "ffmpeg",
            Self::Ffprobe => "ffprobe",
            Self::Deno => "deno",
        }
    }

    fn filename(self) -> &'static str {
        match self {
            Self::Ytdlp => "yt-dlp.exe",
            Self::Ffmpeg => "ffmpeg.exe",
            Self::Ffprobe => "ffprobe.exe",
            Self::Deno => deno_filename(),
        }
    }

    fn version_argument(self) -> &'static str {
        match self {
            Self::Ffmpeg | Self::Ffprobe => "-version",
            Self::Ytdlp | Self::Deno => "--version",
        }
    }

    fn executable(self) -> Self {
        match self {
            Self::Ffprobe => Self::Ffmpeg,
            other => other,
        }
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct InstalledRelease {
    tag: String,
    sha256: String,
}

struct InstallCleanup(PathBuf);

impl Drop for InstallCleanup {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub async fn run(app: &AppHandle, action: ToolsAction) -> Result<ToolsStatus, String> {
    match action {
        ToolsAction::Ensure => ensure(app).await,
        ToolsAction::Check => check(app).await,
        ToolsAction::Update => update_all(app).await,
    }
}

async fn ensure(app: &AppHandle) -> Result<ToolsStatus, String> {
    let downly = app.state::<Downly>();
    let _guard = downly.tools_lock.lock().await;
    if !cfg!(windows) {
        return Err("tool installation currently supports Windows only".into());
    }
    let bin = downly.data_dir.join("bin");
    fs::create_dir_all(&bin).map_err(|err| err.to_string())?;
    for id in ToolId::ALL {
        if current_version(&bin, id).is_some() {
            continue;
        }
        emit(app, id, "checking", 0, None);
        let release = match release_info(id).await {
            Ok(release) => release,
            Err(error) => {
                emit(app, id, "failed", 0, None);
                return Err(format!("{}: {error}", id.key()));
            }
        };
        if let Err(error) = install_release(app, &bin, &release).await {
            emit(app, id, "failed", 0, None);
            return Err(format!("{}: {error}", id.key()));
        }
    }
    status(&bin, false)
}

async fn check(app: &AppHandle) -> Result<ToolsStatus, String> {
    let downly = app.state::<Downly>();
    let _guard = downly.tools_lock.lock().await;
    let bin = downly.data_dir.join("bin");
    let updates = check_updates(&bin).await?;
    status(&bin, updates.iter().any(|update| update.newer))
}

async fn check_updates(bin: &Path) -> Result<Vec<ToolUpdate>, String> {
    let mut updates = Vec::with_capacity(3);
    for id in [ToolId::Ytdlp, ToolId::Ffmpeg, ToolId::Deno] {
        let current =
            current_version(&bin, id).ok_or_else(|| format!("{} not installed", id.key()))?;
        let latest = release_info(id).await?;
        let installed = read_installed_release(&bin, id);
        let newer = if id == ToolId::Ffmpeg {
            let sums = net::get_text(&latest.checksum_url).await?;
            let checksum = checksum_for(&sums, &latest.asset_name)?;
            installed
                .as_ref()
                .map(|installed| installed.sha256 != checksum)
                .unwrap_or(true)
        } else {
            version_is_newer(&latest.version, &current)
        };
        updates.push(ToolUpdate { id, newer });
    }
    if current_version(&bin, ToolId::Ffprobe).is_some() {
        updates.push(ToolUpdate {
            id: ToolId::Ffprobe,
            newer: updates
                .iter()
                .find(|update| update.id == ToolId::Ffmpeg)
                .is_some_and(|update| update.newer),
        });
    }
    Ok(updates)
}

async fn update_all(app: &AppHandle) -> Result<ToolsStatus, String> {
    let downly = app.state::<Downly>();
    let _guard = downly.tools_lock.lock().await;
    if crate::runner::download_running(app) {
        return Err("finish downloads before updating tools".into());
    }
    let bin = downly.data_dir.join("bin");
    let updates = check_updates(&bin).await?;
    let temp_dir = bin.join(".install");
    fs::create_dir_all(&temp_dir).map_err(|err| err.to_string())?;
    let _cleanup = InstallCleanup(temp_dir.clone());
    let mut staged_files = Vec::new();
    for id in [ToolId::Ytdlp, ToolId::Ffmpeg, ToolId::Deno] {
        let Some(update) = updates.iter().find(|update| update.id == id) else {
            continue;
        };
        if update.newer {
            let release = release_info(id).await?;
            staged_files.extend(prepare_release(app, &bin, &temp_dir, &release).await?);
        }
    }
    replace_many(staged_files)?;
    status(&bin, false)
}

fn status(bin: &Path, update_available: bool) -> Result<ToolsStatus, String> {
    let tools = ToolId::ALL
        .into_iter()
        .map(|id| ToolVersion {
            id: id.key().into(),
            version: current_version(bin, id),
        })
        .collect::<Vec<_>>();
    if tools.iter().any(|tool| tool.version.is_none()) {
        return Err("one or more tools are missing or not working".into());
    }
    Ok(ToolsStatus {
        tools,
        update_available,
    })
}

fn current_version(bin: &Path, id: ToolId) -> Option<String> {
    let output = Command::new(bin.join(id.filename()))
        .arg(id.version_argument())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    stdout
        .lines()
        .chain(stderr.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .and_then(|line| match id {
            ToolId::Ffmpeg | ToolId::Ffprobe => line.split_whitespace().nth(2),
            ToolId::Deno => line.strip_prefix("deno "),
            ToolId::Ytdlp => Some(line),
        })
        .map(str::to_string)
}

fn emit(app: &AppHandle, id: ToolId, phase: &str, received: u64, total: Option<u64>) {
    let _ = app.emit(
        "downly-tools-progress",
        ToolProgress {
            tool: id.key().into(),
            phase: phase.into(),
            received,
            total,
        },
    );
}

async fn release_info(id: ToolId) -> Result<ReleaseInfo, String> {
    let (url, name, version, tag, checksum_url, max_bytes, archive) = match id {
        ToolId::Ytdlp => {
            let release = get_release(YTDLP_REPO).await?;
            let tag = string_field(&release, "tag_name")?;
            let url = asset_url(&release, "yt-dlp.exe")?;
            let sums = asset_url(&release, "SHA2-256SUMS")?;
            (
                url,
                "yt-dlp.exe".to_string(),
                tag.clone(),
                tag,
                sums,
                128 * 1024 * 1024,
                false,
            )
        }
        ToolId::Deno => {
            let release = get_release(DENO_REPO).await?;
            let tag = string_field(&release, "tag_name")?;
            let name = "deno-x86_64-pc-windows-msvc.zip";
            (
                asset_url(&release, name)?,
                name.into(),
                tag.trim_start_matches('v').into(),
                tag.clone(),
                asset_url(&release, &format!("{name}.sha256sum"))?,
                100 * 1024 * 1024,
                true,
            )
        }
        ToolId::Ffmpeg | ToolId::Ffprobe => {
            let release = get_release(FFMPEG_REPO).await?;
            let tag = string_field(&release, "tag_name")?;
            let name = ffmpeg_asset_name(&release)?;
            let version = name
                .strip_prefix("ffmpeg-n")
                .and_then(|rest| rest.split("-latest").next())
                .ok_or_else(|| "FFmpeg release asset has an unknown name".to_string())?
                .to_string();
            (
                asset_url(&release, &name)?,
                name,
                version,
                tag,
                asset_url(&release, "checksums.sha256")?,
                MAX_FFMPEG_ARCHIVE_BYTES,
                true,
            )
        }
    };
    Ok(ReleaseInfo {
        id: id.executable(),
        version,
        tag,
        asset_name: name,
        asset_url: url,
        checksum_url,
        max_bytes,
        archive,
    })
}

async fn get_release(url: &str) -> Result<Value, String> {
    let text = net::get_text(url).await?;
    serde_json::from_str(&text).map_err(|err| err.to_string())
}

fn string_field(value: &Value, name: &str) -> Result<String, String> {
    value
        .get(name)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
        .ok_or_else(|| format!("release field {name} is missing"))
}

fn asset_url(release: &Value, name: &str) -> Result<String, String> {
    release
        .get("assets")
        .and_then(Value::as_array)
        .and_then(|assets| {
            assets
                .iter()
                .find(|asset| asset.get("name").and_then(Value::as_str) == Some(name))
        })
        .and_then(|asset| asset.get("browser_download_url"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("release asset {name} is missing"))
}

fn ffmpeg_asset_name(release: &Value) -> Result<String, String> {
    let assets = release
        .get("assets")
        .and_then(Value::as_array)
        .ok_or_else(|| "FFmpeg release assets are missing".to_string())?;
    let mut versions = assets
        .iter()
        .filter_map(|asset| asset.get("name").and_then(Value::as_str))
        .filter_map(|name| {
            let version = name.strip_prefix("ffmpeg-n")?.split("-latest").next()?;
            let suffix = format!("-latest-win64-gpl-{version}.zip");
            if !name.ends_with(&suffix) || version.split('.').count() != 2 {
                return None;
            }
            Some((version.to_string(), name.to_string()))
        })
        .collect::<Vec<_>>();
    versions.sort_by(|left, right| compare_dotted(&left.0, &right.0));
    versions
        .pop()
        .map(|(_, name)| name)
        .ok_or_else(|| "stable Windows FFmpeg asset is missing".into())
}

fn compare_dotted(left: &str, right: &str) -> std::cmp::Ordering {
    let left = left.split('.').filter_map(|part| part.parse::<u64>().ok());
    let right = right.split('.').filter_map(|part| part.parse::<u64>().ok());
    let mut left = left;
    let mut right = right;
    loop {
        match (left.next(), right.next()) {
            (Some(a), Some(b)) if a == b => continue,
            (Some(a), Some(b)) => return a.cmp(&b),
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (None, None) => return std::cmp::Ordering::Equal,
        }
    }
}

async fn install_release(app: &AppHandle, bin: &Path, release: &ReleaseInfo) -> Result<(), String> {
    let temp_dir = bin.join(".install");
    fs::create_dir_all(&temp_dir).map_err(|err| err.to_string())?;
    let _cleanup = InstallCleanup(temp_dir.clone());
    let staged_files = prepare_release(app, bin, &temp_dir, release).await?;
    replace_many(staged_files)
}

async fn prepare_release(
    app: &AppHandle,
    bin: &Path,
    temp_dir: &Path,
    release: &ReleaseInfo,
) -> Result<Vec<(PathBuf, PathBuf)>, String> {
    let archive_path = temp_dir.join(format!("{}.download", release.id.key()));
    let checksum = net::get_text(&release.checksum_url).await?;
    emit(app, release.id, "downloading", 0, None);
    net::download_to_file(
        &release.asset_url,
        &archive_path,
        release.max_bytes,
        |received, total| {
            emit(app, release.id, "downloading", received, total);
        },
    )
    .await?;
    emit(app, release.id, "verifying", 0, None);
    let expected = checksum_for(&checksum, &release.asset_name)?;
    if let Err(error) = verify_file_sha256(&archive_path, &expected) {
        let _ = fs::remove_file(&archive_path);
        return Err(error);
    }
    emit(app, release.id, "installing", 0, None);
    let mut staged_files = if release.archive {
        stage_archive(&archive_path, &temp_dir, bin, release.id)?
    } else {
        stage_executable(&archive_path, &temp_dir, bin, release.id)?
    };
    let release_path = temp_dir.join(format!("{}.release.json", release.id.key()));
    write_release_metadata(&release_path, &release.tag, &expected)?;
    staged_files.push((release_path, installed_path(bin, release.id)));
    let _ = fs::remove_file(&archive_path);
    Ok(staged_files)
}

fn checksum_for(text: &str, filename: &str) -> Result<String, String> {
    let hash_field = text.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        if key.trim().eq_ignore_ascii_case("Hash") {
            let value = value.trim();
            (value.len() == 64 && value.chars().all(|ch| ch.is_ascii_hexdigit()))
                .then(|| value.to_ascii_lowercase())
        } else {
            None
        }
    });
    let hash = hash_field.or_else(|| {
        text.lines().find_map(|line| {
            let mut parts = line.split_whitespace();
            let first = parts.next()?;
            let second = parts.next();
            let name = second.map(|name| name.trim_start_matches('*'));
            if name.is_none_or(|name| name.rsplit(['/', '\\']).next() == Some(filename))
                && first.len() == 64
                && first.chars().all(|ch| ch.is_ascii_hexdigit())
            {
                Some(first.to_ascii_lowercase())
            } else {
                None
            }
        })
    });
    hash.ok_or_else(|| format!("SHA-256 for {filename} is missing"))
}

fn file_sha256(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|err| err.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|err| err.to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn verify_file_sha256(path: &Path, expected: &str) -> Result<(), String> {
    if file_sha256(path)?.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err("download checksum does not match the release".into())
    }
}

fn stage_executable(
    source: &Path,
    temp_dir: &Path,
    bin: &Path,
    id: ToolId,
) -> Result<Vec<(PathBuf, PathBuf)>, String> {
    let staged = temp_dir.join(id.filename());
    fs::copy(source, &staged).map_err(|err| err.to_string())?;
    validate_executable(&staged, id)?;
    Ok(vec![(staged, bin.join(id.filename()))])
}

fn stage_archive(
    source: &Path,
    temp_dir: &Path,
    bin: &Path,
    id: ToolId,
) -> Result<Vec<(PathBuf, PathBuf)>, String> {
    let staged_files = extract_archive(source, temp_dir, bin, id)?;
    for (staged, target) in &staged_files {
        let id = if target.file_name().and_then(|name| name.to_str())
            == Some(ToolId::Ffprobe.filename())
        {
            ToolId::Ffprobe
        } else if target.file_name().and_then(|name| name.to_str()) == Some(ToolId::Deno.filename())
        {
            ToolId::Deno
        } else {
            ToolId::Ffmpeg
        };
        validate_executable(staged, id)?;
    }
    Ok(staged_files)
}

fn extract_archive(
    source: &Path,
    temp_dir: &Path,
    bin: &Path,
    id: ToolId,
) -> Result<Vec<(PathBuf, PathBuf)>, String> {
    fs::create_dir_all(temp_dir).map_err(|err| err.to_string())?;
    let archive_file = File::open(source).map_err(|err| err.to_string())?;
    let mut archive = ZipArchive::new(archive_file).map_err(|err| err.to_string())?;
    let names: &[ToolId] = match id {
        ToolId::Ffmpeg => &[ToolId::Ffmpeg, ToolId::Ffprobe],
        ToolId::Deno => &[ToolId::Deno],
        _ => return Err("unsupported tool archive".into()),
    };
    let mut staged_files = Vec::new();
    for target in names {
        let index = (0..archive.len())
            .find(|index| {
                archive
                    .by_index(*index)
                    .ok()
                    .and_then(|file| file.enclosed_name())
                    .and_then(|path| {
                        path.file_name()
                            .map(|name| name.to_string_lossy().into_owned())
                    })
                    .is_some_and(|name| name == target.filename())
            })
            .ok_or_else(|| format!("{} is missing from the release archive", target.filename()))?;
        let entry = archive.by_index(index).map_err(|err| err.to_string())?;
        if entry.size() == 0 || entry.size() > MAX_EXE_BYTES {
            return Err(format!("{} has an invalid size", target.filename()));
        }
        let staged = temp_dir.join(target.filename());
        let mut output = File::create(&staged).map_err(|err| err.to_string())?;
        let declared_size = entry.size();
        let mut limited = entry.take(MAX_EXE_BYTES + 1);
        let copied = std::io::copy(&mut limited, &mut output).map_err(|err| err.to_string())?;
        if copied != declared_size || copied > MAX_EXE_BYTES {
            return Err(format!(
                "{} has an invalid extracted size",
                target.filename()
            ));
        }
        output.sync_all().map_err(|err| err.to_string())?;
        drop(output);
        staged_files.push((staged, bin.join(target.filename())));
    }
    Ok(staged_files)
}

fn validate_executable(path: &Path, id: ToolId) -> Result<(), String> {
    let output = Command::new(path)
        .arg(id.version_argument())
        .output()
        .map_err(|err| format!("could not start {}: {err}", id.key()))?;
    if !output.status.success() || (output.stdout.is_empty() && output.stderr.is_empty()) {
        return Err(format!("{} failed its version check", id.key()));
    }
    Ok(())
}

fn replace_many(files: Vec<(PathBuf, PathBuf)>) -> Result<(), String> {
    let mut backups = Vec::new();
    for (staged, target) in &files {
        let backup = target.with_extension("exe.bak");
        let backup_path = if target.exists() {
            let _ = fs::remove_file(&backup);
            if let Err(error) = fs::rename(target, &backup) {
                rollback(&backups);
                return Err(format!("could not back up {}: {error}", target.display()));
            }
            Some(backup.clone())
        } else {
            None
        };
        backups.push((backup_path, target.clone()));
        if let Err(error) = crate::store::replace_file(staged, target) {
            rollback(&backups);
            return Err(format!("could not install {}: {error}", target.display()));
        }
    }
    for (backup, _) in &backups {
        if let Some(backup) = backup {
            let _ = fs::remove_file(backup);
        }
    }
    Ok(())
}

fn rollback(changes: &[(Option<PathBuf>, PathBuf)]) {
    for (backup, target) in changes.iter().rev() {
        let _ = fs::remove_file(target);
        if let Some(backup) = backup {
            let _ = fs::rename(backup, target);
        }
    }
}

fn installed_path(bin: &Path, id: ToolId) -> PathBuf {
    bin.join(format!("{}.release.json", id.key()))
}

fn read_installed_release(bin: &Path, id: ToolId) -> Option<InstalledRelease> {
    serde_json::from_slice(&fs::read(installed_path(bin, id)).ok()?).ok()
}

fn write_release_metadata(path: &Path, tag: &str, sha256: &str) -> Result<(), String> {
    let bytes = serde_json::to_vec(&InstalledRelease {
        tag: tag.into(),
        sha256: sha256.into(),
    })
    .map_err(|err| err.to_string())?;
    let mut file = File::create(path).map_err(|err| err.to_string())?;
    file.write_all(&bytes).map_err(|err| err.to_string())?;
    file.sync_all().map_err(|err| err.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        ToolId, checksum_for, compare_dotted, extract_archive, ffmpeg_asset_name,
        verify_file_sha256,
    };
    use serde_json::json;
    use std::fs::{self, File};
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};
    use zip::ZipWriter;
    use zip::write::SimpleFileOptions;

    fn scratch() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "downly-tools-{}-{}",
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
    fn picks_latest_stable_ffmpeg_asset_and_ignores_master_and_shared() {
        let release = json!({"assets":[
            {"name":"ffmpeg-master-latest-win64-gpl.zip"},
            {"name":"ffmpeg-n8.1-latest-win64-gpl-8.1.zip"},
            {"name":"ffmpeg-n9.0-latest-win64-gpl-9.0-shared.zip"},
            {"name":"ffmpeg-n9.0-latest-win64-gpl-9.0.zip"}
        ]});
        assert_eq!(
            ffmpeg_asset_name(&release).unwrap(),
            "ffmpeg-n9.0-latest-win64-gpl-9.0.zip"
        );
    }

    #[test]
    fn matches_checksum_by_exact_asset_name() {
        let hash = "a".repeat(64);
        let sums = format!("{hash} *folder/ffmpeg.zip\n{}  other.zip", "b".repeat(64));
        assert_eq!(checksum_for(&sums, "ffmpeg.zip").unwrap(), hash);
        assert!(checksum_for(&sums, "missing.zip").is_err());
    }

    #[test]
    fn reads_deno_checksum_sidecar_fields() {
        let sums = format!(
            "Algorithm : SHA256\nHash      : {}\nPath      : deno.zip",
            "C".repeat(64)
        );
        assert_eq!(checksum_for(&sums, "deno.zip").unwrap(), "c".repeat(64));
    }

    #[test]
    fn status_rejects_missing_and_broken_executables() {
        let root = scratch();
        let bin = root.join("bin");
        fs::create_dir_all(&bin).unwrap();
        assert!(super::status(&bin, false).is_err());

        for id in ToolId::ALL {
            fs::write(bin.join(id.filename()), b"not a Windows executable").unwrap();
        }
        assert!(super::status(&bin, false).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn orders_ffmpeg_release_branches_numerically() {
        assert!(compare_dotted("9.0", "8.1").is_gt());
        assert!(compare_dotted("9.0", "10.0").is_lt());
        assert_eq!(ToolId::Ffprobe.executable(), ToolId::Ffmpeg);
    }

    #[test]
    fn extracts_only_required_ffmpeg_files_and_errors_when_one_is_missing() {
        let root = scratch();
        let archive_path = root.join("tools.zip");
        let mut archive = ZipWriter::new(File::create(&archive_path).unwrap());
        archive
            .start_file("package/bin/ffmpeg.exe", SimpleFileOptions::default())
            .unwrap();
        archive.write_all(b"ffmpeg").unwrap();
        archive
            .start_file("package/bin/ffprobe.exe", SimpleFileOptions::default())
            .unwrap();
        archive.write_all(b"ffprobe").unwrap();
        archive
            .start_file("package/readme.txt", SimpleFileOptions::default())
            .unwrap();
        archive.write_all(b"ignore").unwrap();
        archive.finish().unwrap();
        let staging = root.join("staging");
        let files =
            extract_archive(&archive_path, &staging, &root.join("bin"), ToolId::Ffmpeg).unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(fs::read(&files[0].0).unwrap(), b"ffmpeg");
        assert_eq!(fs::read(&files[1].0).unwrap(), b"ffprobe");
        assert!(!staging.join("readme.txt").exists());
        let _ = fs::remove_dir_all(root);

        let root = scratch();
        let archive_path = root.join("missing.zip");
        let mut archive = ZipWriter::new(File::create(&archive_path).unwrap());
        archive
            .start_file("package/bin/ffmpeg.exe", SimpleFileOptions::default())
            .unwrap();
        archive.write_all(b"ffmpeg").unwrap();
        archive.finish().unwrap();
        assert!(
            extract_archive(
                &archive_path,
                &root.join("staging"),
                &root.join("bin"),
                ToolId::Ffmpeg
            )
            .is_err()
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn failed_batch_update_preserves_old_files() {
        let root = scratch();
        let file = root.join("download.zip");
        fs::write(&file, b"archive").unwrap();
        assert!(verify_file_sha256(&file, &"0".repeat(64)).is_err());
        let files = [
            ("yt-dlp.exe", "yt-dlp.release.json"),
            ("ffmpeg.exe", "ffmpeg.release.json"),
            ("ffprobe.exe", "ffprobe.release.json"),
            ("deno.exe", "deno.release.json"),
        ];
        let mut replacements = Vec::new();
        for (name, metadata) in files {
            fs::write(root.join(name), format!("old-{name}")).unwrap();
            fs::write(root.join(metadata), format!("old-{metadata}")).unwrap();
            let staged = root.join(format!("new-{name}"));
            fs::write(&staged, format!("new-{name}")).unwrap();
            replacements.push((staged, root.join(name)));
            let staged_metadata = root.join(format!("new-{metadata}"));
            fs::write(&staged_metadata, format!("new-{metadata}")).unwrap();
            replacements.push((staged_metadata, root.join(metadata)));
        }
        let missing = root.join("missing.exe");
        replacements.push((missing, root.join("deno.extra.json")));
        let failed = super::replace_many(replacements);
        assert!(failed.is_err());
        for (name, metadata) in files {
            assert_eq!(
                fs::read(root.join(name)).unwrap(),
                format!("old-{name}").as_bytes()
            );
            assert_eq!(
                fs::read(root.join(metadata)).unwrap(),
                format!("old-{metadata}").as_bytes()
            );
        }

        let _ = fs::remove_dir_all(root);
    }
}
