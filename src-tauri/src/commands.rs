use crate::engine::media::{PlaylistSummary, ProbeOutcome};
use crate::engine::queue::{CookiesBrowser, EnqueueItem, EnqueueOutcome, Snapshot};
use crate::runner;
use crate::state::Downly;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub async fn probe(app: AppHandle, url: String) -> Result<ProbeOutcome, String> {
    let downly = app.state::<Downly>();
    let _permit = downly.metadata_slots.clone().acquire_owned().await.map_err(|_| "application is shutting down".to_string())?;
    tauri::async_runtime::spawn_blocking(move || runner::probe(&app, url))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn expand_playlist(app: AppHandle, url: String) -> Result<PlaylistSummary, String> {
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
pub fn start(app: AppHandle) -> Result<(), String> {
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
pub async fn tools(
    app: AppHandle,
    action: crate::engine::tools::ToolsAction,
) -> Result<crate::engine::tools::ToolsStatus, String> {
    crate::engine::tools::run(&app, action).await
}

#[tauri::command]
pub fn app_version() -> String {
    if cfg!(debug_assertions) {
        "dev".to_string()
    } else {
        env!("CARGO_PKG_VERSION").to_string()
    }
}
