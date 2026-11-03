export type RejectReason = "add_playlists_on_their_own" | "channel" | "home" | "feed" | "unsupported" | "live";

export type FormatKind = "video" | "audio" | "storyboard" | "mixed";

export type Preset =
	| "video_best"
	| "video_8k"
	| "video_4k"
	| "video_2k"
	| "video_1080"
	| "video_720"
	| "video_480"
	| "video_360"
	| "video_240"
	| "video_144"
	| "audio_best"
	| "audio_320"
	| "audio_256"
	| "audio_192"
	| "audio_128";

export type MediaFormat = {
	format_id: string;
	ext: string | null;
	resolution: string | null;
	fps: number | null;
	vcodec: string | null;
	acodec: string | null;
	filesize: number | null;
	filesize_approx: number | null;
	protocol: string | null;
	note: string | null;
	video_only: boolean;
	audio_only: boolean;
	storyboard: boolean;
};

export type PlaylistEntry = {
	url: string;
	title: string | null;
	id: string | null;
	thumbnail: string | null;
};

export type ProbeOutcome =
	| {
			kind: "video";
			id: string;
			title: string;
			duration: number | null;
			channel: string | null;
			thumbnail: string | null;
			view_count: number | null;
			formats: MediaFormat[];
	  }
	| {
			kind: "playlist";
			title: string | null;
			count: number;
			entries: PlaylistEntry[];
	  }
	| {
			kind: "rejected";
			reason: RejectReason;
	  };

export type PlaylistSummary = {
	title: string | null;
	count: number;
	entries: PlaylistEntry[];
};

export type Selection =
	| {
			type: "format";
			format_id: string;
			pair_best_audio: boolean;
			mp3_bitrate: number | null;
			save_thumbnail: boolean;
			kind: FormatKind;
			vcodec: string;
			acodec: string;
			label: string;
	  }
	| {
			type: "preset";
			preset: Preset;
			save_thumbnail: boolean;
			label: string;
	  };

export type EnqueueItem = {
	url: string;
	video_id: string;
	title: string;
	thumbnail: string | null;
	selection: Selection;
	size_bytes: number | null;
};

export type EnqueueOutcome =
	| { kind: "added"; id: string; video_id: string }
	| {
			kind: "skipped";
			video_id: string;
			reason: "already_queued";
	  }
	| { kind: "rejected"; url: string; reason: RejectReason };

export type QueueEntry = {
	id: string;
	video_id: string;
	url: string;
	title: string;
	thumbnail: string | null;
	selection: Selection;
	status: "pending" | "active";
	size_bytes: number | null;
};

export type HistoryItem = {
	id: string;
	video_id: string;
	url: string;
	title: string;
	thumbnail: string | null;
	path: string | null;
	error: string | null;
	selection: Selection;
	status: "success" | "failed" | "cancelled";
	finished_at: number;
	size_bytes: number | null;
};

export type ActiveProgress = {
	id: string;
	percent: number | null;
	speed: string | null;
	eta: string | null;
};

export type Snapshot = {
	queue: QueueEntry[];
	session: HistoryItem[];
	history: HistoryItem[];
	settings: { download_dir: string; cookies_browser: CookiesBrowser; cookies_updated_at: number | null };
	progress: ActiveProgress | null;
};

export type CookiesBrowser = "disabled" | "firefox" | "manual";

export type AppUpdate = {
	version: string;
	current: string;
	newer: boolean;
	url: string | null;
};

export function linesOf(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

export function formatBytes(size: number | null | undefined): string {
	if (size == null || size <= 0) {
		return "";
	}
	const units = ["B", "KB", "MB", "GB"];
	let value = size;
	let index = 0;
	while (value >= 1024 && index < units.length - 1) {
		value /= 1024;
		index += 1;
	}
	return `${value < 10 && index > 0 ? value.toFixed(1) : Math.round(value)} ${units[index]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
	if (seconds == null || !Number.isFinite(seconds) || seconds < 0) {
		return "";
	}
	const total = Math.floor(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0) {
		return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
	}
	return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatCount(value: number | null | undefined): string {
	if (value == null || !Number.isFinite(value) || value < 0) {
		return "";
	}
	return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function isYouTube(url: string): boolean {
	try {
		const host = new URL(url).hostname.replace(/^www\./, "");
		return host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com");
	} catch {
		return false;
	}
}

export function watchUrlWithoutList(url: string): string | null {
	try {
		const parsed = new URL(url);
		const id = parsed.searchParams.get("v");
		if (!id) {
			return null;
		}
		return `https://www.youtube.com/watch?v=${id}`;
	} catch {
		return null;
	}
}

export function selectionFromFormat(format: MediaFormat, saveThumbnail: boolean, mp3Bitrate: number | null): Selection {
	if (format.storyboard) {
		return {
			type: "format",
			format_id: format.format_id,
			pair_best_audio: false,
			mp3_bitrate: null,
			save_thumbnail: false,
			kind: "storyboard",
			vcodec: format.vcodec ?? "",
			acodec: format.acodec ?? "",
			label: "",
		};
	}
	if (format.audio_only) {
		return {
			type: "format",
			format_id: format.format_id,
			pair_best_audio: false,
			mp3_bitrate: mp3Bitrate,
			save_thumbnail: saveThumbnail,
			kind: "audio",
			vcodec: format.vcodec ?? "",
			acodec: format.acodec ?? "",
			label: "",
		};
	}
	if (format.video_only) {
		return {
			type: "format",
			format_id: format.format_id,
			pair_best_audio: true,
			mp3_bitrate: null,
			save_thumbnail: saveThumbnail,
			kind: "video",
			vcodec: format.vcodec ?? "",
			acodec: format.acodec ?? "",
			label: "",
		};
	}
	return {
		type: "format",
		format_id: format.format_id,
		pair_best_audio: false,
		mp3_bitrate: null,
		save_thumbnail: saveThumbnail,
		kind: "mixed",
		vcodec: format.vcodec ?? "",
		acodec: format.acodec ?? "",
		label: "",
	};
}
