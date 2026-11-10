use crate::engine::proc::ProcRegistry;
use crate::engine::queue::Engine;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tokio::sync::Semaphore;

pub struct Downly {
    pub data_dir: PathBuf,
    pub engine: Mutex<Engine>,
    pub procs: ProcRegistry,
    pub metadata_slots: Arc<Semaphore>,
    pub download_cancel: Mutex<Option<Arc<AtomicBool>>>,
    pub finish_live_recording: AtomicBool,
    pub live_capture: Mutex<Option<String>>,
}

pub fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|err| err.into_inner())
}
