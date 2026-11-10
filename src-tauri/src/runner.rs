use crate::engine::args::{download_args, probe_playlist_args, probe_video_args};
use crate::engine::bins::{
    ToolPaths, ffmpeg_filename, resolve_tools, resolve_ytdlp,
};
use crate::engine::classify::{RejectReason, UrlKind, classify_url, screen_url};
use crate::engine::cleanup::{choose_output, delete_cancelled, snapshot_id};
use crate::engine::deno::{
    resolve_deno,
};
use crate::engine::filename::file_contains_id;
use crate::engine::format::{FormatKind, Preset, Selection};
use crate::engine::media::{PlaylistSummary, ProbeOutcome, parse_probe, summary_from_outcome};
use crate::engine::proc::{Capture, capture};
use crate::engine::progress::{destination_path, parse_progress, printed_path};
use crate::engine::queue::{
    CookiesBrowser, EnqueueItem, EnqueueOutcome, HistoryStatus, Item, Snapshot,
};
use crate::engine::retry::{MAX_ATTEMPTS, should_retry};
use crate::engine::staging::{item_stage_dir, publish as publish_staged_files};
use crate::state::{Downly, lock};
use crate::store;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

pub fn fallback_downloads() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .unwrap_or_else(std::env::temp_dir)
        .join("Downloads")
}

pub fn migrate_thumbnails(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let downly = app.state::<Downly>();
        let pending = {
            let engine = lock(&downly.engine);
            engine
                .pending
                .iter()
                .map(|item| (item.id.clone(), item.thumbnail.clone()))
                .chain(
                    engine
                        .active
                        .iter()
                        .map(|item| (item.id.clone(), item.thumbnail.clone())),
                )
                .chain(
                    engine
                        .session
                        .iter()
                        .chain(engine.history.iter())
                        .map(|item| (item.id.clone(), item.thumbnail.clone())),
                )
                .filter_map(|(id, thumbnail)| {
                    thumbnail
                        .filter(|value| {
                            value.starts_with("http://") || value.starts_with("https://")
                        })
                        .map(|url| (id, url))
                })
                .collect::<Vec<_>>()
        };
        if pending.is_empty() {
            return;
        }
        let updates = pending
            .iter()
            .map(|(id, url)| {
                (
                    id.clone(),
                    crate::engine::thumbnail::download_thumbnail(&downly.data_dir, id, Some(url)),
                )
            })
            .collect::<Vec<_>>();
        let mut engine = lock(&downly.engine);
        for (id, thumbnail) in updates {
            engine.set_thumbnail(&id, thumbnail);
        }
        let _ = store::save(&downly.data_dir, &engine);
        let snapshot = engine.snapshot();
        drop(engine);
        emit(&app, &snapshot);
    });
}

pub fn probe(app: &AppHandle, url: String) -> Result<ProbeOutcome, String> {
    match screen_url(&url) {
        Err(reason) => Ok(ProbeOutcome::Rejected { reason }),
        Ok(UrlKind::Video | UrlKind::Playlist) => run_probe(app, &url, true),
        Ok(UrlKind::Mix) => run_probe(app, &url, false),
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
    let (cookies_browser, cookies_file) = cookie_options(app)?;
    let captured = run_retry(
        app,
        &ytdlp,
        &probe_playlist_args(
            &url,
            deno.as_deref(),
            cookies_browser.ytdlp_name(),
            cookies_file.as_deref(),
        ),
        false,
        &AtomicBool::new(false),
        None,
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
    let mut queue_items = items.clone();
    for item in &mut queue_items {
        item.thumbnail = None;
    }
    let outcomes = {
        let mut engine = lock(&downly.engine);
        let dir = PathBuf::from(&engine.settings.download_dir);
        let outcomes = engine.enqueue(queue_items, &dir);
        store::save(&downly.data_dir, &engine)?;
        outcomes
    };
    let thumbnail_jobs = outcomes
        .iter()
        .zip(&items)
        .filter_map(|(outcome, item)| match outcome {
            EnqueueOutcome::Added { id, .. } => item
                .thumbnail
                .as_deref()
                .map(|url| (id.clone(), url.to_string())),
            _ => None,
        })
        .collect::<Vec<_>>();
    if !thumbnail_jobs.is_empty() {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let downly = app.state::<Downly>();
            let thumbnail_updates = thumbnail_jobs
                .iter()
                .map(|(id, url)| {
                    (
                        id.clone(),
                        crate::engine::thumbnail::download_thumbnail(
                            &downly.data_dir,
                            id,
                            Some(url),
                        ),
                    )
                })
                .collect::<Vec<_>>();
            let mut engine = lock(&downly.engine);
            for (id, thumbnail) in thumbnail_updates {
                engine.set_thumbnail(&id, thumbnail);
            }
            let _ = store::save(&downly.data_dir, &engine);
            let snapshot = engine.snapshot();
            drop(engine);
            emit(&app, &snapshot);
        });
    }
    publish(app);
    Ok(outcomes)
}

pub fn update_queue_metadata(
    app: &AppHandle,
    id: String,
    video_id: String,
    title: String,
    thumbnail: Option<String>,
    duration_seconds: Option<u64>,
    is_live: Option<bool>,
) -> Result<(), String> {
    let downly = app.state::<Downly>();
    let (thumbnail_url, snapshot) = {
        let mut engine = lock(&downly.engine);
        let metadata_changed =
            engine.update_metadata(&id, &video_id, &title, None, duration_seconds);
        let preflight_changed = is_live == Some(false) && engine.mark_preflight_checked(&id);
        let changed = metadata_changed || preflight_changed;
        if changed {
            store::save(&downly.data_dir, &engine)?;
        }
        (
            thumbnail.filter(|_| !engine.has_local_thumbnail(&id)),
            changed.then(|| engine.snapshot()),
        )
    };
    if let Some(snapshot) = snapshot {
        emit(app, &snapshot);
    }
    if let Some(thumbnail_url) = thumbnail_url {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let downly = app.state::<Downly>();
            let Some(thumbnail) = crate::engine::thumbnail::download_thumbnail(
                &downly.data_dir,
                &id,
                Some(&thumbnail_url),
            ) else {
                return;
            };
            let mut engine = lock(&downly.engine);
            if !engine.set_thumbnail(&id, Some(thumbnail)) {
                crate::engine::thumbnail::remove_orphans(&downly.data_dir, &engine);
                return;
            }
            let _ = store::save(&downly.data_dir, &engine);
            let snapshot = engine.snapshot();
            drop(engine);
            emit(&app, &snapshot);
        });
    }
    Ok(())
}

pub fn start(app: &AppHandle) -> Result<(), String> {
    let _tools = require_tools(app)?;
    let downly = app.state::<Downly>();
    downly.finish_live_recording.store(false, Ordering::SeqCst);
    {
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
    downly.finish_live_recording.store(false, Ordering::SeqCst);
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

pub fn finish_live_recording(app: &AppHandle) -> Result<(), String> {
    let downly = app.state::<Downly>();
    let live_capture = lock(&downly.live_capture);
    let mut engine = lock(&downly.engine);
    let active = engine
        .active
        .as_ref()
        .filter(|item| item.live_mode.is_some())
        .ok_or_else(|| "no live recording is active".to_string())?;
    if live_capture.as_deref() != Some(active.id.as_str()) {
        return Err("live recording is not ready to be finished".into());
    }
    if downly.finish_live_recording.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    engine.cancel = true;
    drop(engine);
    drop(live_capture);
    downly.procs.kill_downloads();
    Ok(())
}

pub fn cancel_item(app: &AppHandle, id: String) -> Result<(), String> {
    let downly = app.state::<Downly>();
    let (active, removed_stage) = {
        let mut engine = lock(&downly.engine);
        let removed_stage = engine
            .pending
            .iter()
            .find(|item| item.id == id)
            .map(|item| item_stage_dir(&downly.data_dir, &item.url, &item.selection));
        let active = engine.cancel_item(&id)?;
        store::save(&downly.data_dir, &engine)?;
        (active, removed_stage)
    };
    if let Some(stage) = removed_stage {
        let _ = std::fs::remove_dir_all(stage);
    }
    if active {
        downly.finish_live_recording.store(false, Ordering::SeqCst);
        if let Some(flag) = lock(&downly.download_cancel).clone() {
            flag.store(true, Ordering::SeqCst);
        }
        downly.procs.kill_downloads();
    }
    publish(app);
    Ok(())
}

pub fn clear_queue(app: &AppHandle) -> Result<(), String> {
    let downly = app.state::<Downly>();
    downly.finish_live_recording.store(false, Ordering::SeqCst);
    let (active, removed_stages) = {
        let mut engine = lock(&downly.engine);
        let active_stage = engine
            .active
            .as_ref()
            .map(|item| item_stage_dir(&downly.data_dir, &item.url, &item.selection));
        let removed_stages = engine
            .pending
            .iter()
            .map(|item| item_stage_dir(&downly.data_dir, &item.url, &item.selection))
            .chain(
                engine
                    .session
                    .iter()
                    .filter(|item| item.status == HistoryStatus::Failed)
                    .map(|item| item_stage_dir(&downly.data_dir, &item.url, &item.selection)),
            )
            .filter(|stage| Some(stage) != active_stage.as_ref())
            .collect::<Vec<_>>();
        let active = engine.clear_queue();
        store::save(&downly.data_dir, &engine)?;
        crate::engine::thumbnail::remove_orphans(&downly.data_dir, &engine);
        (active, removed_stages)
    };
    for stage in removed_stages {
        let _ = std::fs::remove_dir_all(stage);
    }
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
        let stage = engine
            .pending
            .iter()
            .find(|item| item.id == id)
            .map(|item| item_stage_dir(&downly.data_dir, &item.url, &item.selection));
        engine.remove_pending(&id)?;
        store::save(&downly.data_dir, &engine)?;
        crate::engine::thumbnail::remove_orphans(&downly.data_dir, &engine);
        if let Some(stage) = stage {
            let still_referenced = engine.pending.iter().any(|item| {
                item_stage_dir(&downly.data_dir, &item.url, &item.selection) == stage
            }) || engine.active.iter().any(|item| {
                item_stage_dir(&downly.data_dir, &item.url, &item.selection) == stage
            });
            if !still_referenced {
                let _ = std::fs::remove_dir_all(stage);
            }
        }
    }
    publish(app);
    Ok(())
}

pub fn reorder_queue_item(
    app: &AppHandle,
    id: String,
    before_id: Option<String>,
) -> Result<bool, String> {
    let downly = app.state::<Downly>();
    let changed = {
        let mut engine = lock(&downly.engine);
        let changed = engine.reorder_pending(&id, before_id.as_deref())?;
        if changed {
            store::save(&downly.data_dir, &engine)?;
        }
        changed
    };
    if changed {
        publish(app);
    }
    Ok(changed)
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

pub fn set_cookies_browser(app: &AppHandle, browser: CookiesBrowser) -> Result<(), String> {
    if browser == CookiesBrowser::Manual {
        return Err("Import a cookies.txt file to enable manual cookies".into());
    }
    let downly = app.state::<Downly>();
    {
        let mut engine = lock(&downly.engine);
        engine.settings.cookies_browser = browser;
        store::save(&downly.data_dir, &engine)?;
    }
    publish(app);
    Ok(())
}

pub fn set_download_speed_limit(app: &AppHandle, limit_bytes_per_second: Option<u64>) -> Result<(), String> {
    if limit_bytes_per_second == Some(0) {
        return Err("Download speed limit is out of range".into());
    }
    let downly = app.state::<Downly>();
    let mut engine = lock(&downly.engine);
    let previous = engine.settings.download_speed_limit_bytes_per_second;
    engine.settings.download_speed_limit_bytes_per_second = limit_bytes_per_second;
    if let Err(err) = store::save(&downly.data_dir, &engine) {
        engine.settings.download_speed_limit_bytes_per_second = previous;
        return Err(err);
    }
    drop(engine);
    publish(app);
    Ok(())
}

pub fn import_cookies_file(app: &AppHandle, source: String) -> Result<(), String> {
    let source = PathBuf::from(source);
    if !source
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("txt"))
    {
        return Err("Choose a .txt cookie file".into());
    }
    let contents = std::fs::read(&source).map_err(|err| err.to_string())?;
    let text = String::from_utf8_lossy(&contents);
    if !text.lines().any(|line| {
        let line = line.trim();
        !line.is_empty()
            && (!line.starts_with('#') || line.starts_with("#HttpOnly_"))
            && line.split('\t').count() == 7
    }) {
        return Err("Cookie file is empty or is not in Netscape format".into());
    }
    let downly = app.state::<Downly>();
    let path = downly.data_dir.join("cookies.txt");
    std::fs::write(&path, contents).map_err(|err| err.to_string())?;
    {
        let mut engine = lock(&downly.engine);
        engine.settings.cookies_browser = CookiesBrowser::Manual;
        engine.settings.cookies_updated_at = Some(
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        );
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
        crate::engine::thumbnail::remove_orphans(&downly.data_dir, &engine);
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

pub fn retry_failed_session_item(app: &AppHandle, id: String) -> Result<(), String> {
    let downly = app.state::<Downly>();
    let added = {
        let mut engine = lock(&downly.engine);
        let added = engine.retry_failed_session_item(&id)?;
        if added {
            store::save(&downly.data_dir, &engine)?;
        }
        added
    };
    if added {
        publish(app);
    }
    Ok(())
}

pub fn retry_cancelled_session_item(app: &AppHandle, id: String) -> Result<(), String> {
    let downly = app.state::<Downly>();
    let added = {
        let mut engine = lock(&downly.engine);
        let added = engine.retry_cancelled_session_item(&id)?;
        if added {
            store::save(&downly.data_dir, &engine)?;
        }
        added
    };
    if added {
        publish(app);
    }
    Ok(())
}

pub fn remove_cancelled_session_item(app: &AppHandle, id: String) -> Result<(), String> {
    let downly = app.state::<Downly>();
    {
        let mut engine = lock(&downly.engine);
        engine.remove_cancelled_session_item(&id)?;
        store::save(&downly.data_dir, &engine)?;
        crate::engine::thumbnail::remove_orphans(&downly.data_dir, &engine);
    }
    publish(app);
    Ok(())
}

pub fn remove_failed_session_item(app: &AppHandle, id: String) -> Result<(), String> {
    let downly = app.state::<Downly>();
    {
        let mut engine = lock(&downly.engine);
        let stage = engine
            .session
            .iter()
            .find(|item| item.id == id)
            .map(|item| item_stage_dir(&downly.data_dir, &item.url, &item.selection));
        engine.remove_failed_session_item(&id)?;
        store::save(&downly.data_dir, &engine)?;
        crate::engine::thumbnail::remove_orphans(&downly.data_dir, &engine);
        crate::engine::staging::cleanup_engine_orphans(&downly.data_dir, &engine);
        if let Some(stage) = stage {
            let still_referenced = engine
                .pending
                .iter()
                .any(|item| item_stage_dir(&downly.data_dir, &item.url, &item.selection) == stage)
                || engine
                    .session
                    .iter()
                    .chain(engine.history.iter())
                    .any(|item| item_stage_dir(&downly.data_dir, &item.url, &item.selection) == stage);
            if !still_referenced {
                let _ = std::fs::remove_dir_all(stage);
            }
        }
    }
    publish(app);
    Ok(())
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
        crate::engine::thumbnail::remove_orphans(&downly.data_dir, &engine);
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
        crate::engine::thumbnail::remove_orphans(&downly.data_dir, &engine);
    }
    publish(app);
    Ok(())
}

pub fn shutdown(app: &AppHandle) {
    let Some(downly) = app.try_state::<Downly>() else {
        return;
    };
    downly.metadata_slots.close();
    {
        let mut engine = lock(&downly.engine);
        engine.cancel = true;
        engine.archive_session_all();
        let _ = store::save(&downly.data_dir, &engine);
    }
    if let Some(flag) = lock(&downly.download_cancel).clone() {
        flag.store(true, Ordering::SeqCst);
    }
    downly.procs.kill_all();
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
            crate::engine::thumbnail::remove_orphans(&downly.data_dir, &engine);
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
    let _finish_live_reset = FinishLiveReset(&downly.finish_live_recording);
    let (download_dir, flag, speed_limit_bytes_per_second) = {
        let engine = lock(&downly.engine);
        let download_dir = PathBuf::from(engine.settings.download_dir.clone());
        let flag = Arc::new(AtomicBool::new(engine.cancel || engine.cancel_current));
        *lock(&downly.download_cancel) = Some(Arc::clone(&flag));
        (download_dir, flag, engine.settings.download_speed_limit_bytes_per_second)
    };
    let stage_dir = item_stage_dir(&downly.data_dir, &item.url, &item.selection);
    let _clear = ClearFlag {
        slot: &downly.download_cancel,
    };
    if flag.load(Ordering::SeqCst) {
        return ItemOutcome::cancelled();
    }
    if let Err(err) = std::fs::create_dir_all(&download_dir) {
        return ItemOutcome::failed(err.to_string());
    }
    if let Err(err) = std::fs::create_dir_all(&stage_dir) {
        return ItemOutcome::failed(err.to_string());
    }
    let tools = match require_tools(app) {
        Ok(tools) => tools,
        Err(err) => return ItemOutcome::failed(err),
    };
    if !item.preflight_checked && item.live_mode.is_none() {
        match preflight(
            app,
            &tools.ytdlp,
            &item.url,
            item.live_mode.is_some(),
            &flag,
        ) {
            Preflight::Cancelled => {
                let _ = std::fs::remove_dir_all(&stage_dir);
                return ItemOutcome::cancelled();
            }
            Preflight::Stop(reason) => return ItemOutcome::failed(reason.as_str()),
            Preflight::Go => {}
        }
    }
    if flag.load(Ordering::SeqCst) {
        return ItemOutcome::cancelled();
    }
    let deno = js_runtime(app);
    let (cookies_browser, cookies_file) = match cookie_options(app) {
        Ok(options) => options,
        Err(err) => return ItemOutcome::failed(err),
    };
    let args = match download_args(
        &item.selection,
        &stage_dir,
        &tools.ffmpeg_dir,
        &item.url,
        deno.as_deref(),
        cookies_browser.ytdlp_name(),
        cookies_file.as_deref(),
        file_contains_id(&download_dir, &item.video_id).then_some(item.id.as_str()),
        item.live_mode,
        if item.live_mode.is_none() { speed_limit_bytes_per_second } else { None },
    ) {
        Ok(args) => args,
        Err(err) => return ItemOutcome::failed(err),
    };
    let before = snapshot_id(&stage_dir, &item.video_id);
    let mut tracked = Vec::new();
    let mut final_path = None;
    let live = item.live_mode.is_some();
    if live {
        *lock(&downly.live_capture) = Some(item.id.clone());
    }
    let captured = run_retry(
        app,
        &tools.ytdlp,
        &args,
        true,
        &flag,
        live.then_some(&downly.finish_live_recording),
        |line| {
            note_line(app, line, &mut tracked, &mut final_path, live);
        },
    );
    if live {
        let mut active = lock(&downly.live_capture);
        if active.as_deref() == Some(item.id.as_str()) {
            *active = None;
        }
    }
    let finishing_live = live && downly.finish_live_recording.load(Ordering::SeqCst);
    match captured {
        Ok(captured) if captured.cancelled || flag.load(Ordering::SeqCst) => {
            delete_cancelled(&stage_dir, &item.video_id, &before, &tracked);
            let _ = std::fs::remove_dir_all(&stage_dir);
            ItemOutcome::cancelled()
        }
        Ok(_) if finishing_live => {
            let Some(output) = choose_output(final_path.as_deref(), &tracked, &stage_dir, &item.video_id)
            else {
                return ItemOutcome::failed("no live recording output was saved");
            };
            if selection_requires_mp4(&item.selection) {
                match ensure_mp4(
                    &downly.procs,
                    &tools.ffmpeg_dir,
                    Path::new(&output),
                    &item.id,
                    &flag,
                ) {
                    Ok(path) => publish_success(
                        app,
                        &stage_dir,
                        &download_dir,
                        &item.id,
                        Path::new(&path),
                    ),
                    Err(outcome) if outcome.cancelled => {
                        delete_cancelled(&stage_dir, &item.video_id, &before, &tracked);
                        let _ = std::fs::remove_dir_all(&stage_dir);
                        outcome
                    }
                    Err(outcome) => match publish_staged_files(
                        Some(app),
                        &stage_dir,
                        &download_dir,
                        &item.id,
                        Path::new(&output),
                    ) {
                        Ok(path) => ItemOutcome::failed_with_path(
                            format!(
                                "{}; MPEG-TS recording kept at {}",
                                outcome.error.unwrap_or_else(|| "MP4 conversion failed".into()),
                                path
                            ),
                            path,
                        ),
                        Err(error) => ItemOutcome::failed(error),
                    },
                }
            } else {
                publish_success(app, &stage_dir, &download_dir, &item.id, Path::new(&output))
            }
        }
        Ok(_) => {
            let output = choose_output(final_path.as_deref(), &tracked, &stage_dir, &item.video_id);
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
                    Ok(path) => publish_success(
                        app,
                        &stage_dir,
                        &download_dir,
                        &item.id,
                        Path::new(&path),
                    ),
                    Err(outcome) if outcome.cancelled => {
                        delete_cancelled(&stage_dir, &item.video_id, &before, &tracked);
                        let _ = std::fs::remove_dir_all(&stage_dir);
                        outcome
                    }
                    Err(outcome) => outcome,
                }
            } else {
                match output {
                    Some(output) => publish_success(
                        app,
                        &stage_dir,
                        &download_dir,
                        &item.id,
                        Path::new(&output),
                    ),
                    None => ItemOutcome::failed("download output not found"),
                }
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
        Selection::Format {
            output_format,
            kind,
            ..
        } => {
            output_format.eq_ignore_ascii_case("mp4")
                || (output_format.is_empty()
                    && matches!(kind, FormatKind::Video | FormatKind::Mixed))
        }
    }
}

fn publish_success(
    app: &AppHandle,
    stage_dir: &Path,
    download_dir: &Path,
    item_id: &str,
    primary: &Path,
) -> ItemOutcome {
    match publish_staged_files(Some(app), stage_dir, download_dir, item_id, primary) {
        Ok(path) => ItemOutcome::success(Some(path)),
        Err(error) => ItemOutcome::failed(error),
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
    let remux = capture(procs, true, &ffmpeg, &remux_args, cancel, None, |_| {})
        .map_err(ItemOutcome::failed)?;
    if remux.cancelled {
        let _ = std::fs::remove_file(&temp);
        return Err(ItemOutcome::cancelled());
    }
    if remux.code != 0 {
        let _ = std::fs::remove_file(&temp);
        let recode_args = mp4_conversion_args(source, &temp, true);
        let recode = capture(procs, true, &ffmpeg, &recode_args, cancel, None, |_| {})
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

fn preflight(
    app: &AppHandle,
    ytdlp: &Path,
    url: &str,
    allow_live: bool,
    cancel: &AtomicBool,
) -> Preflight {
    let deno = js_runtime(app);
    let (cookies_browser, cookies_file) = match cookie_options(app) {
        Ok(options) => options,
        Err(_) => return Preflight::Go,
    };
    let captured = match run_retry(
        app,
        ytdlp,
        &probe_video_args(
            url,
            deno.as_deref(),
            cookies_browser.ytdlp_name(),
            cookies_file.as_deref(),
        ),
        true,
        cancel,
        None,
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
        Ok(ProbeOutcome::Video { is_live: true, .. }) if !allow_live => {
            Preflight::Stop(RejectReason::Live)
        }
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
    let (cookies_browser, cookies_file) = cookie_options(app)?;
    let args = if playlist {
        probe_playlist_args(
            url,
            deno.as_deref(),
            cookies_browser.ytdlp_name(),
            cookies_file.as_deref(),
        )
    } else {
        probe_video_args(
            url,
            deno.as_deref(),
            cookies_browser.ytdlp_name(),
            cookies_file.as_deref(),
        )
    };
    let captured = run_retry(
        app,
        &ytdlp,
        &args,
        false,
        &AtomicBool::new(false),
        None,
        |_| {},
    )?;
    if captured.cancelled {
        return Err("cancelled".into());
    }
    if captured.code != 0 {
        return Err(captured.error_text());
    }
    parse_probe(&captured.stdout, url)
}

fn cookie_options(app: &AppHandle) -> Result<(CookiesBrowser, Option<PathBuf>), String> {
    let downly = app.state::<Downly>();
    let browser = lock(&downly.engine).settings.cookies_browser;
    let file = if browser == CookiesBrowser::Manual {
        let path = downly.data_dir.join("cookies.txt");
        if !path.is_file() {
            return Err("Manual cookie file is missing. Add it again in Settings.".into());
        }
        Some(path)
    } else {
        None
    };
    Ok((browser, file))
}

fn run_retry(
    app: &AppHandle,
    exe: &Path,
    args: &[String],
    download: bool,
    cancel: &AtomicBool,
    finish: Option<&AtomicBool>,
    mut on_line: impl FnMut(&str),
) -> Result<Capture, String> {
    let mut attempt = 0u32;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Ok(empty_cancel());
        }
        attempt += 1;
        let downly = app.state::<Downly>();
        let captured = capture(
            &downly.procs,
            download,
            exe,
            args,
            cancel,
            finish,
            &mut on_line,
        )?;
        if captured.cancelled {
            return Ok(captured);
        }
        if finish.is_some_and(|flag| flag.load(Ordering::SeqCst)) {
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
    live: bool,
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
            engine.set_progress(
                if live { None } else { Some(progress.percent) },
                progress.speed,
                if live { None } else { progress.eta },
            );
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
    resolve_tools(&downly.data_dir)
}

fn ytdlp_path(app: &AppHandle) -> Result<PathBuf, String> {
    let downly = app.state::<Downly>();
    resolve_ytdlp(&downly.data_dir)
}

fn js_runtime(app: &AppHandle) -> Option<PathBuf> {
    let downly = app.state::<Downly>();
    resolve_deno(&downly.data_dir)
}

pub fn download_running(app: &AppHandle) -> bool {
    let downly = app.state::<Downly>();
    let engine = lock(&downly.engine);
    engine.running || engine.progress.is_some()
}

fn publish(app: &AppHandle) {
    let snap = state(app);
    emit(app, &snap);
}

fn emit(app: &AppHandle, snap: &Snapshot) {
    let _ = app.emit("downly-state", snap);
}

struct FinishLiveReset<'a>(&'a AtomicBool);

impl Drop for FinishLiveReset<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
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

    fn failed_with_path(error: impl Into<String>, path: String) -> Self {
        Self {
            status: HistoryStatus::Failed,
            path: Some(path),
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
            clip: None,
        };
        let audio = Selection::Preset {
            preset: Preset::AudioBest,
            save_thumbnail: false,
            label: String::new(),
            clip: None,
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
            output_format: String::new(),
            clip: None,
        };
        assert!(selection_requires_mp4(&video));
        assert!(!selection_requires_mp4(&audio));
        assert!(!selection_requires_mp4(&storyboard));
    }
}
