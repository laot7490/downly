use crate::engine::bins::ytdlp_filename;
use crate::engine::media::{PlaylistSummary, ProbeOutcome};
use crate::engine::queue::{CookiesBrowser, EnqueueItem, EnqueueOutcome, Snapshot};
use crate::engine::verify::{YTDLP_EXE_URL, YTDLP_SUMS_URL, install_verified};
use crate::engine::version::{AppUpdate, parse_release, version_is_newer};
use crate::net;
use crate::runner;
use crate::state::Downly;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub async fn probe(app: AppHandle, url: String) -> Result<ProbeOutcome, String> {
    runner::ensure_deno(&app).await?;
    let downly = app.state::<Downly>();
    let _permit = downly.metadata_slots.clone().acquire_owned().await.map_err(|_| "application is shutting down".to_string())?;
    tauri::async_runtime::spawn_blocking(move || runner::probe(&app, url))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn expand_playlist(app: AppHandle, url: String) -> Result<PlaylistSummary, String> {
    runner::ensure_deno(&app).await?;
    let downly = app.state::<Downly>();
    let _permit = downly.metadata_slots.clone().acquire_owned().await.map_err(|_| "application is shutting down".to_string())?;
    tauri::async_runtime::spawn_blocking(move || runner::expand_playlist(&app, url))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub fn enqueue(app: AppHandle, items: Vec<EnqueueItem>) -> Result<Vec<EnqueueOutcome>, String> {
    runner::enqueue(&app, items)
}

#[tauri::command]
pub fn update_queue_metadata(
    app: AppHandle,
    id: String,
    video_id: String,
    title: String,
    thumbnail: Option<String>,
    duration_seconds: Option<u64>,
    is_live: Option<bool>,
) -> Result<(), String> {
    runner::update_queue_metadata(
        &app,
        id,
        video_id,
        title,
        thumbnail,
        duration_seconds,
        is_live,
    )
}

#[tauri::command]
pub async fn start(app: AppHandle) -> Result<(), String> {
    runner::ensure_deno(&app).await?;
    runner::start(&app)
}

#[tauri::command]
pub fn stop(app: AppHandle) -> Result<(), String> {
    runner::stop(&app)
}

#[tauri::command]
pub fn finish_live_recording(app: AppHandle) -> Result<(), String> {
    runner::finish_live_recording(&app)
}

#[tauri::command]
pub fn remove(app: AppHandle, id: String) -> Result<(), String> {
    runner::remove(&app, id)
}

#[tauri::command]
pub fn cancel_item(app: AppHandle, id: String) -> Result<(), String> {
    runner::cancel_item(&app, id)
}

#[tauri::command]
pub fn reorder_queue_item(
    app: AppHandle,
    id: String,
    before_id: Option<String>,
) -> Result<bool, String> {
    runner::reorder_queue_item(&app, id, before_id)
}

#[tauri::command]
pub fn clear_queue(app: AppHandle) -> Result<(), String> {
    runner::clear_queue(&app)
}

#[tauri::command]
pub fn state(app: AppHandle) -> Snapshot {
    runner::state(&app)
}

#[tauri::command]
pub fn set_download_dir(app: AppHandle, path: String) -> Result<(), String> {
    runner::set_download_dir(&app, path)
}

#[tauri::command]
pub fn set_cookies_browser(app: AppHandle, browser: CookiesBrowser) -> Result<(), String> {
    runner::set_cookies_browser(&app, browser)
}

#[tauri::command]
pub fn set_download_speed_limit(
    app: AppHandle,
    limit_bytes_per_second: Option<u64>,
) -> Result<(), String> {
    runner::set_download_speed_limit(&app, limit_bytes_per_second)
}

#[tauri::command]
pub fn import_cookies_file(app: AppHandle, path: String) -> Result<(), String> {
    runner::import_cookies_file(&app, path)
}

#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("path is empty".into());
    }
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn reveal_path(app: AppHandle, path: String) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("path is empty".into());
    }
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn retry_history(app: AppHandle, id: String) -> Result<(), String> {
    runner::retry_history(&app, id)
}

#[tauri::command]
pub fn remove_history(app: AppHandle, id: String) -> Result<(), String> {
    runner::remove_history(&app, id)
}

#[tauri::command]
pub fn archive_session(app: AppHandle, id: String) -> Result<(), String> {
    runner::archive_session(&app, id)
}

#[tauri::command]
pub fn archive_session_all(app: AppHandle) -> Result<(), String> {
    runner::archive_session_all(&app)
}

#[tauri::command]
pub fn retry_failed_session(app: AppHandle) -> Result<usize, String> {
    runner::retry_failed_session(&app)
}

#[tauri::command]
pub fn retry_failed_session_item(app: AppHandle, id: String) -> Result<(), String> {
    runner::retry_failed_session_item(&app, id)
}

#[tauri::command]
pub fn retry_cancelled_session_item(app: AppHandle, id: String) -> Result<(), String> {
    runner::retry_cancelled_session_item(&app, id)
}

#[tauri::command]
pub fn remove_cancelled_session_item(app: AppHandle, id: String) -> Result<(), String> {
    runner::remove_cancelled_session_item(&app, id)
}

#[tauri::command]
pub fn remove_failed_session_item(app: AppHandle, id: String) -> Result<(), String> {
    runner::remove_failed_session_item(&app, id)
}

#[tauri::command]
pub fn archive_completed_session_all(app: AppHandle) -> Result<usize, String> {
    runner::archive_completed_session_all(&app)
}

#[tauri::command]
pub fn delete_completed_session_item(app: AppHandle, id: String) -> Result<(), String> {
    runner::delete_completed_session_item(&app, id)
}

#[tauri::command]
pub fn clear_history(app: AppHandle) -> Result<(), String> {
    runner::clear_history(&app)
}

#[tauri::command]
pub async fn update_ytdlp(app: AppHandle) -> Result<String, String> {
    if !cfg!(windows) {
        return Err("yt-dlp update supports windows only".into());
    }
    let bytes = net::get_bytes(YTDLP_EXE_URL).await?;
    let sums = net::get_text(YTDLP_SUMS_URL).await?;
    let dir = app.state::<Downly>().data_dir.join("bin");
    install_verified(&dir, ytdlp_filename(), &bytes, &sums)?;
    runner::ensure_deno(&app).await?;
    let info = tauri::async_runtime::spawn_blocking(move || runner::ytdlp_info(&app))
        .await
        .map_err(|err| err.to_string())??;
    Ok(info.version)
}

#[tauri::command]
pub async fn ytdlp_version(app: AppHandle) -> Result<String, String> {
    let info = tauri::async_runtime::spawn_blocking(move || runner::ytdlp_info(&app))
        .await
        .map_err(|err| err.to_string())??;
    Ok(info.version)
}

#[tauri::command]
pub async fn ytdlp_info(app: AppHandle) -> Result<runner::YtdlpInfo, String> {
    tauri::async_runtime::spawn_blocking(move || runner::ytdlp_info(&app))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn check_ytdlp_update(app: AppHandle) -> Result<Option<AppUpdate>, String> {
    let current = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || runner::ytdlp_info(&app)
    })
    .await
    .map_err(|err| err.to_string())??
    .version;
    let text = net::get_text("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest").await;
    if let Ok(text) = text {
        if let Some(update) = parse_release(&text, &current) {
            return Ok(Some(update));
        }
    }
    let latest_url = net::get_final_url("https://github.com/yt-dlp/yt-dlp/releases/latest").await?;
    let tag = latest_url
        .strip_prefix("https://github.com/yt-dlp/yt-dlp/releases/tag/")
        .filter(|tag| !tag.is_empty())
        .ok_or_else(|| "latest yt-dlp release tag missing".to_string())?;
    Ok(Some(AppUpdate {
        version: tag.to_string(),
        current: current.clone(),
        newer: version_is_newer(tag, &current),
        url: Some(latest_url),
    }))
}

#[tauri::command]
pub fn app_version() -> String {
    if cfg!(debug_assertions) {
        "dev".to_string()
    } else {
        env!("CARGO_PKG_VERSION").to_string()
    }
}
