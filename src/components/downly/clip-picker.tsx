import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { formatDuration, type ClipRange } from "@/lib/downly";

type Props = {
	duration: number;
	range: ClipRange | null;
	onChange: (range: ClipRange | null) => void;
	disabled?: boolean;
};

function parseTime(value: string): number | null {
	const parts = value.trim().split(":").map(Number);
	if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
		return null;
	}
	const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
	if (minutes > 59 || seconds > 59) {
		return null;
	}
	return hours * 3600 + minutes * 60 + seconds;
}

export function ClipPicker({ duration, range, onChange, disabled = false }: Props) {
	const { t } = useTranslation();
	const total = Math.max(1, Math.floor(duration));
	const start = range?.start_seconds ?? 0;
	const end = range?.end_seconds ?? total;
	const [startText, setStartText] = useState(formatDuration(start));
	const [endText, setEndText] = useState(formatDuration(end));
	useEffect(() => {
		setStartText(formatDuration(start));
		setEndText(formatDuration(end));
	}, [start, end]);

	function commitTime(which: "start" | "end") {
		const parsed = parseTime(which === "start" ? startText : endText);
		if (parsed == null) {
			setStartText(formatDuration(start));
			setEndText(formatDuration(end));
			return;
		}
		const next = Math.min(total, parsed);
		if (which === "start") {
			onChange({ start_seconds: Math.min(next, end - 1), end_seconds: end });
		} else {
			onChange({ start_seconds: start, end_seconds: Math.max(start + 1, next) });
		}
	}

	return (
		<div className="flex flex-col gap-3">
			<Field orientation="horizontal" className="items-center">
				<Checkbox id="clip-enabled" checked={range != null} disabled={disabled} onCheckedChange={(checked) => onChange(checked === true ? { start_seconds: 0, end_seconds: total } : null)} />
				<FieldLabel htmlFor="clip-enabled">{t("queue.clip")}</FieldLabel>
			</Field>
			{range ? (
				<>
					<Slider
						thumbLabels={[t("queue.clipStart"), t("queue.clipEnd")]}
						min={0}
						max={total}
						step={1}
						minStepsBetweenValues={1}
						value={[start, end]}
						onValueChange={(value) => {
							if (Array.isArray(value)) onChange({ start_seconds: value[0], end_seconds: value[1] });
						}}
					/>
					<div className="flex items-center justify-between text-xs text-muted-foreground">
						<span>0:00</span>
						<span>{formatDuration(total)}</span>
					</div>
					<FieldGroup className="grid grid-cols-2 gap-3">
						<Field>
							<FieldLabel htmlFor="clip-start">{t("queue.clipStart")}</FieldLabel>
							<Input id="clip-start" inputMode="numeric" placeholder="0:00" value={startText} disabled={disabled} onChange={(event) => setStartText(event.target.value)} onBlur={() => commitTime("start")} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
						</Field>
						<Field>
							<FieldLabel htmlFor="clip-end">{t("queue.clipEnd")}</FieldLabel>
							<Input id="clip-end" inputMode="numeric" placeholder="0:00" value={endText} disabled={disabled} onChange={(event) => setEndText(event.target.value)} onBlur={() => commitTime("end")} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
						</Field>
					</FieldGroup>
				</>
			) : null}
		</div>
	);
}
