import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CookiesBrowser, EnqueueItem, EnqueueOutcome, PlaylistSummary, ProbeOutcome, Snapshot, ToolProgress, ToolsAction, ToolsStatus } from "@/lib/downly";

export function getState() {
	return invoke<Snapshot>("state");
}

export function probe(url: string) {
	return invoke<ProbeOutcome>("probe", { url });
}

export function expandPlaylist(url: string) {
	return invoke<PlaylistSummary>("expand_playlist", { url });
}

export function enqueue(items: EnqueueItem[]) {
	return invoke<EnqueueOutcome[]>("enqueue", { items });
}

export function updateQueueMetadata(id: string, videoId: string, title: string, thumbnail: string | null, durationSeconds: number | null, isLive?: boolean) {
	return invoke<void>("update_queue_metadata", { id, videoId, title, thumbnail, durationSeconds, isLive });
}

export function start() {
	return invoke<void>("start");
}

export function stop() {
	return invoke<void>("stop");
}

export function finishLiveRecording() {
	return invoke<void>("finish_live_recording");
}

export function remove(id: string) {
	return invoke<void>("remove", { id });
}

export function cancelItem(id: string) {
	return invoke<void>("cancel_item", { id });
}

export function reorderQueueItem(id: string, beforeId: string | null) {
	return invoke<boolean>("reorder_queue_item", { id, beforeId });
}

export function clearQueue() {
	return invoke<void>("clear_queue");
}

export function setDownloadDir(path: string) {
	return invoke<void>("set_download_dir", { path });
}

export function setCookiesBrowser(browser: CookiesBrowser) {
	return invoke<void>("set_cookies_browser", { browser });
}

export function setDownloadSpeedLimit(limitBytesPerSecond: number | null) {
	return invoke<void>("set_download_speed_limit", { limitBytesPerSecond });
}

export function importCookiesFile(path: string) {
	return invoke<void>("import_cookies_file", { path });
}

export function openPath(path: string) {
	return invoke<void>("open_path", { path });
}

export function revealPath(path: string) {
	return invoke<void>("reveal_path", { path });
}

export function retryHistory(id: string) {
	return invoke<void>("retry_history", { id });
}

export function removeHistory(id: string) {
	return invoke<void>("remove_history", { id });
}

export function archiveSession(id: string) {
	return invoke<void>("archive_session", { id });
}

export function archiveSessionAll() {
	return invoke<void>("archive_session_all");
}

export function retryFailedSession() {
	return invoke<number>("retry_failed_session");
}

export function retryFailedSessionItem(id: string) {
	return invoke<void>("retry_failed_session_item", { id });
}

export function retryCancelledSessionItem(id: string) {
	return invoke<void>("retry_cancelled_session_item", { id });
}

export function removeCancelledSessionItem(id: string) {
	return invoke<void>("remove_cancelled_session_item", { id });
}

export function removeFailedSessionItem(id: string) {
	return invoke<void>("remove_failed_session_item", { id });
}

export function archiveCompletedSessionAll() {
	return invoke<number>("archive_completed_session_all");
}

export function deleteCompletedSessionItem(id: string) {
	return invoke<void>("delete_completed_session_item", { id });
}

export function clearHistory() {
	return invoke<void>("clear_history");
}

export function appVersion() {
	return invoke<string>("app_version");
}

export function manageTools(action: ToolsAction) {
	return invoke<ToolsStatus>("tools", { action });
}

export function onState(handler: (snapshot: Snapshot) => void): Promise<UnlistenFn> {
	return listen<Snapshot>("downly-state", (event) => {
		handler(event.payload);
	});
}

export type TransferProgress = { id: string; percent: number };

export function onTransferProgress(handler: (progress: TransferProgress) => void): Promise<UnlistenFn> {
	return listen<TransferProgress>("downly-transfer-progress", (event) => {
		handler(event.payload);
	});
}

export function onToolsProgress(handler: (progress: ToolProgress) => void): Promise<UnlistenFn> {
	return listen<ToolProgress>("downly-tools-progress", (event) => {
		handler(event.payload);
	});
}
