mod commands;
pub mod engine;
mod net;
mod runner;
mod state;
mod store;

use state::Downly;
use tauri::{Manager, path::BaseDirectory};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let data_dir = app.path().resolve("Downly", BaseDirectory::LocalData)?;
            std::fs::create_dir_all(&data_dir)?;
            let downloads = app
                .path()
                .download_dir()
                .unwrap_or_else(|_| runner::fallback_downloads());
            let engine = store::load(&data_dir, &downloads);
            app.manage(Downly {
                data_dir,
                engine: std::sync::Mutex::new(engine),
                procs: engine::proc::ProcRegistry::new(),
                download_cancel: std::sync::Mutex::new(None),
                finish_live_recording: std::sync::atomic::AtomicBool::new(false),
                live_capture: std::sync::Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::probe,
            commands::expand_playlist,
            commands::enqueue,
            commands::update_queue_metadata,
            commands::start,
            commands::stop,
            commands::finish_live_recording,
            commands::remove,
            commands::cancel_item,
            commands::reorder_queue_item,
            commands::clear_queue,
            commands::state,
            commands::set_download_dir,
            commands::set_cookies_browser,
            commands::import_cookies_file,
            commands::open_path,
            commands::reveal_path,
            commands::retry_history,
            commands::remove_history,
            commands::archive_session,
            commands::archive_session_all,
            commands::retry_failed_session,
            commands::retry_failed_session_item,
            commands::retry_cancelled_session_item,
            commands::remove_cancelled_session_item,
            commands::remove_failed_session_item,
            commands::archive_completed_session_all,
            commands::delete_completed_session_item,
            commands::clear_history,
            commands::update_ytdlp,
            commands::ytdlp_version,
            commands::ytdlp_info,
            commands::check_ytdlp_update,
            commands::app_version,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                runner::shutdown(app);
            }
        });
}
