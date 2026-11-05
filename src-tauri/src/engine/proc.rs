use std::io::Read;
use std::path::Path;
#[cfg(not(windows))]
use std::process::Child;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

pub struct ProcRegistry {
    next: AtomicU64,
    slots: Mutex<Vec<Slot>>,
}

struct Slot {
    token: u64,
    download: bool,
    kill: Arc<dyn ProcKill>,
}

pub trait ProcKill: Send + Sync {
    fn kill(&self);
}

pub struct Capture {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
    pub cancelled: bool,
}

impl Capture {
    pub fn combined(&self) -> String {
        format!("{}\n{}", self.stdout, self.stderr)
    }

    pub fn error_text(&self) -> String {
        let combined = format!("{}\n{}", self.stderr, self.stdout);
        if let Some(line) = preferred_error_line(&combined) {
            return truncate_chars(line, 2000);
        }
        let source = if self.stderr.trim().is_empty() {
            self.stdout.trim()
        } else {
            self.stderr.trim()
        };
        if source.is_empty() {
            return "download failed".into();
        }
        truncate_chars(source, 2000)
    }
}

fn preferred_error_line(text: &str) -> Option<&str> {
    let lines = text.lines().map(str::trim).filter(|line| !line.is_empty());
    let mut warning = None;
    let mut other = None;
    for line in lines {
        let upper = line.to_ascii_uppercase();
        if upper.contains("ERROR:") {
            return Some(line);
        }
        if warning.is_none() && upper.contains("WARNING:") {
            warning = Some(line);
            continue;
        }
        if other.is_none() && !upper.contains("WARNING:") {
            other = Some(line);
        }
    }
    other.or(warning)
}

fn truncate_chars(source: &str, max: usize) -> String {
    let count = source.chars().count();
    if count > max {
        source.chars().skip(count - max).collect()
    } else {
        source.to_string()
    }
}

impl ProcRegistry {
    pub fn new() -> Self {
        Self {
            next: AtomicU64::new(1),
            slots: Mutex::new(Vec::new()),
        }
    }

    pub fn register(&self, download: bool, kill: Arc<dyn ProcKill>) -> u64 {
        let token = self.next.fetch_add(1, Ordering::Relaxed);
        lock(&self.slots).push(Slot {
            token,
            download,
            kill,
        });
        token
    }

    pub fn unregister(&self, token: u64) {
        lock(&self.slots).retain(|slot| slot.token != token);
    }

    pub fn kill_downloads(&self) {
        let kills = lock(&self.slots)
            .iter()
            .filter(|slot| slot.download)
            .map(|slot| Arc::clone(&slot.kill))
            .collect::<Vec<_>>();
        for kill in kills {
            kill.kill();
        }
    }

    pub fn kill_all(&self) {
        let kills = lock(&self.slots)
            .iter()
            .map(|slot| Arc::clone(&slot.kill))
            .collect::<Vec<_>>();
        for kill in kills {
            kill.kill();
        }
    }
}

impl Default for ProcRegistry {
    fn default() -> Self {
        Self::new()
    }
}

pub fn capture(
    procs: &ProcRegistry,
    download: bool,
    exe: &Path,
    args: &[String],
    cancel: &AtomicBool,
    finish: Option<&AtomicBool>,
    mut on_line: impl FnMut(&str),
) -> Result<Capture, String> {
    if cancel.load(Ordering::SeqCst) {
        return Ok(Capture {
            code: 1,
            stdout: String::new(),
            stderr: String::new(),
            cancelled: true,
        });
    }
    if finish.is_some_and(|flag| flag.load(Ordering::SeqCst)) {
        return Ok(Capture {
            code: 1,
            stdout: String::new(),
            stderr: String::new(),
            cancelled: false,
        });
    }
    let spawned = spawn(exe, args)?;
    let token = procs.register(download, Arc::clone(&spawned.kill));
    let _guard = Unregister { procs, token };
    if cancel.load(Ordering::SeqCst) {
        spawned.kill.kill();
    }
    if finish.is_some_and(|flag| flag.load(Ordering::SeqCst)) {
        spawned.kill.kill();
    }
    let (tx, rx) = std::sync::mpsc::channel::<StreamLine>();
    let stdout_tx = tx.clone();
    let stdout = spawned.stdout;
    let stderr = spawned.stderr;
    thread::spawn(move || read_lines(stdout, stdout_tx, true));
    thread::spawn(move || read_lines(stderr, tx, false));
    let mut out_lines = Vec::new();
    let mut err_lines = Vec::new();
    loop {
        if cancel.load(Ordering::SeqCst) {
            spawned.kill.kill();
        }
        if finish.is_some_and(|flag| flag.load(Ordering::SeqCst)) {
            spawned.kill.kill();
        }
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(StreamLine::Out(line)) => {
                on_line(&line);
                push_tail(&mut out_lines, line);
            }
            Ok(StreamLine::Err(line)) => {
                on_line(&line);
                push_tail(&mut err_lines, line);
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    let code = (spawned.wait)();
    let cancelled = cancel.load(Ordering::SeqCst);
    Ok(Capture {
        code,
        stdout: out_lines.join("\n"),
        stderr: err_lines.join("\n"),
        cancelled,
    })
}

enum StreamLine {
    Out(String),
    Err(String),
}

struct Unregister<'a> {
    procs: &'a ProcRegistry,
    token: u64,
}

impl Drop for Unregister<'_> {
    fn drop(&mut self) {
        self.procs.unregister(self.token);
    }
}

struct Spawned {
    stdout: Box<dyn Read + Send>,
    stderr: Box<dyn Read + Send>,
    kill: Arc<dyn ProcKill>,
    wait: Box<dyn FnOnce() -> i32 + Send>,
}

fn spawn(exe: &Path, args: &[String]) -> Result<Spawned, String> {
    #[cfg(windows)]
    {
        spawn_windows(exe, args)
    }
    #[cfg(not(windows))]
    {
        spawn_unix(exe, args)
    }
}

#[cfg(windows)]
fn spawn_windows(exe: &Path, args: &[String]) -> Result<Spawned, String> {
    use std::os::windows::io::AsRawHandle;
    use std::os::windows::process::CommandExt;

    const CREATE_SUSPENDED: u32 = 0x0000_0004;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let job = create_job()?;
    let mut child = Command::new(exe)
        .args(args)
        .creation_flags(CREATE_SUSPENDED | CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| err.to_string())?;
    let assigned = assign_job(job, child.as_raw_handle());
    if !assigned {
        let err = std::io::Error::last_os_error();
        let _ = child.kill();
        let _ = child.wait();
        close_handle(job);
        return Err(format!("failed to assign job: {err}"));
    }
    if !resume_threads(child.id()) {
        terminate_job(job);
        let _ = child.wait();
        close_handle(job);
        return Err("failed to resume process".into());
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "missing stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "missing stderr".to_string())?;
    let kill = Arc::new(WinKill { job: job as usize });
    let wait = Box::new(move || match child.wait() {
        Ok(status) => status.code().unwrap_or(1),
        Err(_) => 1,
    });
    Ok(Spawned {
        stdout: Box::new(stdout),
        stderr: Box::new(stderr),
        kill,
        wait,
    })
}

#[cfg(windows)]
struct WinKill {
    job: usize,
}

#[cfg(windows)]
unsafe impl Send for WinKill {}

#[cfg(windows)]
unsafe impl Sync for WinKill {}

#[cfg(windows)]
impl ProcKill for WinKill {
    fn kill(&self) {
        terminate_job(self.job as *mut std::ffi::c_void);
    }
}

#[cfg(windows)]
impl Drop for WinKill {
    fn drop(&mut self) {
        let handle = self.job as *mut std::ffi::c_void;
        terminate_job(handle);
        close_handle(handle);
    }
}

#[cfg(windows)]
fn create_job() -> Result<*mut std::ffi::c_void, String> {
    use windows_sys::Win32::System::JobObjects::{
        CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JobObjectExtendedLimitInformation, SetInformationJobObject,
    };

    let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if job.is_null() {
        return Err(format!("job: {}", std::io::Error::last_os_error()));
    }
    let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let ok = unsafe {
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *const std::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if ok == 0 {
        let err = std::io::Error::last_os_error();
        close_handle(job);
        return Err(format!("job info: {err}"));
    }
    Ok(job)
}

#[cfg(windows)]
fn assign_job(job: *mut std::ffi::c_void, process: *mut std::ffi::c_void) -> bool {
    use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;
    unsafe { AssignProcessToJobObject(job, process) != 0 }
}

#[cfg(windows)]
fn terminate_job(job: *mut std::ffi::c_void) {
    use windows_sys::Win32::System::JobObjects::TerminateJobObject;
    if !job.is_null() {
        unsafe {
            TerminateJobObject(job, 1);
        }
    }
}

#[cfg(windows)]
fn close_handle(handle: *mut std::ffi::c_void) {
    use windows_sys::Win32::Foundation::CloseHandle;
    if !handle.is_null() {
        unsafe {
            CloseHandle(handle);
        }
    }
}

#[cfg(windows)]
fn resume_threads(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
    };
    use windows_sys::Win32::System::Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME};

    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
        if snap.is_null() {
            return false;
        }
        let mut entry: THREADENTRY32 = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
        let mut resumed = false;
        if Thread32First(snap, &mut entry) != 0 {
            loop {
                if entry.th32OwnerProcessID == pid {
                    let thread = OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID);
                    if !thread.is_null() {
                        if ResumeThread(thread) != u32::MAX {
                            resumed = true;
                        }
                        CloseHandle(thread);
                    }
                }
                if Thread32Next(snap, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
        resumed
    }
}

#[cfg(not(windows))]
fn spawn_unix(exe: &Path, args: &[String]) -> Result<Spawned, String> {
    let mut child = Command::new(exe)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| err.to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "missing stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "missing stderr".to_string())?;
    let shared = Arc::new(Mutex::new(child));
    let kill = Arc::clone(&shared);
    let wait_child = Arc::clone(&shared);
    Ok(Spawned {
        stdout: Box::new(stdout),
        stderr: Box::new(stderr),
        kill: Arc::new(UnixKill { child: kill }),
        wait: Box::new(move || wait_unix(wait_child)),
    })
}

#[cfg(not(windows))]
struct UnixKill {
    child: Arc<Mutex<Child>>,
}

#[cfg(not(windows))]
impl ProcKill for UnixKill {
    fn kill(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }
}

#[cfg(not(windows))]
fn wait_unix(child: Arc<Mutex<Child>>) -> i32 {
    loop {
        let status = {
            let mut guard = match child.lock() {
                Ok(guard) => guard,
                Err(poison) => poison.into_inner(),
            };
            match guard.try_wait() {
                Ok(Some(status)) => Some(status.code().unwrap_or(1)),
                Ok(None) => None,
                Err(_) => Some(1),
            }
        };
        if let Some(code) = status {
            return code;
        }
        thread::sleep(Duration::from_millis(30));
    }
}

fn read_lines(reader: impl Read, tx: std::sync::mpsc::Sender<StreamLine>, stdout: bool) {
    let mut reader = std::io::BufReader::new(reader);
    let mut line = String::new();
    loop {
        line.clear();
        match std::io::BufRead::read_line(&mut reader, &mut line) {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = line.trim_end_matches(['\r', '\n']).to_string();
                let message = if stdout {
                    StreamLine::Out(trimmed)
                } else {
                    StreamLine::Err(trimmed)
                };
                if tx.send(message).is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

fn push_tail(lines: &mut Vec<String>, line: String) {
    lines.push(line);
    if lines.len() > 400 {
        lines.remove(0);
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|err| err.into_inner())
}

#[cfg(test)]
mod error_tests {
    use super::{Capture, preferred_error_line};

    #[test]
    fn prefers_error_over_warning() {
        let text = "WARNING: [youtube] No title found in player responses\nERROR: [youtube] Sign in to confirm you’re not a bot";
        assert!(
            preferred_error_line(text)
                .unwrap()
                .contains("Sign in to confirm")
        );
        let capture = Capture {
            code: 1,
            stdout: String::new(),
            stderr: text.into(),
            cancelled: false,
        };
        assert!(capture.error_text().contains("Sign in to confirm"));
        assert!(!capture.error_text().contains("WARNING:"));
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::spawn;
    use std::io::Read;
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    fn cmd() -> std::path::PathBuf {
        std::env::var_os("ComSpec")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| std::path::PathBuf::from("C:\\Windows\\System32\\cmd.exe"))
    }

    #[test]
    fn suspended_job_runs_and_returns_output() {
        let spawned = spawn(&cmd(), &["/C".into(), "echo hello-downly".into()]).unwrap();
        let (tx, rx) = mpsc::channel();
        let mut stdout = spawned.stdout;
        thread::spawn(move || {
            let mut text = String::new();
            let _ = stdout.read_to_string(&mut text);
            let _ = tx.send(text);
        });
        let code = (spawned.wait)();
        let text = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(code, 0, "{text}");
        assert!(text.contains("hello-downly"), "{text}");
    }

    #[test]
    fn killing_the_job_stops_the_child() {
        let spawned = spawn(&cmd(), &["/C".into(), "ping -n 20 127.0.0.1".into()]).unwrap();
        spawned.kill.kill();
        let started = std::time::Instant::now();
        let code = (spawned.wait)();
        assert!(started.elapsed() < Duration::from_secs(8), "kill hung");
        assert_ne!(code, 0);
    }
}
