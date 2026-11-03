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
	const formatClass = details.format === "MP3" || details.format === "M4A"
		? "border-0 bg-media-audio/10 text-media-audio"
		: details.format === "Storyboard"
			? "border-0 bg-muted text-muted-foreground"
			: "border-0 bg-media-video/10 text-media-video";
	const FormatIcon = details.format === "MP3" || details.format === "M4A"
		? MusicIcon
		: details.format === "Storyboard"
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
