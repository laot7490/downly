use crate::engine::args::{download_args, probe_playlist_args, probe_video_args, version_args};
use crate::engine::bins::{
    ToolPaths, ffmpeg_filename, resolve_tools, resolve_ytdlp, ytdlp_filename,
};
use crate::engine::classify::{RejectReason, UrlKind, classify_url, screen_url};
use crate::engine::cleanup::{choose_output, delete_cancelled, delete_part_files, snapshot_id};
use crate::engine::deno::{DENO_ZIP_URL, install_deno_zip, resolve_deno};
use crate::engine::filename::file_contains_id;
use crate::engine::format::{FormatKind, Preset, Selection};
use crate::engine::media::{PlaylistSummary, ProbeOutcome, parse_probe, summary_from_outcome};
use crate::engine::proc::{Capture, capture};
use crate::engine::progress::{destination_path, parse_progress, printed_path};
use crate::engine::queue::{EnqueueItem, EnqueueOutcome, HistoryStatus, Item, Snapshot};
use crate::engine::retry::{MAX_ATTEMPTS, should_retry};
use crate::state::{Downly, lock};
use crate::store;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub fn fallback_downloads() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .unwrap_or_else(std::env::temp_dir)
        .join("Downloads")
}

pub fn probe(app: &AppHandle, url: String) -> Result<ProbeOutcome, String> {
    match screen_url(&url) {
        Err(reason) => Ok(ProbeOutcome::Rejected { reason }),
        Ok(UrlKind::Playlist) => run_probe(app, &url, true),
        Ok(UrlKind::Video | UrlKind::Mix) => run_probe(app, &url, false),
        Ok(_) => Ok(ProbeOutcome::Rejected {
            reason: RejectReason::Unsupported,
        }),
    }
}

pub fn expand_playlist(app: &AppHandle, url: String) -> Result<PlaylistSummary, String> {
    match classify_url(&url) {
        UrlKind::Playlist => {}
        UrlKind::Channel => return Err(RejectReason::Channel.as_str().into()),
        UrlKind::Mix => return Err("mix is a single video".into()),
        UrlKind::Other => {
            return Err(screen_url(&url)
                .err()
                .unwrap_or(RejectReason::Unsupported)
                .as_str()
                .into());
        }
        UrlKind::Video => return Err("not a playlist".into()),
    }
    let ytdlp = ytdlp_path(app)?;
    let deno = js_runtime(app);
    let captured = run_retry(
        app,
        &ytdlp,
        &probe_playlist_args(&url, deno.as_deref()),
        false,
        &AtomicBool::new(false),
        |_| {},
    )?;
    if captured.cancelled {
        return Err("cancelled".into());
    }
    if captured.code != 0 {
        return Err(captured.error_text());
    }
    summary_from_outcome(parse_probe(&captured.stdout, &url)?)
}

pub fn enqueue(app: &AppHandle, items: Vec<EnqueueItem>) -> Result<Vec<EnqueueOutcome>, String> {
    let downly = app.state::<Downly>();
    let outcomes = {
        let mut engine = lock(&downly.engine);
        let dir = PathBuf::from(&engine.settings.download_dir);
        let outcomes = engine.enqueue(items, &dir);
        store::save(&downly.data_dir, &engine)?;
        outcomes
    };
    publish(app);
    Ok(outcomes)
}

pub fn update_queue_metadata(
    app: &AppHandle,
    id: String,
    title: String,
    thumbnail: Option<String>,
) -> Result<(), String> {
    let downly = app.state::<Downly>();
    let mut engine = lock(&downly.engine);
    if !engine.update_metadata(&id, &title, thumbnail) {
        return Ok(());
    }
    store::save(&downly.data_dir, &engine)?;
    let snap = engine.snapshot();
    drop(engine);
    emit(app, &snap);
    Ok(())
}

pub fn start(app: &AppHandle) -> Result<(), String> {
    let _tools = require_tools(app)?;
    {
        let downly = app.state::<Downly>();
        let mut engine = lock(&downly.engine);
        if !engine.begin() {
            return Ok(());
        }
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        drive(app).await;
    });
    Ok(())
}

pub fn stop(app: &AppHandle) -> Result<(), String> {
    let downly = app.state::<Downly>();
    {
        let mut engine = lock(&downly.engine);
        engine.request_stop();
    }
    if let Some(flag) = lock(&downly.download_cancel).clone() {
        flag.store(true, Ordering::SeqCst);
    }
    downly.procs.kill_downloads();
    Ok(())
}

pub fn cancel_item(app: &AppHandle, id: String) -> Result<(), String> {
    let downly = app.state::<Downly>();
    let active = {
        let mut engine = lock(&downly.engine);
        let active = engine.cancel_item(&id)?;
        store::save(&downly.data_dir, &engine)?;
        active
    };
    if active {
        if let Some(flag) = lock(&downly.download_cancel).clone() {
            flag.store(true, Ordering::SeqCst);
        }
        downly.procs.kill_downloads();
    }
    publish(app);
    Ok(())
}

pub fn remove(app: &AppHandle, id: String) -> Result<(), String> {
    let downly = app.state::<Downly>();
    {
        let mut engine = lock(&downly.engine);
        engine.remove_pending(&id)?;
        store::save(&downly.data_dir, &engine)?;
    }
    publish(app);
    Ok(())
}

pub fn state(app: &AppHandle) -> Snapshot {
    let downly = app.state::<Downly>();
    lock(&downly.engine).snapshot()
}

pub fn set_download_dir(app: &AppHandle, path: String) -> Result<(), String> {
    let dir = store::prepare_dir(&path)?;
    let downly = app.state::<Downly>();
    {
        let mut engine = lock(&downly.engine);
        engine.settings.download_dir = dir.to_string_lossy().into_owned();
        store::save(&downly.data_dir, &engine)?;
    }
    publish(app);
    Ok(())
}

pub fn retry_history(app: &AppHandle, id: String) -> Result<(), String> {
    let downly = app.state::<Downly>();
    {
        let mut engine = lock(&downly.engine);
        engine.retry(&id)?;
        store::save(&downly.data_dir, &engine)?;
    }
    publish(app);
    Ok(())
}

pub fn remove_history(app: &AppHandle, id: String) -> Result<(), String> {
    let downly = app.state::<Downly>();
    {
        let mut engine = lock(&downly.engine);
        engine.remove_history(&id)?;
        store::save(&downly.data_dir, &engine)?;
    }
    publish(app);
    Ok(())
}

pub fn archive_session(app: &AppHandle, id: String) -> Result<(), String> {
    let downly = app.state::<Downly>();
    {
        let mut engine = lock(&downly.engine);
        engine.archive_session_item(&id)?;
        store::save(&downly.data_dir, &engine)?;
    }
    publish(app);
    Ok(())
}

pub fn archive_session_all(app: &AppHandle) -> Result<(), String> {
    let downly = app.state::<Downly>();
    {
        let mut engine = lock(&downly.engine);
        engine.archive_session_all();
        store::save(&downly.data_dir, &engine)?;
    }
    publish(app);
    Ok(())
}

pub fn retry_failed_session(app: &AppHandle) -> Result<usize, String> {
    let downly = app.state::<Downly>();
    let retried = {
        let mut engine = lock(&downly.engine);
        let retried = engine.retry_failed_session();
        if retried > 0 {
            store::save(&downly.data_dir, &engine)?;
        }
        retried
    };
    if retried > 0 {
        publish(app);
    }
    Ok(retried)
}

pub fn archive_completed_session_all(app: &AppHandle) -> Result<usize, String> {
    let downly = app.state::<Downly>();
    let archived = {
        let mut engine = lock(&downly.engine);
        let archived = engine.archive_completed_session_all();
        if archived > 0 {
            store::save(&downly.data_dir, &engine)?;
        }
        archived
    };
    if archived > 0 {
        publish(app);
    }
    Ok(archived)
}

pub fn delete_completed_session_item(app: &AppHandle, id: String) -> Result<(), String> {
    let downly = app.state::<Downly>();
    {
        let mut engine = lock(&downly.engine);
        let item = engine
            .session
            .iter()
            .find(|item| item.id == id && item.status == HistoryStatus::Success)
            .ok_or_else(|| "not found".to_string())?;
        let path = item
            .path
            .as_deref()
            .ok_or_else(|| "download path not found".to_string())?;
        match std::fs::remove_file(path) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
            Err(err) => return Err(err.to_string()),
        }
        engine.remove_completed_session_item(&id)?;
        store::save(&downly.data_dir, &engine)?;
    }
    publish(app);
    Ok(())
}

pub fn clear_history(app: &AppHandle) -> Result<(), String> {
    let downly = app.state::<Downly>();
    {
        let mut engine = lock(&downly.engine);
        engine.clear_history();
        store::save(&downly.data_dir, &engine)?;
    }
    publish(app);
    Ok(())
}

pub fn ytdlp_info(app: &AppHandle) -> Result<YtdlpInfo, String> {
    let ytdlp = ytdlp_path(app)?;
    let captured = run_retry(
        app,
        &ytdlp,
        &version_args(),
        false,
        &AtomicBool::new(false),
        |_| {},
    )?;
    if captured.code != 0 {
        return Err(captured.error_text());
    }
    let version = extract_ytdlp_version(&captured.stdout, &captured.stderr)
        .ok_or_else(|| "yt-dlp version missing".to_string())?;
    Ok(YtdlpInfo {
        version,
        path: ytdlp.to_string_lossy().into_owned(),
    })
}

fn extract_ytdlp_version(stdout: &str, stderr: &str) -> Option<String> {
    for line in stdout.lines().chain(stderr.lines()) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(version) = find_ytdlp_version(line) {
            return Some(version);
        }
    }
    stdout
        .lines()
        .chain(stderr.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn find_ytdlp_version(line: &str) -> Option<String> {
    let bytes = line.as_bytes();
    let mut index = 0;
    while index + 8 <= bytes.len() {
        if bytes[index].is_ascii_digit()
            && bytes.get(index + 1).is_some_and(|b| b.is_ascii_digit())
            && bytes.get(index + 2).is_some_and(|b| b.is_ascii_digit())
            && bytes.get(index + 3).is_some_and(|b| b.is_ascii_digit())
            && bytes.get(index + 4) == Some(&b'.')
        {
            let slice = &line[index..];
            let end = slice
                .find(|ch: char| !(ch.is_ascii_digit() || ch == '.'))
                .unwrap_or(slice.len());
            let candidate = &slice[..end];
            if candidate.split('.').count() >= 3
                && candidate
                    .split('.')
                    .all(|part| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_digit()))
            {
                return Some(candidate.to_string());
            }
        }
        index += 1;
    }
    None
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct YtdlpInfo {
    pub version: String,
    pub path: String,
}

pub fn shutdown(app: &AppHandle) {
    let Some(downly) = app.try_state::<Downly>() else {
        return;
    };
    let active = {
        let mut engine = lock(&downly.engine);
        engine.cancel = true;
        engine.archive_session_all();
        let active = engine
            .active
            .as_ref()
            .map(|item| (engine.settings.download_dir.clone(), item.video_id.clone()));
        let _ = store::save(&downly.data_dir, &engine);
        active
    };
    if let Some(flag) = lock(&downly.download_cancel).clone() {
        flag.store(true, Ordering::SeqCst);
    }
    downly.procs.kill_all();
    if let Some((dir, video_id)) = active {
        delete_part_files(Path::new(&dir), &video_id);
    }
}

async fn drive(app: AppHandle) {
    loop {
        let item = {
            let downly = app.state::<Downly>();
            let mut engine = lock(&downly.engine);
            if engine.cancel || engine.pending.is_empty() {
                engine.end_run();
                let _ = store::save(&downly.data_dir, &engine);
                let snap = engine.snapshot();
                drop(engine);
                emit(&app, &snap);
                break;
            }
            let item = engine.take_next();
            let _ = store::save(&downly.data_dir, &engine);
            let snap = engine.snapshot();
            drop(engine);
            emit(&app, &snap);
            item
        };
        let Some(item) = item else {
            let downly = app.state::<Downly>();
            let mut engine = lock(&downly.engine);
            engine.end_run();
            let _ = store::save(&downly.data_dir, &engine);
            let snap = engine.snapshot();
            drop(engine);
            emit(&app, &snap);
            break;
        };
        let outcome = match tauri::async_runtime::spawn_blocking({
            let app = app.clone();
            move || run_item(&app, &item)
        })
        .await
        {
            Ok(outcome) => outcome,
            Err(err) => ItemOutcome::failed(err.to_string()),
        };
        let downly = app.state::<Downly>();
        let stop = {
            let mut engine = lock(&downly.engine);
            engine.finish_active(outcome.status, outcome.path, outcome.error.clone());
            let missing = outcome
                .error
                .as_deref()
                .is_some_and(|err| err == "yt-dlp not found" || err == "ffmpeg not found");
            let stop = engine.cancel || missing;
            if stop {
                engine.end_run();
            }
            let _ = store::save(&downly.data_dir, &engine);
            let snap = engine.snapshot();
            drop(engine);
            emit(&app, &snap);
            stop
        };
        if stop {
            break;
        }
    }
}

fn run_item(app: &AppHandle, item: &Item) -> ItemOutcome {
    let downly = app.state::<Downly>();
    let (dir, flag) = {
        let engine = lock(&downly.engine);
        let dir = PathBuf::from(engine.settings.download_dir.clone());
        let flag = Arc::new(AtomicBool::new(engine.cancel || engine.cancel_current));
        *lock(&downly.download_cancel) = Some(Arc::clone(&flag));
        (dir, flag)
    };
    let _clear = ClearFlag {
        slot: &downly.download_cancel,
    };
    if flag.load(Ordering::SeqCst) {
        return ItemOutcome::cancelled();
    }
    if let Err(err) = std::fs::create_dir_all(&dir) {
        return ItemOutcome::failed(err.to_string());
    }
    let tools = match require_tools(app) {
        Ok(tools) => tools,
        Err(err) => return ItemOutcome::failed(err),
    };
    match preflight(app, &tools.ytdlp, &item.url, &flag) {
        Preflight::Cancelled => return ItemOutcome::cancelled(),
        Preflight::Stop(reason) => return ItemOutcome::failed(reason.as_str()),
        Preflight::Go => {}
    }
    if flag.load(Ordering::SeqCst) {
        return ItemOutcome::cancelled();
    }
    let deno = js_runtime(app);
    let args = match download_args(
        &item.selection,
        &dir,
        &tools.ffmpeg_dir,
        &item.url,
        deno.as_deref(),
        file_contains_id(&dir, &item.video_id).then_some(item.id.as_str()),
    ) {
        Ok(args) => args,
        Err(err) => return ItemOutcome::failed(err),
    };
    let before = snapshot_id(&dir, &item.video_id);
    let mut tracked = Vec::new();
    let mut final_path = None;
    let captured = run_retry(app, &tools.ytdlp, &args, true, &flag, |line| {
        note_line(app, line, &mut tracked, &mut final_path);
    });
    match captured {
        Ok(captured) if captured.cancelled || flag.load(Ordering::SeqCst) => {
            delete_cancelled(&dir, &item.video_id, &before, &tracked);
            ItemOutcome::cancelled()
        }
        Ok(_) => {
            let output = choose_output(final_path.as_deref(), &tracked, &dir, &item.video_id);
            if selection_requires_mp4(&item.selection) {
                let Some(output) = output else {
                    return ItemOutcome::failed("download output not found");
                };
                match ensure_mp4(
                    &downly.procs,
                    &tools.ffmpeg_dir,
                    Path::new(&output),
                    &item.id,
                    &flag,
                ) {
                    Ok(path) => ItemOutcome::success(Some(path)),
                    Err(outcome) if outcome.cancelled => {
                        delete_cancelled(&dir, &item.video_id, &before, &tracked);
                        outcome
                    }
                    Err(outcome) => outcome,
                }
            } else {
                ItemOutcome::success(output)
            }
        }
        Err(err) => ItemOutcome::failed(err),
    }
}

fn selection_requires_mp4(selection: &Selection) -> bool {
    match selection {
        Selection::Preset { preset, .. } => matches!(
            preset,
            Preset::VideoBest
                | Preset::Video8k
                | Preset::Video4k
                | Preset::Video2k
                | Preset::Video1080
                | Preset::Video720
                | Preset::Video480
                | Preset::Video360
                | Preset::Video240
                | Preset::Video144
        ),
        Selection::Format { kind, .. } => matches!(kind, FormatKind::Video | FormatKind::Mixed),
    }
}

fn ensure_mp4(
    procs: &crate::engine::proc::ProcRegistry,
    ffmpeg_dir: &Path,
    source: &Path,
    item_id: &str,
    cancel: &AtomicBool,
) -> Result<String, ItemOutcome> {
    if source
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("mp4"))
    {
        return Ok(source.to_string_lossy().into_owned());
    }
    let target = source.with_extension("mp4");
    let stem = target
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("video");
    let temp = target.with_file_name(format!("{stem}.downly-{item_id}.tmp.mp4"));
    let ffmpeg = ffmpeg_dir.join(ffmpeg_filename());
    let remux_args = mp4_conversion_args(source, &temp, false);
    let remux =
        capture(procs, true, &ffmpeg, &remux_args, cancel, |_| {}).map_err(ItemOutcome::failed)?;
    if remux.cancelled {
        let _ = std::fs::remove_file(&temp);
        return Err(ItemOutcome::cancelled());
    }
    if remux.code != 0 {
        let _ = std::fs::remove_file(&temp);
        let recode_args = mp4_conversion_args(source, &temp, true);
        let recode = capture(procs, true, &ffmpeg, &recode_args, cancel, |_| {})
            .map_err(ItemOutcome::failed)?;
        if recode.cancelled {
            let _ = std::fs::remove_file(&temp);
            return Err(ItemOutcome::cancelled());
        }
        if recode.code != 0 {
            let _ = std::fs::remove_file(&temp);
            return Err(ItemOutcome::failed(format!(
                "MP4 conversion failed: {}",
                recode.error_text()
            )));
        }
    }
    if cancel.load(Ordering::SeqCst) {
        let _ = std::fs::remove_file(&temp);
        return Err(ItemOutcome::cancelled());
    }
    std::fs::rename(&temp, &target).map_err(|err| ItemOutcome::failed(err.to_string()))?;
    let _ = std::fs::remove_file(source);
    Ok(target.to_string_lossy().into_owned())
}

fn mp4_conversion_args(source: &Path, temp: &Path, recode: bool) -> Vec<String> {
    let mut args = vec![
        "-y".into(),
        "-i".into(),
        source.to_string_lossy().into_owned(),
        "-map".into(),
        "0:v?".into(),
        "-map".into(),
        "0:a?".into(),
        "-sn".into(),
        "-dn".into(),
    ];
    if recode {
        args.extend([
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            "medium".into(),
            "-crf".into(),
            "20".into(),
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            "192k".into(),
            "-movflags".into(),
            "+faststart".into(),
        ]);
    } else {
        args.extend(["-c".into(), "copy".into()]);
    }
    args.push(temp.to_string_lossy().into_owned());
    args
}

fn preflight(app: &AppHandle, ytdlp: &Path, url: &str, cancel: &AtomicBool) -> Preflight {
    let deno = js_runtime(app);
    let captured = match run_retry(
        app,
        ytdlp,
        &probe_video_args(url, deno.as_deref()),
        true,
        cancel,
        |_| {},
    ) {
        Ok(captured) => captured,
        Err(_) => return Preflight::Go,
    };
    if captured.cancelled {
        return Preflight::Cancelled;
    }
    if captured.code != 0 {
        return Preflight::Go;
    }
    match parse_probe(&captured.stdout, url) {
        Ok(ProbeOutcome::Rejected {
            reason: RejectReason::Live,
        }) => Preflight::Stop(RejectReason::Live),
        Ok(ProbeOutcome::Playlist { .. }) => Preflight::Stop(RejectReason::AddPlaylistsOnTheirOwn),
        _ => Preflight::Go,
    }
}

fn run_probe(app: &AppHandle, url: &str, playlist: bool) -> Result<ProbeOutcome, String> {
    let ytdlp = ytdlp_path(app)?;
    let deno = js_runtime(app);
    let args = if playlist {
        probe_playlist_args(url, deno.as_deref())
    } else {
        probe_video_args(url, deno.as_deref())
    };
    let captured = run_retry(app, &ytdlp, &args, false, &AtomicBool::new(false), |_| {})?;
    if captured.cancelled {
        return Err("cancelled".into());
    }
    if captured.code != 0 {
        return Err(captured.error_text());
    }
    parse_probe(&captured.stdout, url)
}

fn run_retry(
    app: &AppHandle,
    exe: &Path,
    args: &[String],
    download: bool,
    cancel: &AtomicBool,
    mut on_line: impl FnMut(&str),
) -> Result<Capture, String> {
    let mut attempt = 0u32;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Ok(empty_cancel());
        }
        attempt += 1;
        let downly = app.state::<Downly>();
        let captured = capture(&downly.procs, download, exe, args, cancel, &mut on_line)?;
        if captured.cancelled {
            return Ok(captured);
        }
        if captured.code == 0 {
            return Ok(captured);
        }
        if should_retry(attempt, &captured.combined()) && attempt < MAX_ATTEMPTS {
            if !pause(cancel) {
                return Ok(empty_cancel());
            }
            continue;
        }
        return Err(captured.error_text());
    }
}

fn note_line(
    app: &AppHandle,
    line: &str,
    tracked: &mut Vec<PathBuf>,
    final_path: &mut Option<PathBuf>,
) {
    if let Some(path) = destination_path(line) {
        let buf = PathBuf::from(&path);
        if line.contains("Merging formats into") || line.contains("[ExtractAudio]") {
            *final_path = Some(buf.clone());
        }
        tracked.push(buf);
    }
    if let Some(path) = printed_path(line) {
        let buf = PathBuf::from(path);
        *final_path = Some(buf.clone());
        tracked.push(buf);
    }
    if let Some(progress) = parse_progress(line) {
        let downly = app.state::<Downly>();
        let snap = {
            let mut engine = lock(&downly.engine);
            engine.set_progress(Some(progress.percent), progress.speed, progress.eta);
            engine.snapshot()
        };
        emit(app, &snap);
    }
}

fn pause(cancel: &AtomicBool) -> bool {
    for _ in 0..10 {
        if cancel.load(Ordering::SeqCst) {
            return false;
        }
        thread::sleep(Duration::from_millis(100));
    }
    !cancel.load(Ordering::SeqCst)
}

fn empty_cancel() -> Capture {
    Capture {
        code: 1,
        stdout: String::new(),
        stderr: String::new(),
        cancelled: true,
    }
}

fn require_tools(app: &AppHandle) -> Result<ToolPaths, String> {
    let downly = app.state::<Downly>();
    resolve_tools(
        &downly.data_dir,
        &candidates(app, ytdlp_filename()),
        &candidates(app, ffmpeg_filename()),
    )
}

fn ytdlp_path(app: &AppHandle) -> Result<PathBuf, String> {
    let downly = app.state::<Downly>();
    resolve_ytdlp(&downly.data_dir, &candidates(app, ytdlp_filename()))
}

fn js_runtime(app: &AppHandle) -> Option<PathBuf> {
    let downly = app.state::<Downly>();
    resolve_deno(&downly.data_dir)
}

pub async fn ensure_deno(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app.state::<Downly>().data_dir.clone();
    if let Some(path) = resolve_deno(&data_dir) {
        return Ok(path);
    }
    if !cfg!(windows) {
        return Err("deno install supports windows only".into());
    }
    let bytes = crate::net::get_bytes(DENO_ZIP_URL).await?;
    let dir = data_dir.join("bin");
    tauri::async_runtime::spawn_blocking(move || install_deno_zip(&dir, &bytes))
        .await
        .map_err(|err| err.to_string())?
}

fn candidates(app: &AppHandle, name: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        paths.push(dir.join(name));
        paths.push(dir.join("resources").join(name));
    }
    paths.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(name),
    );
    paths
}

fn publish(app: &AppHandle) {
    let snap = state(app);
    emit(app, &snap);
}

fn emit(app: &AppHandle, snap: &Snapshot) {
    let _ = app.emit("downly-state", snap);
}

struct ItemOutcome {
    status: HistoryStatus,
    path: Option<String>,
    error: Option<String>,
    cancelled: bool,
}

impl ItemOutcome {
    fn success(path: Option<String>) -> Self {
        Self {
            status: HistoryStatus::Success,
            path,
            error: None,
            cancelled: false,
        }
    }

    fn failed(error: impl Into<String>) -> Self {
        Self {
            status: HistoryStatus::Failed,
            path: None,
            error: Some(error.into()),
            cancelled: false,
        }
    }

    fn cancelled() -> Self {
        Self {
            status: HistoryStatus::Cancelled,
            path: None,
            error: None,
            cancelled: true,
        }
    }
}

enum Preflight {
    Go,
    Cancelled,
    Stop(RejectReason),
}

struct ClearFlag<'a> {
    slot: &'a std::sync::Mutex<Option<Arc<AtomicBool>>>,
}

impl Drop for ClearFlag<'_> {
    fn drop(&mut self) {
        *lock(self.slot) = None;
    }
}

#[cfg(test)]
mod tests {
    use super::{mp4_conversion_args, selection_requires_mp4};
    use crate::engine::format::{FormatKind, Preset, Selection};
    use std::path::Path;

    #[test]
    fn mp4_conversion_remuxes_before_reencoding_fallback() {
        let remux = mp4_conversion_args(Path::new("source.webm"), Path::new("out.mp4"), false);
        let recode = mp4_conversion_args(Path::new("source.webm"), Path::new("out.mp4"), true);
        assert!(
            remux
                .windows(2)
                .any(|pair| pair[0] == "-c" && pair[1] == "copy")
        );
        assert!(
            recode
                .windows(2)
                .any(|pair| pair[0] == "-c:v" && pair[1] == "libx264")
        );
        assert!(
            recode
                .windows(2)
                .any(|pair| pair[0] == "-c:a" && pair[1] == "aac")
        );
    }

    #[test]
    fn mp4_conversion_is_only_applied_to_video_selections() {
        let video = Selection::Preset {
            preset: Preset::VideoBest,
            save_thumbnail: false,
            label: String::new(),
        };
        let audio = Selection::Preset {
            preset: Preset::AudioBest,
            save_thumbnail: false,
            label: String::new(),
        };
        let storyboard = Selection::Format {
            format_id: "storyboard".into(),
            pair_best_audio: false,
            mp3_bitrate: None,
            save_thumbnail: false,
            kind: FormatKind::Storyboard,
            vcodec: String::new(),
            acodec: String::new(),
            label: String::new(),
        };
        assert!(selection_requires_mp4(&video));
        assert!(!selection_requires_mp4(&audio));
        assert!(!selection_requires_mp4(&storyboard));
    }
}
