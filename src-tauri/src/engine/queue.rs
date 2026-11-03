use crate::engine::classify::{RejectReason, extract_video_id, screen_batch};
use crate::engine::format::Selection;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Settings {
    pub download_dir: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QueueStatus {
    Pending,
    Active,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HistoryStatus {
    Success,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Item {
    pub id: String,
    pub video_id: String,
    pub url: String,
    pub title: String,
    pub thumbnail: Option<String>,
    pub selection: Selection,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct QueueEntry {
    pub id: String,
    pub video_id: String,
    pub url: String,
    pub title: String,
    pub thumbnail: Option<String>,
    pub selection: Selection,
    pub status: QueueStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct HistoryItem {
    pub id: String,
    pub video_id: String,
    pub url: String,
    pub title: String,
    pub thumbnail: Option<String>,
    pub path: Option<String>,
    pub error: Option<String>,
    pub selection: Selection,
    pub status: HistoryStatus,
    pub finished_at: u64,
    #[serde(default)]
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ActiveProgress {
    pub id: String,
    pub percent: Option<f64>,
    pub speed: Option<String>,
    pub eta: Option<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Snapshot {
    pub queue: Vec<QueueEntry>,
    pub session: Vec<HistoryItem>,
    pub history: Vec<HistoryItem>,
    pub settings: Settings,
    pub progress: Option<ActiveProgress>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct EnqueueItem {
    pub url: String,
    #[serde(default)]
    pub video_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub thumbnail: Option<String>,
    pub selection: Selection,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkipReason {
    AlreadyQueued,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EnqueueOutcome {
    Added {
        id: String,
        video_id: String,
    },
    Skipped {
        video_id: String,
        reason: SkipReason,
    },
    Rejected {
        url: String,
        reason: RejectReason,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Engine {
    pub pending: Vec<Item>,
    pub active: Option<Item>,
    pub session: Vec<HistoryItem>,
    pub history: Vec<HistoryItem>,
    pub settings: Settings,
    pub progress: Option<ActiveProgress>,
    pub running: bool,
    pub cancel: bool,
    pub cancel_current: bool,
}

impl Engine {
    pub fn new(download_dir: impl Into<String>) -> Self {
        Self {
            pending: Vec::new(),
            active: None,
            session: Vec::new(),
            history: Vec::new(),
            settings: Settings {
                download_dir: download_dir.into(),
            },
            progress: None,
            running: false,
            cancel: false,
            cancel_current: false,
        }
    }

    pub fn enqueue(
        &mut self,
        items: Vec<EnqueueItem>,
        _download_dir: &Path,
    ) -> Vec<EnqueueOutcome> {
        let mut outcomes = Vec::with_capacity(items.len());
        for item in items {
            outcomes.push(self.enqueue_one(item));
        }
        outcomes
    }

    pub fn begin(&mut self) -> bool {
        if self.running || self.pending.is_empty() {
            return false;
        }
        self.running = true;
        self.cancel = false;
        true
    }

    pub fn take_next(&mut self) -> Option<Item> {
        if self.cancel || self.active.is_some() {
            return None;
        }
        let item = self.pending.first().cloned()?;
        self.pending.remove(0);
        self.progress = Some(ActiveProgress {
            id: item.id.clone(),
            percent: None,
            speed: None,
            eta: None,
        });
        self.active = Some(item.clone());
        Some(item)
    }

    pub fn set_progress(
        &mut self,
        percent: Option<f64>,
        speed: Option<String>,
        eta: Option<String>,
    ) {
        let Some(active) = &self.active else {
            self.progress = None;
            return;
        };
        self.progress = Some(ActiveProgress {
            id: active.id.clone(),
            percent,
            speed,
            eta,
        });
    }

    pub fn finish_active(
        &mut self,
        status: HistoryStatus,
        path: Option<String>,
        error: Option<String>,
    ) {
        let Some(item) = self.active.take() else {
            return;
        };
        self.progress = None;
        self.cancel_current = false;
        let size_bytes = if status == HistoryStatus::Success {
            path.as_deref()
                .and_then(|path| std::fs::metadata(path).ok())
                .map(|metadata| metadata.len())
        } else {
            None
        };
        self.session.push(HistoryItem {
            id: item.id,
            video_id: item.video_id,
            url: item.url,
            title: item.title,
            thumbnail: item.thumbnail,
            path,
            error,
            selection: item.selection,
            status,
            finished_at: now_secs(),
            size_bytes,
        });
    }

    pub fn update_metadata(&mut self, id: &str, title: &str, thumbnail: Option<String>) -> bool {
        let mut changed = false;
        if let Some(item) = self.active.as_mut().filter(|item| item.id == id) {
            changed |= fill_metadata(
                &mut item.title,
                &mut item.thumbnail,
                &item.video_id,
                &item.url,
                title,
                &thumbnail,
            );
        }
        for item in &mut self.pending {
            if item.id == id {
                changed |= fill_metadata(
                    &mut item.title,
                    &mut item.thumbnail,
                    &item.video_id,
                    &item.url,
                    title,
                    &thumbnail,
                );
            }
        }
        for item in self.session.iter_mut().chain(self.history.iter_mut()) {
            if item.id == id {
                changed |= fill_metadata(
                    &mut item.title,
                    &mut item.thumbnail,
                    &item.video_id,
                    &item.url,
                    title,
                    &thumbnail,
                );
            }
        }
        changed
    }

    pub fn archive_session_item(&mut self, id: &str) -> Result<(), String> {
        let Some(index) = self.session.iter().position(|item| item.id == id) else {
            return Err("not found".into());
        };
        if self.session[index].status != HistoryStatus::Success {
            return Err("only completed downloads can be archived".into());
        }
        let item = self.session.remove(index);
        self.push_history(item);
        Ok(())
    }

    pub fn archive_session_all(&mut self) -> bool {
        self.archive_completed_session_all() > 0
    }

    pub fn archive_completed_session_all(&mut self) -> usize {
        let mut archived = 0;
        let mut remaining = Vec::with_capacity(self.session.len());
        for item in std::mem::take(&mut self.session) {
            if item.status == HistoryStatus::Success {
                self.push_history(item);
                archived += 1;
            } else {
                remaining.push(item);
            }
        }
        self.session = remaining;
        archived
    }

    pub fn retry_failed_session(&mut self) -> usize {
        let failed = self
            .session
            .iter()
            .filter(|item| item.status == HistoryStatus::Failed)
            .cloned()
            .collect::<Vec<_>>();
        let mut retried = 0;
        for entry in failed {
            if self.contains_video(&entry.video_id) {
                continue;
            }
            self.pending.push(Item {
                id: new_id(),
                video_id: entry.video_id,
                url: entry.url,
                title: entry.title,
                thumbnail: entry.thumbnail,
                selection: entry.selection,
            });
            retried += 1;
        }
        retried
    }

    pub fn request_stop(&mut self) {
        if self.running || self.active.is_some() {
            self.cancel = true;
        }
    }

    pub fn end_run(&mut self) {
        self.running = false;
        self.cancel = false;
        self.cancel_current = false;
        self.progress = None;
    }

    pub fn cancel_item(&mut self, id: &str) -> Result<bool, String> {
        if self.active.as_ref().is_some_and(|item| item.id == id) {
            self.cancel_current = true;
            return Ok(true);
        }
        let Some(index) = self.pending.iter().position(|item| item.id == id) else {
            return Err("not found".into());
        };
        self.pending.remove(index);
        Ok(false)
    }

    pub fn remove_completed_session_item(&mut self, id: &str) -> Result<(), String> {
        let Some(index) = self
            .session
            .iter()
            .position(|item| item.id == id && item.status == HistoryStatus::Success)
        else {
            return Err("not found".into());
        };
        self.session.remove(index);
        Ok(())
    }

    pub fn remove_pending(&mut self, id: &str) -> Result<(), String> {
        if self.active.as_ref().is_some_and(|item| item.id == id) {
            return Err("download is active".into());
        }
        let Some(index) = self.pending.iter().position(|item| item.id == id) else {
            return Err("not found".into());
        };
        self.pending.remove(index);
        Ok(())
    }

    pub fn retry(&mut self, id: &str) -> Result<(), String> {
        let Some(entry) = self.history.iter().find(|item| item.id == id).cloned() else {
            return Err("not found".into());
        };
        if self.contains_video(&entry.video_id) {
            return Err("already queued".into());
        }
        self.pending.push(Item {
            id: new_id(),
            video_id: entry.video_id,
            url: entry.url,
            title: entry.title,
            thumbnail: entry.thumbnail,
            selection: entry.selection,
        });
        Ok(())
    }

    pub fn remove_history(&mut self, id: &str) -> Result<(), String> {
        let Some(index) = self.history.iter().position(|item| item.id == id) else {
            return Err("not found".into());
        };
        self.history.remove(index);
        Ok(())
    }

    pub fn clear_history(&mut self) {
        self.history.clear();
    }

    pub fn snapshot(&self) -> Snapshot {
        let mut queue = Vec::new();
        if let Some(active) = &self.active {
            queue.push(entry_from(active, QueueStatus::Active));
        }
        queue.extend(
            self.pending
                .iter()
                .map(|item| entry_from(item, QueueStatus::Pending)),
        );
        Snapshot {
            queue,
            session: self.session.clone(),
            history: self.history.clone(),
            settings: self.settings.clone(),
            progress: self.progress.clone(),
        }
    }

    fn push_history(&mut self, item: HistoryItem) {
        if self.history.iter().any(|existing| existing.id == item.id) {
            return;
        }
        self.history.push(item);
    }

    fn enqueue_one(&mut self, item: EnqueueItem) -> EnqueueOutcome {
        let url = item.url.trim().to_string();
        if let Err(reason) = screen_batch(&url) {
            return EnqueueOutcome::Rejected { url, reason };
        }
        let video_id = if item.video_id.trim().is_empty() {
            extract_video_id(&url).unwrap_or_default()
        } else {
            item.video_id.trim().to_string()
        };
        if video_id.is_empty() {
            return EnqueueOutcome::Rejected {
                url,
                reason: RejectReason::Unsupported,
            };
        }
        if self.contains_video(&video_id) {
            return EnqueueOutcome::Skipped {
                video_id,
                reason: SkipReason::AlreadyQueued,
            };
        }
        let id = new_id();
        let title = if item.title.trim().is_empty() {
            video_id.clone()
        } else {
            item.title.trim().to_string()
        };
        self.pending.push(Item {
            id: id.clone(),
            video_id: video_id.clone(),
            url,
            title,
            thumbnail: item.thumbnail,
            selection: item.selection,
        });
        EnqueueOutcome::Added { id, video_id }
    }

    fn contains_video(&self, video_id: &str) -> bool {
        self.pending.iter().any(|item| item.video_id == video_id)
            || self
                .active
                .as_ref()
                .is_some_and(|item| item.video_id == video_id)
    }
}

fn fill_metadata(
    current_title: &mut String,
    current_thumbnail: &mut Option<String>,
    video_id: &str,
    url: &str,
    title: &str,
    thumbnail: &Option<String>,
) -> bool {
    let mut changed = false;
    let title = title.trim();
    if !title.is_empty()
        && (current_title.is_empty() || current_title == video_id || current_title == url)
    {
        *current_title = title.to_string();
        changed = true;
    }
    if current_thumbnail.is_none() {
        if let Some(thumbnail) = thumbnail
            .as_ref()
            .filter(|thumbnail| !thumbnail.trim().is_empty())
        {
            *current_thumbnail = Some(thumbnail.clone());
            changed = true;
        }
    }
    changed
}

pub fn default_download_dir(downloads: &Path) -> std::path::PathBuf {
    downloads.join("Downly")
}

fn entry_from(item: &Item, status: QueueStatus) -> QueueEntry {
    QueueEntry {
        id: item.id.clone(),
        video_id: item.video_id.clone(),
        url: item.url.clone(),
        title: item.title.clone(),
        thumbnail: item.thumbnail.clone(),
        selection: item.selection.clone(),
        status,
    }
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{
        Engine, EnqueueItem, EnqueueOutcome, HistoryStatus, QueueStatus, SkipReason,
        default_download_dir,
    };
    use crate::engine::classify::RejectReason;
    use crate::engine::format::{Preset, Selection};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "downly-queue-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn item(video_id: &str, url: &str) -> EnqueueItem {
        EnqueueItem {
            url: url.into(),
            video_id: video_id.into(),
            title: format!("Title {video_id}"),
            thumbnail: Some(format!("https://img/{video_id}")),
            selection: Selection::Preset {
                preset: Preset::VideoBest,
                save_thumbnail: false,
                label: String::new(),
            },
        }
    }

    #[test]
    fn enqueue_allows_existing_files_but_skips_queue_duplicates() {
        let dir = scratch();
        let mut engine = Engine::new(dir.to_string_lossy().to_string());
        fs::write(dir.join("Old [bbb].mp4"), b"x").unwrap();
        let outcomes = engine.enqueue(
            vec![
                item("aaa", "https://www.youtube.com/watch?v=aaa"),
                item("aaa", "https://www.youtube.com/watch?v=aaa"),
                item("bbb", "https://www.youtube.com/watch?v=bbb"),
                item("ccc", "https://www.youtube.com/playlist?list=PLxxxx"),
                item("ddd", "https://www.youtube.com/@name"),
            ],
            &dir,
        );
        assert!(!engine.running);
        assert!(engine.active.is_none());
        assert_eq!(engine.pending.len(), 2);
        assert!(matches!(outcomes[0], EnqueueOutcome::Added { .. }));
        assert_eq!(
            outcomes[1],
            EnqueueOutcome::Skipped {
                video_id: "aaa".into(),
                reason: SkipReason::AlreadyQueued,
            }
        );
        assert!(matches!(outcomes[2], EnqueueOutcome::Added { .. }));
        assert_eq!(
            outcomes[3],
            EnqueueOutcome::Rejected {
                url: "https://www.youtube.com/playlist?list=PLxxxx".into(),
                reason: RejectReason::AddPlaylistsOnTheirOwn,
            }
        );
        assert_eq!(
            outcomes[4],
            EnqueueOutcome::Rejected {
                url: "https://www.youtube.com/@name".into(),
                reason: RejectReason::Channel,
            }
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn cancelling_active_item_leaves_following_item_ready() {
        let dir = scratch();
        let mut engine = Engine::new(dir.to_string_lossy().to_string());
        engine.enqueue(
            vec![
                item("aaa", "https://www.youtube.com/watch?v=aaa"),
                item("bbb", "https://www.youtube.com/watch?v=bbb"),
            ],
            &dir,
        );
        assert!(engine.begin());
        let active = engine.take_next().unwrap();
        assert!(engine.cancel_item(&active.id).unwrap());
        assert!(engine.cancel_current);
        engine.finish_active(HistoryStatus::Cancelled, None, None);
        assert!(!engine.cancel_current);
        assert_eq!(engine.take_next().unwrap().video_id, "bbb");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn successful_download_records_actual_file_size() {
        let dir = scratch();
        let output = dir.join("download.mp4");
        fs::write(&output, b"12345").unwrap();
        let mut engine = Engine::new(dir.to_string_lossy().to_string());
        engine.enqueue(
            vec![item("aaa", "https://www.youtube.com/watch?v=aaa")],
            &dir,
        );
        assert!(engine.begin());
        engine.take_next().unwrap();
        engine.finish_active(
            HistoryStatus::Success,
            Some(output.to_string_lossy().into_owned()),
            None,
        );
        assert_eq!(engine.session[0].size_bytes, Some(5));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn bulk_retry_and_archive_only_touch_the_expected_session_items() {
        let dir = scratch();
        let mut engine = Engine::new(dir.to_string_lossy().to_string());
        let selection = item("aaa", "https://www.youtube.com/watch?v=aaa").selection;
        engine.session = vec![
            super::HistoryItem {
                id: "done".into(),
                video_id: "done-video".into(),
                url: "https://www.youtube.com/watch?v=done-video".into(),
                title: "Done".into(),
                thumbnail: None,
                path: None,
                error: None,
                selection: selection.clone(),
                status: HistoryStatus::Success,
                finished_at: 1,
                size_bytes: Some(12),
            },
            super::HistoryItem {
                id: "failed".into(),
                video_id: "failed-video".into(),
                url: "https://www.youtube.com/watch?v=failed-video".into(),
                title: "Failed".into(),
                thumbnail: None,
                path: None,
                error: Some("failed".into()),
                selection,
                status: HistoryStatus::Failed,
                finished_at: 2,
                size_bytes: None,
            },
        ];
        assert_eq!(engine.retry_failed_session(), 1);
        assert_eq!(engine.pending[0].video_id, "failed-video");
        assert_eq!(engine.archive_completed_session_all(), 1);
        assert_eq!(engine.history.len(), 1);
        assert_eq!(engine.history[0].id, "done");
        assert_eq!(engine.session.len(), 1);
        assert_eq!(engine.session[0].status, HistoryStatus::Failed);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn start_drains_in_order_and_stop_leaves_the_rest() {
        let dir = scratch();
        let mut engine = Engine::new(dir.to_string_lossy().to_string());
        engine.enqueue(
            vec![
                item("aaa", "https://www.youtube.com/watch?v=aaa"),
                item("bbb", "https://www.youtube.com/watch?v=bbb"),
            ],
            &dir,
        );
        assert!(engine.begin());
        assert!(!engine.begin());
        let first = engine.take_next().unwrap();
        assert_eq!(first.video_id, "aaa");
        assert!(engine.take_next().is_none());
        engine.enqueue(
            vec![item("ccc", "https://www.youtube.com/watch?v=ccc")],
            &dir,
        );
        engine.finish_active(HistoryStatus::Success, Some("a.mp4".into()), None);
        let second = engine.take_next().unwrap();
        assert_eq!(second.video_id, "bbb");
        engine.request_stop();
        engine.finish_active(HistoryStatus::Cancelled, None, None);
        assert!(engine.take_next().is_none());
        engine.end_run();
        assert!(!engine.running);
        assert!(engine.active.is_none());
        assert_eq!(engine.pending.len(), 1);
        assert_eq!(engine.pending[0].video_id, "ccc");
        assert!(engine.history.is_empty());
        assert_eq!(engine.session.len(), 2);
        assert_eq!(engine.session[0].status, HistoryStatus::Success);
        assert_eq!(engine.session[1].status, HistoryStatus::Cancelled);
        assert!(engine.archive_session_all());
        assert_eq!(engine.session.len(), 1);
        assert_eq!(engine.session[0].status, HistoryStatus::Cancelled);
        assert_eq!(engine.history.len(), 1);
        assert!(!engine.archive_session_all());
        let snap = engine.snapshot();
        assert_eq!(snap.queue.len(), 1);
        assert_eq!(snap.queue[0].status, QueueStatus::Pending);
        assert!(snap.progress.is_none());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn remove_retry_and_history_leave_files() {
        let dir = scratch();
        let mut engine = Engine::new(dir.to_string_lossy().to_string());
        engine.enqueue(
            vec![
                item("aaa", "https://www.youtube.com/watch?v=aaa"),
                item("bbb", "https://www.youtube.com/watch?v=bbb"),
            ],
            &dir,
        );
        let pending_id = engine.pending[1].id.clone();
        engine.begin();
        let active_id = engine.take_next().unwrap().id;
        assert_eq!(
            engine.remove_pending(&active_id).unwrap_err(),
            "download is active"
        );
        engine.remove_pending(&pending_id).unwrap();
        assert!(engine.pending.is_empty());
        engine.finish_active(HistoryStatus::Failed, None, Some("boom".into()));
        let history_id = engine.session[0].id.clone();
        assert_eq!(
            engine.archive_session_item(&history_id).unwrap_err(),
            "only completed downloads can be archived"
        );
        assert_eq!(engine.session.len(), 1);
        engine.retry_failed_session();
        assert_eq!(engine.pending.len(), 1);
        assert_eq!(engine.session.len(), 1);
        let kept = dir.join("kept [aaa].mp4");
        fs::write(&kept, b"file").unwrap();
        engine.history.push(HistoryItem {
            id: "completed-id".into(),
            video_id: "aaa".into(),
            url: "https://www.youtube.com/watch?v=aaa".into(),
            title: "aaa".into(),
            thumbnail: None,
            selection: engine.pending[0].selection.clone(),
            status: HistoryStatus::Success,
            path: Some(kept.to_string_lossy().to_string()),
            error: None,
            finished_at: 1,
            size_bytes: Some(4),
        });
        engine.pending.clear();
        engine.pending.clear();
        engine.retry("completed-id").unwrap();
        assert_eq!(engine.pending.len(), 1);
        assert_eq!(engine.pending[0].video_id, "aaa");
        assert_eq!(engine.pending[0].selection, engine.history[0].selection);
        assert_ne!(engine.pending[0].id, history_id);
        engine.remove_history("completed-id").unwrap();
        engine.clear_history();
        assert!(engine.history.is_empty());
        assert!(kept.is_file());
        assert!(default_download_dir(std::path::Path::new("D:/Downloads")).ends_with("Downly"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn metadata_fills_pending_active_and_recent_session_placeholders() {
        let dir = scratch();
        let mut engine = Engine::new(dir.to_string_lossy().to_string());
        let mut pending = item("aaa", "https://www.youtube.com/watch?v=aaa");
        pending.title.clear();
        pending.thumbnail = None;
        let mut active = item("bbb", "https://www.youtube.com/watch?v=bbb");
        active.title.clear();
        active.thumbnail = None;
        let mut recent = item("ccc", "https://www.youtube.com/watch?v=ccc");
        recent.title.clear();
        recent.thumbnail = None;
        engine.enqueue(vec![pending, active, recent], &dir);
        let pending_id = engine.pending[0].id.clone();
        assert!(engine.update_metadata(
            &pending_id,
            "Resolved title",
            Some("https://img.test/thumb.jpg".into())
        ));
        assert_eq!(engine.pending[0].title, "Resolved title");
        assert_eq!(
            engine.pending[0].thumbnail.as_deref(),
            Some("https://img.test/thumb.jpg")
        );
        engine.remove_pending(&pending_id).unwrap();
        let active_id = engine.pending[0].id.clone();
        engine.begin();
        engine.take_next().unwrap();
        assert!(engine.update_metadata(
            &active_id,
            "Active title",
            Some("https://img.test/active.jpg".into())
        ));
        assert_eq!(engine.active.as_ref().unwrap().title, "Active title");
        engine.finish_active(HistoryStatus::Success, None, None);
        let recent_id = engine.pending[0].id.clone();
        engine.take_next().unwrap();
        engine.finish_active(HistoryStatus::Success, None, None);
        assert!(engine.update_metadata(
            &recent_id,
            "Recent title",
            Some("https://img.test/recent.jpg".into())
        ));
        assert_eq!(engine.session[1].title, "Recent title");
        assert_eq!(
            engine.session[1].thumbnail.as_deref(),
            Some("https://img.test/recent.jpg")
        );
        let _ = fs::remove_dir_all(dir);
    }
}
