import type { Preset, Selection } from "@/lib/downly";

export type QualityOption = {
	id: string;
	label: string;
	selection: Selection;
	sizeBytes?: number;
};

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

export function describeSelectionDetails(selection: Selection, best: string): { format: string; quality: string } {
	let label = selection.label;
	if (!label && selection.type === "preset") {
		label = presetLabel(selection.preset, best);
	}
	const parts = label.split(" · ");
	if (parts.length > 1) {
		return { format: parts[0], quality: parts.slice(1).join(" · ") };
	}
	if (selection.type === "preset") {
		return { format: selection.preset.startsWith("audio_") ? "MP3" : "MP4", quality: label || best };
	}
	if (selection.mp3_bitrate) {
		return { format: "MP3", quality: `${selection.mp3_bitrate} kbps` };
	}
	if (selection.type === "format" && selection.output_format) {
		return { format: selection.output_format.toUpperCase(), quality: label || best };
	}
	return {
		format: selection.label || (selection.kind === "storyboard" ? "Storyboard" : selection.kind === "audio" ? "Audio" : selection.kind === "image" ? "Image" : "MP4"),
		quality: label || best,
	};
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
