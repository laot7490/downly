import { useTranslation } from "react-i18next";
import { ClapperboardIcon, CopyIcon, ImageIcon, MusicIcon, ScissorsIcon } from "lucide-react";
import { Field, FieldTitle } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatBytes } from "@/lib/downly";
import type { FormatChoice, QualityChoice } from "@/lib/media-options";

type Props = {
	formats: FormatChoice[];
	formatId: string | null;
	qualities: QualityChoice[];
	qualityId: string | null;
	onFormat: (id: string) => void;
	onQuality: (id: string) => void;
	clipEnabled: boolean;
	thumbnailEnabled: boolean;
	onClipEnabled: (enabled: boolean) => void;
	onThumbnailEnabled: (enabled: boolean) => void;
	showClip?: boolean;
	showThumbnail?: boolean;
	onApplyFormat?: () => void;
	onApplyQuality?: () => void;
};

const groups = [
	{ id: "video", label: "queue.video", icon: ClapperboardIcon },
	{ id: "audio", label: "queue.audio", icon: MusicIcon },
	{ id: "image", label: "queue.image", icon: ImageIcon },
] as const;

export function FormatPicker({ formats, formatId, qualities, qualityId, onFormat, onQuality, clipEnabled, thumbnailEnabled, onClipEnabled, onThumbnailEnabled, showClip = true, showThumbnail = true, onApplyFormat, onApplyQuality }: Props) {
	const { t } = useTranslation();
	const formatItems = formats.map((format) => ({ value: format.id, label: format.label }));
	const qualityItems = qualities.map((quality) => ({ value: quality.id, label: quality.label }));
	return (
		<div className={`grid grid-cols-2 items-end gap-3 ${showClip && showThumbnail ? "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]" : showClip || showThumbnail ? "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" : "sm:grid-cols-2"}`}>
			<Field>
				<div className="flex items-center justify-between gap-2">
					<FieldTitle>{t("queue.format")}</FieldTitle>
					{onApplyFormat ? <Tooltip>
						<TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={t("queue.applyAllFormat")} onClick={onApplyFormat} />}>
							<CopyIcon />
						</TooltipTrigger>
						<TooltipContent>{t("queue.applyAllFormat")}</TooltipContent>
					</Tooltip> : null}
				</div>
				<Select items={formatItems} value={formatId} onValueChange={(value) => {
					if (typeof value === "string") onFormat(value);
				}}>
					<SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
					<SelectContent className="max-h-72">
						{groups.map((group) => {
							const choices = formats.filter((format) => format.category === group.id);
						if (!choices.length) return null;
						const Icon = group.icon;
						return (
							<SelectGroup key={group.id}>
								<SelectLabel>{t(group.label)}</SelectLabel>
								{choices.map((format) => (
									<SelectItem key={format.id} value={format.id}><Icon data-icon="inline-start" className="size-4 shrink-0 self-center" />{format.label}</SelectItem>
								))}
							</SelectGroup>
						);
						})}
					</SelectContent>
				</Select>
			</Field>
			<Field>
				<div className="flex items-center justify-between gap-2">
					<FieldTitle>{t("queue.quality")}</FieldTitle>
					{onApplyQuality ? <Tooltip>
						<TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={t("queue.applyAllQuality")} onClick={onApplyQuality} />}>
							<CopyIcon />
						</TooltipTrigger>
						<TooltipContent>{t("queue.applyAllQuality")}</TooltipContent>
					</Tooltip> : null}
				</div>
				<Select items={qualityItems} value={qualityId} onValueChange={(value) => {
					if (typeof value === "string") onQuality(value);
				}}>
					<SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
					<SelectContent className="max-h-72">
						<SelectGroup>
							{qualities.map((quality) => (
								<SelectItem key={quality.id} value={quality.id}>
									<span className="flex w-full items-center justify-between gap-4">
										<span>{quality.label}</span>
										{quality.sizeBytes ? <span className="shrink-0 text-xs text-muted-foreground">≈ {formatBytes(quality.sizeBytes)}</span> : null}
									</span>
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
			</Field>
			{showClip ? <Tooltip>
				<TooltipTrigger render={<Button type="button" variant="outline" size="icon" aria-label={t("queue.clipToggle")} aria-pressed={clipEnabled} onClick={() => onClipEnabled(!clipEnabled)} className={clipEnabled ? "border-foreground bg-foreground text-background hover:bg-foreground/90 dark:border-white dark:bg-white dark:text-black dark:hover:bg-white" : undefined} />}>
					<ScissorsIcon className="size-4" />
				</TooltipTrigger>
				<TooltipContent>{t("queue.clipToggle")}</TooltipContent>
			</Tooltip> : null}
			{showThumbnail ? <Tooltip>
				<TooltipTrigger render={<Button type="button" variant="outline" size="icon" aria-label={t("queue.thumbnailToggle")} aria-pressed={thumbnailEnabled} onClick={() => onThumbnailEnabled(!thumbnailEnabled)} className={thumbnailEnabled ? "border-foreground bg-foreground text-background hover:bg-foreground/90 dark:border-white dark:bg-white dark:text-black dark:hover:bg-white" : undefined} />}>
					<ImageIcon className="size-4" />
				</TooltipTrigger>
				<TooltipContent>{t("queue.thumbnailToggle")}</TooltipContent>
			</Tooltip> : null}
		</div>
	);
}
