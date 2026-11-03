import { useTranslation } from "react-i18next";
import { AudioLinesIcon, ClapperboardIcon, MusicIcon } from "lucide-react";
import { Field, FieldTitle } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatBytes } from "@/lib/downly";
import type { ContainerKind, QualityOption } from "@/lib/quality-options";

type Props = {
	container: ContainerKind;
	containers: ContainerKind[];
	qualityId: string | null;
	options: QualityOption[];
	onContainer: (container: ContainerKind) => void;
	onQuality: (id: string) => void;
};

const containerMeta: { id: ContainerKind; label: string; icon: typeof ClapperboardIcon }[] = [
	{ id: "mp4", label: "MP4", icon: ClapperboardIcon },
	{ id: "mp3", label: "MP3", icon: MusicIcon },
	{ id: "m4a", label: "M4A", icon: AudioLinesIcon },
];

export function FormatPicker({ container, containers, qualityId, options, onContainer, onQuality }: Props) {
	const { t } = useTranslation();
	const items = options.map((option) => ({ value: option.id, label: option.label }));

	return (
		<div className="grid items-end gap-4 sm:grid-cols-2">
			<Field>
				<FieldTitle>{t("queue.format")}</FieldTitle>
				<ToggleGroup
					variant="outline"
					spacing={0}
					value={[container]}
					onValueChange={(value) => {
						const next = value[0];
						if (next === "mp4" || next === "mp3" || next === "m4a") {
							onContainer(next);
						}
					}}>
					{containerMeta.map((item) => (
						<ToggleGroupItem key={item.id} value={item.id} disabled={!containers.includes(item.id)}>
							<item.icon data-icon="inline-start" />
							{item.label}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
			</Field>
			<Field>
				<FieldTitle>{t("queue.quality")}</FieldTitle>
				<Select
					items={items}
					value={qualityId}
					onValueChange={(next) => {
						if (typeof next === "string") {
							onQuality(next);
						}
					}}>
					<SelectTrigger className="w-full sm:min-w-48">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							{options.map((option) => (
								<SelectItem key={option.id} value={option.id}>
									<span className="flex w-full items-center justify-between gap-4">
										<span>{option.label}</span>
										{option.sizeBytes ? (
											<span className="shrink-0 text-xs text-muted-foreground">≈ {formatBytes(option.sizeBytes)}</span>
										) : null}
									</span>
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>
			</Field>
		</div>
	);
}
