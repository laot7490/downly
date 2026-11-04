import { ClockIcon, FileIcon, GaugeIcon, HardDriveIcon, ImagesIcon, MusicIcon, ScissorsIcon, VideoIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatBytes, formatDuration, type Selection } from "@/lib/downly";
import { describeSelectionDetails } from "@/lib/quality-options";

type Props = {
	selection: Selection;
	best: string;
	durationSeconds?: number | null;
	sizeBytes?: number | null;
	estimatedSize?: boolean;
};

export function DownloadBadges({ selection, best, durationSeconds, sizeBytes, estimatedSize = false }: Props) {
	const details = describeSelectionDetails(selection, best);
	const clip = selection.clip;
	const audio = selection.type === "preset" ? selection.preset.startsWith("audio_") : selection.kind === "audio";
	const image = selection.type === "format" && (selection.kind === "image" || selection.kind === "storyboard");
	const formatClass = audio
		? "border-0 bg-media-audio/10 text-media-audio"
		: image
			? "border-0 bg-muted text-muted-foreground"
			: "border-0 bg-media-video/10 text-media-video";
	const FormatIcon = audio
		? MusicIcon
		: image
			? ImagesIcon
			: details.format === "MP4"
				? VideoIcon
				: FileIcon;
	return (
		<>
			<Badge variant="outline" className={formatClass}><FormatIcon data-icon="inline-start" />{details.format}</Badge>
			<Badge variant="secondary" className="border-0 bg-media-quality/10 text-media-quality"><GaugeIcon data-icon="inline-start" />{details.quality}</Badge>
			{durationSeconds != null ? <Badge variant="secondary" className="border-0 bg-media-duration/10 text-media-duration"><ClockIcon data-icon="inline-start" />{formatDuration(durationSeconds)}</Badge> : null}
			{clip ? (
				<Badge variant="secondary" className="border-0 bg-media-duration/10 text-media-duration" title={`${formatDuration(clip.start_seconds)}–${formatDuration(clip.end_seconds)}`}>
					<ScissorsIcon data-icon="inline-start" />{formatDuration(clip.start_seconds)}–{formatDuration(clip.end_seconds)} · {formatDuration(clip.end_seconds - clip.start_seconds)}
				</Badge>
			) : null}
			{sizeBytes != null ? <Badge variant="secondary" className="border-0 bg-muted text-muted-foreground"><HardDriveIcon data-icon="inline-start" />{estimatedSize ? "≈ " : ""}{formatBytes(sizeBytes)}</Badge> : null}
		</>
	);
}
