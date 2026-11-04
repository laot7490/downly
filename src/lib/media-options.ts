import { selectionFromFormat, type MediaFormat, type Selection } from "@/lib/downly";

export type MediaCategory = "video" | "audio" | "image";
export type FormatChoice = { id: string; ext: string; label: string; category: MediaCategory; generated?: boolean };
export type QualityChoice = { id: string; label: string; selection: Selection; sizeBytes?: number };

const imageExtensions = new Set(["apng", "avif", "bmp", "gif", "heic", "jpeg", "jpg", "png", "tif", "tiff", "webp"]);

export function formatChoices(formats: MediaFormat[]): FormatChoice[] {
	const video = new Set<string>();
	const audio = new Set<string>();
	const images = new Set<string>();
	let hasAnyAudio = false;
	for (const format of formats) {
		if (format.storyboard || !format.ext) continue;
		const ext = format.ext.toLowerCase();
		const hasVideo = Boolean(format.vcodec && format.vcodec.toLowerCase() !== "none");
		const hasAudioFormat = Boolean(format.acodec && format.acodec.toLowerCase() !== "none");
		if (imageExtensions.has(ext)) images.add(ext);
		else {
			if (hasVideo) video.add(ext);
			if (hasAudioFormat && format.audio_only) audio.add(ext);
			if (hasAudioFormat) hasAnyAudio = true;
		}
	}
	const videoOptions = sortExtensions(video, ["mp4", "webm", "mkv", "mov"]).map((ext) => choice("video", ext));
	if (video.size && !video.has("mp4")) videoOptions.unshift({ ...choice("video", "mp4"), generated: true });
	const audioOptions = sortExtensions(audio, ["mp3", "m4a", "wav", "ogg", "opus", "flac", "aac"]).map((ext) => choice("audio", ext));
	if (hasAnyAudio && !audio.has("mp3")) audioOptions.unshift({ ...choice("audio", "mp3"), generated: true });
	return [
		...videoOptions,
		...audioOptions,
		...sortExtensions(images, ["jpg", "jpeg", "png", "webp", "gif", "avif"]).map((ext) => choice("image", ext)),
	];
}

export function defaultFormatChoice(formats: MediaFormat[]): FormatChoice | null {
	const choices = formatChoices(formats);
	return choices.find((entry) => entry.id === "video:mp4") ?? choices.find((entry) => entry.id === "audio:mp3") ?? choices[0] ?? null;
}

export function qualityChoices(format: FormatChoice, formats: MediaFormat[], duration: number | null, best: string): QualityChoice[] {
	const sources = formats.filter((entry) => !entry.storyboard && sourceMatches(format, entry));
	if (format.category === "image") {
		const source = [...sources].sort((a, b) => size(b) - size(a))[0];
		return source ? [{ id: "best", label: best, selection: toSelection(source, format), sizeBytes: size(source) || undefined }] : [];
	}
	if (format.category === "video") {
		const variants = uniqueValues(sources, (entry) => videoHeight(entry), (entry) => size(entry));
		const bestSource = variants[0]?.format ?? bestBy(sources, videoHeight, size);
		return [
			...(bestSource ? [{ id: "best", label: best, selection: toSelection(bestSource, format), sizeBytes: size(bestSource) || undefined }] : []),
			...variants.map(({ value, format: source, bytes }) => ({ id: `height-${value}`, label: heightLabel(value), selection: toSelection(source, format), sizeBytes: bytes || undefined })),
		];
	}
	const variants = uniqueValues(sources, (entry) => bitrate(entry, duration), (entry) => size(entry));
	const bestSource = variants[0]?.format ?? bestBy(sources, (entry) => bitrate(entry, duration), size);
	return [
		...(bestSource ? [{ id: "best", label: best, selection: toSelection(bestSource, format), sizeBytes: size(bestSource) || undefined }] : []),
		...variants.map(({ value, format: source, bytes }) => ({ id: `bitrate-${value}`, label: `${value} kbps`, selection: toSelection(source, format, format.ext === "mp3" ? value : null), sizeBytes: bytes || undefined })),
	];
}

function choice(category: MediaCategory, ext: string): FormatChoice {
	return { id: `${category}:${ext}`, ext, label: displayExtension(ext), category };
}

function sourceMatches(choice: FormatChoice, format: MediaFormat): boolean {
	const ext = format.ext?.toLowerCase();
	if (choice.generated && choice.category === "video") return Boolean(format.vcodec && format.vcodec.toLowerCase() !== "none");
	if (choice.generated && choice.category === "audio") return Boolean(format.acodec && format.acodec.toLowerCase() !== "none");
	if (choice.category === "image") return ext === choice.ext && imageExtensions.has(choice.ext);
	return ext === choice.ext && (choice.category === "audio" ? format.audio_only && Boolean(format.acodec && format.acodec.toLowerCase() !== "none") : Boolean(format.vcodec && format.vcodec.toLowerCase() !== "none"));
}

function toSelection(source: MediaFormat, choice: FormatChoice, bitrate: number | null = null): Selection {
	const selected = selectionFromFormat(source, false, bitrate);
	return { ...selected, kind: choice.category === "image" ? "image" : choice.category === "audio" ? "audio" : source.video_only ? "video" : "mixed", output_format: choice.ext };
}

function sortExtensions(values: Set<string>, priority: string[]): string[] {
	return [...values].sort((a, b) => rank(a, priority) - rank(b, priority) || a.localeCompare(b));
}

function rank(value: string, priority: string[]): number {
	const index = priority.indexOf(value);
	return index < 0 ? priority.length : index;
}

function displayExtension(ext: string): string {
	return ext === "jpeg" ? "JPG" : ext.toUpperCase();
}

function uniqueValues(formats: MediaFormat[], valueOf: (format: MediaFormat) => number, sizeOf: (format: MediaFormat) => number) {
	const groups = new Map<number, { format: MediaFormat; bytes: number }>();
	for (const format of formats) {
		const value = valueOf(format);
		if (!value) continue;
		const current = groups.get(value);
		const bytes = sizeOf(format);
		if (!current || bytes > current.bytes) groups.set(value, { format, bytes });
	}
	return [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([value, entry]) => ({ value, ...entry }));
}

function videoHeight(format: MediaFormat): number {
	const resolution = format.resolution ?? "";
	const match = resolution.match(/\d+\s*[x\u00d7]\s*(\d+)/i) ?? resolution.match(/(\d+)\s*p/i);
	return Number(match?.[1] ?? 0);
}

function heightLabel(height: number): string {
	if (height === 4320) return "8K";
	if (height === 2160) return "4K";
	if (height === 1440) return "2K";
	return `${height}p`;
}

function bitrate(format: MediaFormat, duration: number | null): number {
	const match = format.note?.match(/(\d{2,4})\s*k(?:bps|b\/s|b)?/i);
	if (match) return Number(match[1]);
	const bytes = size(format);
	return bytes && duration && duration > 1 ? Math.round((bytes * 8) / duration / 1000) : 0;
}

function bestBy(formats: MediaFormat[], valueOf: (format: MediaFormat) => number, sizeOf: (format: MediaFormat) => number): MediaFormat | undefined {
	return [...formats].sort((a, b) => valueOf(b) - valueOf(a) || sizeOf(b) - sizeOf(a))[0];
}

function size(format: MediaFormat): number {
	return format.filesize ?? format.filesize_approx ?? 0;
}
