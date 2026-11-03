import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AppUpdate, EnqueueItem, EnqueueOutcome, PlaylistSummary, ProbeOutcome, Snapshot } from "@/lib/downly";

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

export function updateQueueMetadata(id: string, title: string, thumbnail: string | null) {
	return invoke<void>("update_queue_metadata", { id, title, thumbnail });
}

export function start() {
	return invoke<void>("start");
}

export function stop() {
	return invoke<void>("stop");
}

export function remove(id: string) {
	return invoke<void>("remove", { id });
}

export function cancelItem(id: string) {
	return invoke<void>("cancel_item", { id });
}

export function setDownloadDir(path: string) {
	return invoke<void>("set_download_dir", { path });
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

export function archiveCompletedSessionAll() {
	return invoke<number>("archive_completed_session_all");
}

export function deleteCompletedSessionItem(id: string) {
	return invoke<void>("delete_completed_session_item", { id });
}

export function clearHistory() {
	return invoke<void>("clear_history");
}

export function updateYtdlp() {
	return invoke<string>("update_ytdlp");
}

export function ytdlpVersion() {
	return invoke<string>("ytdlp_version");
}

export type YtdlpInfo = {
	version: string;
	path: string;
};

export function ytdlpInfo() {
	return invoke<YtdlpInfo>("ytdlp_info");
}

export function appVersion() {
	return invoke<string>("app_version");
}

export function checkYtdlpUpdate() {
	return invoke<AppUpdate | null>("check_ytdlp_update");
}

export function checkAppUpdate() {
	return invoke<AppUpdate | null>("check_app_update");
}

export function onState(handler: (snapshot: Snapshot) => void): Promise<UnlistenFn> {
	return listen<Snapshot>("downly-state", (event) => {
		handler(event.payload);
	});
}
