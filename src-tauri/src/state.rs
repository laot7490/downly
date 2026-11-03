use crate::engine::proc::ProcRegistry;
use crate::engine::queue::Engine;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

pub struct Downly {
    pub data_dir: PathBuf,
    pub engine: Mutex<Engine>,
    pub procs: ProcRegistry,
    pub download_cancel: Mutex<Option<Arc<AtomicBool>>>,
}

pub fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|err| err.into_inner())
}
