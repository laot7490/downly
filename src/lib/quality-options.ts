import { selectionFromFormat, type MediaFormat, type Preset, type Selection } from "@/lib/downly";

export type ContainerKind = "mp4" | "mp3" | "m4a";

export type QualityOption = {
	id: string;
	label: string;
	selection: Selection;
	sizeBytes?: number;
};

const BITRATES = [320, 256, 192, 128, 96, 64];

const videoPresets: { id: string; preset: Preset; label: string }[] = [
	{ id: "video_best", preset: "video_best", label: "best" },
	{ id: "video_8k", preset: "video_8k", label: "8K" },
	{ id: "video_4k", preset: "video_4k", label: "4K" },
	{ id: "video_2k", preset: "video_2k", label: "2K" },
	{ id: "video_1080", preset: "video_1080", label: "1080p" },
	{ id: "video_720", preset: "video_720", label: "720p" },
	{ id: "video_480", preset: "video_480", label: "480p" },
	{ id: "video_360", preset: "video_360", label: "360p" },
	{ id: "video_240", preset: "video_240", label: "240p" },
	{ id: "video_144", preset: "video_144", label: "144p" },
];

const audioPresets: { id: string; preset: Preset; label: string }[] = [
	{ id: "audio_best", preset: "audio_best", label: "best" },
	{ id: "audio_320", preset: "audio_320", label: "320 kbps" },
	{ id: "audio_256", preset: "audio_256", label: "256 kbps" },
	{ id: "audio_192", preset: "audio_192", label: "192 kbps" },
	{ id: "audio_128", preset: "audio_128", label: "128 kbps" },
];

export function describeSelection(selection: Selection, best: string): string {
	if (selection.label) {
		return selection.label;
	}
	if (selection.type === "preset") {
		return presetLabel(selection.preset, best);
	}
	if (selection.mp3_bitrate) {
		return `MP3 · ${selection.mp3_bitrate} kbps`;
	}
	if (selection.kind === "audio") {
		return "M4A";
	}
	return "MP4";
}

export function presetLabel(preset: Preset, best: string): string {
	switch (preset) {
		case "video_best":
			return `MP4 · ${best}`;
		case "video_8k":
			return "MP4 · 8K";
		case "video_4k":
			return "MP4 · 4K";
		case "video_2k":
			return "MP4 · 2K";
		case "video_1080":
			return "MP4 · 1080p";
		case "video_720":
			return "MP4 · 720p";
		case "video_480":
			return "MP4 · 480p";
		case "video_360":
			return "MP4 · 360p";
		case "video_240":
			return "MP4 · 240p";
		case "video_144":
			return "MP4 · 144p";
		case "audio_best":
			return `MP3 · ${best}`;
		case "audio_320":
			return "MP3 · 320 kbps";
		case "audio_256":
			return "MP3 · 256 kbps";
		case "audio_192":
			return "MP3 · 192 kbps";
		case "audio_128":
			return "MP3 · 128 kbps";
	}
}

export function presetChoices(container: "mp4" | "mp3", best: string): QualityOption[] {
	const rows = container === "mp4" ? videoPresets : audioPresets;
	return rows.map((row) => ({
		id: row.id,
		label: row.label === "best" ? best : row.label,
		selection: {
			type: "preset",
			preset: row.preset,
			save_thumbnail: false,
			label: presetLabel(row.preset, best),
		},
	}));
}

export function availableContainers(formats: MediaFormat[]): ContainerKind[] {
	const containers: ContainerKind[] = [];
	if (formats.some((format) => heightOf(format) != null)) {
		containers.push("mp4");
	}
	if (formats.some((format) => !format.storyboard && (format.audio_only || format.acodec))) {
		containers.push("mp3");
	}
	if (formats.some(isM4a)) {
		containers.push("m4a");
	}
	return containers;
}

export function qualityChoices(
	container: ContainerKind,
	formats: MediaFormat[],
	duration: number | null,
	best: string,
): QualityOption[] {
	if (container === "mp4") {
		return withBest(container, videoChoices(formats), best);
	}
	if (container === "mp3") {
		return withBest(container, mp3Choices(formats, duration), best);
	}
	return withBest(container, m4aChoices(formats, duration), best);
}

export function bestQualityId(container: ContainerKind): string {
	if (container === "mp4") {
		return "video_best";
	}
	if (container === "mp3") {
		return "audio_best";
	}
	return "m4a-best";
}

function videoChoices(formats: MediaFormat[]): QualityOption[] {
	const groups = new Map<string, { height: number; format: MediaFormat }>();
	for (const format of formats) {
		const height = heightOf(format);
		if (height == null) {
			continue;
		}
		const name = heightLabel(height);
		const current = groups.get(name);
		if (!current || scoreVideo(format) > scoreVideo(current.format)) {
			groups.set(name, { height, format });
		}
	}
	return [...groups.values()]
		.sort((a, b) => b.height - a.height)
		.map((entry) => {
			const name = heightLabel(entry.height);
			const label = `MP4 · ${name}`;
			return {
				id: `mp4-${name}`,
				label: name,
				selection: { ...selectionFromFormat(entry.format, false, null), label },
				sizeBytes: estimateVideoBytes(entry.format, formats),
			};
		});
}

function withBest(container: ContainerKind, rows: QualityOption[], best: string): QualityOption[] {
	const head = bestOption(container, best, rows[0]);
	return [head, ...rows.filter((row) => row.id !== head.id)];
}

function bestOption(container: ContainerKind, best: string, sample?: QualityOption): QualityOption {
	if (container === "mp4") {
		return {
			id: "video_best",
			label: best,
			selection: {
				type: "preset",
				preset: "video_best",
				save_thumbnail: false,
				label: presetLabel("video_best", best),
			},
			sizeBytes: sample?.sizeBytes,
		};
	}
	if (container === "mp3") {
		return {
			id: "audio_best",
			label: best,
			selection: {
				type: "preset",
				preset: "audio_best",
				save_thumbnail: false,
				label: presetLabel("audio_best", best),
			},
			sizeBytes: sample?.sizeBytes,
		};
	}
	if (sample) {
		return {
			...sample,
			id: "m4a-best",
			label: best,
			selection: { ...sample.selection, label: `M4A · ${best}` },
		};
	}
	return {
		id: "m4a-best",
		label: best,
		selection: {
			type: "preset",
			preset: "audio_best",
			save_thumbnail: false,
			label: `M4A · ${best}`,
		},
	};
}

function mp3Choices(formats: MediaFormat[], duration: number | null): QualityOption[] {
	const audio = formats.filter((format) => format.audio_only && !format.storyboard);
	const source = audio.length > 0 ? audio : formats.filter((format) => !format.storyboard);
	const rates = new Set<number>();
	for (const format of source) {
		const rate = bitrateOf(format, duration);
		if (rate != null) {
			rates.add(bucket(rate));
		}
	}
	const ordered = BITRATES.filter((rate) => rates.has(rate));
	if (ordered.length === 0) {
		return [];
	}
	const carrier = [...source].sort((a, b) => (bitrateOf(b, duration) ?? 0) - (bitrateOf(a, duration) ?? 0))[0];
	return ordered.map((rate) => {
		const label = `MP3 · ${rate} kbps`;
		if (carrier?.audio_only) {
			return {
				id: `mp3-${rate}`,
				label: `${rate} kbps`,
				selection: { ...selectionFromFormat(carrier, false, rate), label },
				sizeBytes: estimateBitrateBytes(rate, duration),
			};
		}
		return {
			id: `mp3-${rate}`,
			label: `${rate} kbps`,
			selection: {
				type: "preset",
				preset: presetForRate(rate),
				save_thumbnail: false,
				label,
			},
				sizeBytes: estimateBitrateBytes(rate, duration),
		};
	});
}

function m4aChoices(formats: MediaFormat[], duration: number | null): QualityOption[] {
	const audio = formats.filter(isM4a);
	const groups = new Map<string, { format: MediaFormat; rate: number | null }>();
	for (const format of audio) {
		const rate = bitrateOf(format, duration);
		const key = rate == null ? "plain" : String(bucket(rate));
		const current = groups.get(key);
		if (!current || scoreAudio(format) > scoreAudio(current.format)) {
			groups.set(key, { format, rate: rate == null ? null : bucket(rate) });
		}
	}
	return [...groups.values()]
		.sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))
		.map((entry) => {
			const name = entry.rate == null ? "M4A" : `${entry.rate} kbps`;
			const label = entry.rate == null ? "M4A" : `M4A · ${entry.rate} kbps`;
			return {
				id: `m4a-${entry.rate ?? "plain"}`,
				label: name,
				selection: { ...selectionFromFormat(entry.format, false, null), label },
				sizeBytes: mediaSize(entry.format),
			};
		});
}

function presetForRate(rate: number): Preset {
	if (rate >= 320) {
		return "audio_320";
	}
	if (rate >= 256) {
		return "audio_256";
	}
	if (rate >= 192) {
		return "audio_192";
	}
	return "audio_128";
}

function heightOf(format: MediaFormat): number | null {
	if (format.storyboard || format.audio_only) {
		return null;
	}
	const resolution = format.resolution ?? "";
	const pair = resolution.match(/(\d+)\s*[x×]\s*(\d+)/i);
	if (pair) {
		return Number(pair[2]);
	}
	const progressive = resolution.match(/(\d+)\s*p/i);
	if (progressive) {
		return Number(progressive[1]);
	}
	return null;
}

function heightLabel(height: number): string {
	if (height >= 4320) {
		return "8K";
	}
	if (height >= 2160) {
		return "4K";
	}
	if (height >= 1440) {
		return "2K";
	}
	return `${height}p`;
}

function isM4a(format: MediaFormat): boolean {
	if (!format.audio_only || format.storyboard) {
		return false;
	}
	const ext = (format.ext ?? "").toLowerCase();
	const acodec = (format.acodec ?? "").toLowerCase();
	return ext === "m4a" || ext === "mp4" || acodec.startsWith("mp4a") || acodec.startsWith("aac");
}

function bitrateOf(format: MediaFormat, duration: number | null): number | null {
	const note = format.note ?? "";
	const tagged = note.match(/(\d{2,4})\s*k(?:bps|b\/s|b)?/i);
	if (tagged) {
		return Number(tagged[1]);
	}
	const size = format.filesize ?? format.filesize_approx;
	if (size && duration && duration > 1) {
		return Math.round((size * 8) / duration / 1000);
	}
	return null;
}

function bucket(kbps: number): number {
	if (kbps >= 380) {
		return 320;
	}
	let nearest = BITRATES[BITRATES.length - 1];
	let distance = Number.POSITIVE_INFINITY;
	for (const step of BITRATES) {
		const gap = Math.abs(step - kbps);
		if (gap < distance) {
			distance = gap;
			nearest = step;
		}
	}
	return nearest;
}

function scoreVideo(format: MediaFormat): number {
	let score = format.filesize ?? format.filesize_approx ?? 0;
	if ((format.ext ?? "").toLowerCase() === "mp4") {
		score += 1_000_000_000_000;
	}
	const codec = (format.vcodec ?? "").toLowerCase();
	if (codec.startsWith("avc") || codec.startsWith("h264")) {
		score += 100_000_000_000;
	}
	score += (format.fps ?? 0) * 1_000_000;
	return score;
}

function scoreAudio(format: MediaFormat): number {
	let score = format.filesize ?? format.filesize_approx ?? 0;
	if ((format.ext ?? "").toLowerCase() === "m4a") {
		score += 1_000_000_000_000;
	}
	return score;
}

function estimateVideoBytes(format: MediaFormat, formats: MediaFormat[]): number | undefined {
	const videoSize = mediaSize(format);
	if (videoSize == null) {
		return undefined;
	}
	if (!format.video_only) {
		return videoSize;
	}
	const audio = formats
		.filter((candidate) => candidate.audio_only && !candidate.storyboard)
		.sort((a, b) => scoreAudio(b) - scoreAudio(a))[0];
	const audioSize = audio ? mediaSize(audio) : undefined;
	return audioSize == null ? undefined : videoSize + audioSize;
}

function mediaSize(format: MediaFormat): number | undefined {
	return format.filesize ?? format.filesize_approx ?? undefined;
}

function estimateBitrateBytes(kbps: number, duration: number | null): number | undefined {
	return duration != null && duration > 0 ? Math.round((duration * kbps * 1000) / 8) : undefined;
}
