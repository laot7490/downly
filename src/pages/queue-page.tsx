import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { CalendarDaysIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, ClipboardPasteIcon, DownloadIcon, EyeIcon, HistoryIcon, Link2Icon, LinkIcon, ListVideoIcon, PlayIcon, RadioIcon, SquareIcon, TriangleAlertIcon, UserRoundIcon } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup } from "@/components/ui/field";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FormatPicker } from "@/components/downly/format-picker";
import { PageShell } from "@/components/downly/page-shell";
import { QueueList } from "@/components/downly/queue-list";
import { BrandMark } from "@/components/downly/brand-mark";
import { ClipPicker } from "@/components/downly/clip-picker";
import { enqueue, finishLiveRecording, probe, retryFailedSessionItem, start, stop, updateQueueMetadata } from "@/lib/api";
import { classifyCookieError, formatError, hasCookieWarning, toastError, type CookieErrorKind } from "@/lib/errors";
import {
	formatCount,
	formatDuration,
	formatUploadDate,
	linesOf,
	watchUrlWithoutList,
	type EnqueueOutcome,
	type ClipRange,
	type LiveMode,
	type ProbeOutcome,
	type PlaylistEntry,
	type Selection,
	type Snapshot,
} from "@/lib/downly";
import { presetChoices } from "@/lib/quality-options";
import { defaultFormatChoice, formatChoices, qualityChoices, type FormatChoice, type QualityChoice } from "@/lib/media-options";

type Props = {
	snapshot: Snapshot;
};

type CookiePromptRequest = { kind: CookieErrorKind | "metadata"; resolve: (retry: boolean) => void };
type ProbedVideo = Extract<ProbeOutcome, { kind: "video" }>;
type MultiLinkItem = {
	id: string;
	url: string;
	status: "queued" | "loading" | "ready" | "failed";
	video: ProbedVideo | null;
	formatId: string | null;
	qualityId: string | null;
	clipRange: ClipRange | null;
	liveMode: LiveMode | null;
	error: string | null;
	retryable: boolean;
	warning: string | null;
	pendingFormat: { id: string; label: string; category: FormatChoice["category"] } | null;
	pendingQuality: { id: string; label: string; category: FormatChoice["category"] } | null;
	addError: string | null;
};

function newMultiLinkItem(url: string): MultiLinkItem {
	return {
		id: crypto.randomUUID(),
		url,
		status: /^https?:\/\//i.test(url) ? "queued" : "failed",
		video: null,
		formatId: null,
		qualityId: null,
		clipRange: null,
		liveMode: null,
		error: /^https?:\/\//i.test(url) ? null : "invalid",
		retryable: false,
		warning: null,
		pendingFormat: null,
		pendingQuality: null,
		addError: null,
	};
}

function reconcileMultiLinkItems(current: MultiLinkItem[], urls: string[]): MultiLinkItem[] {
	const byUrl = new Map<string, MultiLinkItem[]>();
	for (const item of current) {
		const matches = byUrl.get(item.url) ?? [];
		matches.push(item);
		byUrl.set(item.url, matches);
	}
	const next = urls.map((url) => byUrl.get(url)?.shift() ?? newMultiLinkItem(url));
	return next.length === current.length && next.every((item, index) => item.id === current[index]?.id) ? current : next;
}

function qualityMetric(label: string, category: FormatChoice["category"]): number | null {
	if (category === "video") {
		const resolution = label.match(/(\d+)\s*p/i);
		if (resolution) return Number(resolution[1]);
		const size = label.match(/(\d+)\s*k/i);
		if (size) {
			const values: Record<number, number> = { 2: 1440, 4: 2160, 8: 4320 };
			return values[Number(size[1])] ?? null;
		}
	}
	if (category === "audio") {
		const bitrate = label.match(/(\d+)\s*kbps/i);
		if (bitrate) return Number(bitrate[1]);
	}
	return null;
}

function matchQuality(
	options: QualityChoice[],
	target: { id: string; label: string },
	category: FormatChoice["category"],
	useBestFallback: boolean,
): QualityChoice | null {
	if (target.id === "best") {
		return options.find((option) => option.id === "best") ?? (useBestFallback ? options[0] ?? null : null);
	}
	const exact = options.find((option) => option.label.toLowerCase() === target.label.toLowerCase());
	if (exact) return exact;
	const value = qualityMetric(target.label, category);
	if (value == null) return useBestFallback ? options.find((option) => option.id === "best") ?? options[0] ?? null : null;
	const lower = options
		.map((option) => ({ option, value: qualityMetric(option.label, category) }))
		.filter((entry): entry is { option: QualityChoice; value: number } => entry.value != null && entry.value <= value)
		.sort((left, right) => right.value - left.value)[0];
	return lower?.option ?? (useBestFallback ? options.find((option) => option.id === "best") ?? options[0] ?? null : null);
}

const cookiePromptDismissed = new Error("cookie prompt dismissed");


export function QueuePage({ snapshot }: Props) {
	const { t } = useTranslation();
	const best = t("queue.best");
	const [text, setText] = useState("");
	const [mode, setMode] = useState<"single" | "multiple">("single");
	const [busy, setBusy] = useState(false);
	const [probing, setProbing] = useState(false);
	const [probeRevision, setProbeRevision] = useState(0);
	const [metadataStatus, setMetadataStatus] = useState<{ kind: "loading" | "retrying" | "failed" } | null>(null);
	const [video, setVideo] = useState<Extract<ProbeOutcome, { kind: "video" }> | null>(null);
	const [formatId, setFormatId] = useState<string | null>(null);
	const [qualityId, setQualityId] = useState<string | null>(null);
	const [saveThumbnail, setSaveThumbnail] = useState(false);
	const [clipRange, setClipRange] = useState<ClipRange | null>(null);
	const [multiItems, setMultiItems] = useState<MultiLinkItem[]>([]);
	const [activeMultiItemId, setActiveMultiItemId] = useState<string | null>(null);
	const [playlistEntries, setPlaylistEntries] = useState<PlaylistEntry[]>([]);
	const [liveDialogOpen, setLiveDialogOpen] = useState(false);
	const [liveMode, setLiveMode] = useState<LiveMode>("from_now");
	const [finishingLiveId, setFinishingLiveId] = useState<string | null>(null);
	const [playlist, setPlaylist] = useState<{
		url: string;
		title: string | null;
		count: number;
		hasVideo: boolean;
		entries: PlaylistEntry[];
		sourceCardId?: string;
	} | null>(null);
	const [cookiePrompt, setCookiePrompt] = useState<CookiePromptRequest | null>(null);
	const activeCookiePrompt = useRef<CookiePromptRequest | null>(null);
	const queuedCookiePrompts = useRef<CookiePromptRequest[]>([]);
	const seenFailed = useRef(new Set<string>());
	const failedSeeded = useRef(false);
	const metadataJobs = useRef(new Map<string, Promise<ProbeOutcome>>());
	const multiProbeJobs = useRef(new Set<string>());
	const multiItemsRef = useRef(multiItems);
	const userChangedSelection = useRef(false);
	const metadataTarget = useRef<string | null>(null);
	const immediateProbeUrl = useRef<string | null>(null);

	const lines = useMemo(() => linesOf(text), [text]);
	multiItemsRef.current = multiItems;
	const multi = mode === "multiple";
	const downloading = snapshot.queue.some((item) => item.status === "active") || snapshot.progress != null;
	const activeItem = snapshot.queue.find((item) => item.status === "active") ?? null;
	const activeLive = activeItem?.live_mode != null;
	const finishingLive = activeItem != null && activeLive && finishingLiveId === activeItem.id;
	const pending = snapshot.queue.some((item) => item.status === "pending");

	const formatOptions: FormatChoice[] = useMemo(() => video ? formatChoices(video.formats) : [], [video]);
	const selectedFormat = formatOptions.find((option) => option.id === formatId) ?? formatOptions[0] ?? null;
	const baseOptions: QualityChoice[] = useMemo(() => selectedFormat && video ? qualityChoices(selectedFormat, video.formats, video.duration, best) : [], [selectedFormat, video, best]);
	const baseSelected = baseOptions.find((option) => option.id === qualityId) ?? baseOptions[0] ?? null;
	const clipAllowed = !video?.is_live && (
		baseSelected?.selection.type === "preset" ||
		(baseSelected?.selection.type === "format" && baseSelected.selection.kind !== "storyboard" && baseSelected.selection.kind !== "image")
	);
	const clipRatio = clipRange && mode === "single" && clipAllowed && video?.duration && video.duration > 0
		? Math.min(1, Math.max(0, (clipRange.end_seconds - clipRange.start_seconds) / video.duration))
		: 1;
	const options: QualityChoice[] = useMemo(() => baseOptions.map((option) => ({
		...option,
		sizeBytes: option.sizeBytes == null ? undefined : Math.round(option.sizeBytes * clipRatio),
	})), [baseOptions, clipRatio]);
	const selected = options.find((option) => option.id === qualityId) ?? options[0] ?? null;
	const activeMultiIndex = multiItems.findIndex((item) => item.id === activeMultiItemId);
	const activeMultiItem = activeMultiIndex >= 0 ? multiItems[activeMultiIndex] : null;
	const multiCardFormats = useMemo(() => activeMultiItem?.video ? formatChoices(activeMultiItem.video.formats) : [], [activeMultiItem?.video]);
	const multiCardFormat = multiCardFormats.find((option) => option.id === activeMultiItem?.formatId)
		?? (activeMultiItem?.video ? defaultFormatChoice(activeMultiItem.video.formats) : null);
	const multiCardQualities = useMemo(() => multiCardFormat && activeMultiItem?.video
		? qualityChoices(multiCardFormat, activeMultiItem.video.formats, activeMultiItem.video.duration, best)
		: [], [multiCardFormat, activeMultiItem?.video, best]);
	const multiCardQuality = multiCardQualities.find((option) => option.id === activeMultiItem?.qualityId)
		?? multiCardQualities[0]
		?? null;
	const multiClipAllowed = Boolean(activeMultiItem?.video && !activeMultiItem.video.is_live && (
		multiCardQuality?.selection.type === "preset" ||
		(multiCardQuality?.selection.type === "format" && multiCardQuality.selection.kind !== "storyboard" && multiCardQuality.selection.kind !== "image")
	));
	const askCookiePrompt = useCallback((kind: CookieErrorKind | "metadata") => new Promise<boolean>((resolve) => {
		const request = { kind, resolve };
		if (activeCookiePrompt.current) {
			queuedCookiePrompts.current.push(request);
			return;
		}
		activeCookiePrompt.current = request;
		setCookiePrompt(request);
	}), []);
	const settleCookiePrompt = useCallback((retry: boolean) => {
		const current = activeCookiePrompt.current;
		if (!current) {
			return;
		}
		current.resolve(retry);
		const next = queuedCookiePrompts.current.shift() ?? null;
		activeCookiePrompt.current = next;
		setCookiePrompt(next);
	}, []);
	useEffect(() => {
		multiItemsRef.current = multiItems;
	}, [multiItems]);
	const probeWithRetries = useCallback((url: string, reportStatus = true, allowCookiePrompt = reportStatus) => {
		const existing = metadataJobs.current.get(url);
		if (existing) {
			return existing;
		}
		const job = (async () => {
			for (let attempt = 1; attempt <= 3; attempt += 1) {
				try {
					return await probe(url);
				} catch (err) {
					if (err === cookiePromptDismissed) {
						throw err;
					}
					if (attempt === 3) {
						if (allowCookiePrompt && hasCookieWarning(err)) {
							if (reportStatus && metadataTarget.current === url) {
								setMetadataStatus(null);
							}
							await askCookiePrompt("metadata");
							throw cookiePromptDismissed;
						}
						if (reportStatus && metadataTarget.current === url) {
							setMetadataStatus({ kind: "failed" });
							toast.add({
								title: t("queue.metadataFailed", { error: formatError(err, t("queue.errorFailed")) }),
								type: "error",
							});
						}
						throw err;
					}
					const seconds = attempt;
					if (reportStatus && metadataTarget.current === url) {
						setMetadataStatus({ kind: "retrying" });
					}
					await new Promise((resolve) => window.setTimeout(resolve, seconds * 1000));
				}
			}
			throw new Error(t("queue.errorFailed"));
		})();
		let tracked: Promise<ProbeOutcome>;
		tracked = job.then(
			(outcome) => {
				if (metadataJobs.current.get(url) === tracked) {
					metadataJobs.current.delete(url);
				}
				return outcome;
			},
			(err) => {
				if (metadataJobs.current.get(url) === tracked) {
					metadataJobs.current.delete(url);
				}
				throw err;
			},
		);
		metadataJobs.current.set(url, tracked);
		return tracked;
	}, [askCookiePrompt, t]);

	useEffect(() => {
		if (!failedSeeded.current) {
			for (const item of snapshot.session) {
				if (item.status === "failed") {
					seenFailed.current.add(item.id);
				}
			}
			failedSeeded.current = true;
			return;
		}
		for (const item of snapshot.session) {
			if (item.status !== "failed" || seenFailed.current.has(item.id)) {
				continue;
			}
			seenFailed.current.add(item.id);
			const cookieError = classifyCookieError(item.error);
			if (cookieError) {
				void askCookiePrompt(cookieError).then((retry) => {
					if (!retry || cookieError === "decryption") {
						return;
					}
					void retryFailedSessionItem(item.id)
						.then(() => start())
						.catch((err) => toastError(err, t("queue.errorFailed")));
				});
				continue;
			}
			toast.add({
				title: formatError(item.error, t("queue.errorFailed")),
				type: "error",
			});
		}
	}, [askCookiePrompt, snapshot.session, t]);

	useEffect(() => {
		if (mode !== "single" || lines.length !== 1 || !/^https?:\/\//i.test(lines[0] ?? "")) {
			return;
		}
		const url = lines[0];
		metadataTarget.current = url;
		let cancelled = false;
		const timer = window.setTimeout(() => {
			setProbing(true);
			setMetadataStatus({ kind: "loading" });
			void probeWithRetries(url)
				.then((outcome) => {
					if (cancelled) {
						return;
					}
					if (outcome.kind === "rejected") {
						setMetadataStatus(null);
						toast.add({ title: t(`queue.reject.${outcome.reason}`), type: "error" });
						return;
					}
					if (outcome.kind === "playlist") {
						setMetadataStatus(null);
						setPlaylistEntries(outcome.entries);
						setPlaylist({
							url,
							title: outcome.title,
							count: outcome.count,
							hasVideo: Boolean(watchUrlWithoutList(url)),
							entries: outcome.entries,
						});
						return;
					}
					setVideo(outcome);
					setMetadataStatus(null);
					if (!userChangedSelection.current) {
						const format = defaultFormatChoice(outcome.formats);
						setFormatId(format?.id ?? null);
						setQualityId(format ? "best" : null);
					}
				})
				.catch(() => {})
				.finally(() => {
					if (!cancelled) {
						setProbing(false);
					}
				});
		}, immediateProbeUrl.current === url ? 0 : 400);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [mode, text, t, lines, probeRevision, probeWithRetries]);

	useEffect(() => {
		if (multi) {
			setMultiItems((current) => reconcileMultiLinkItems(current, lines));
		}
	}, [multi, lines]);

	useEffect(() => {
		if (!multiItems.length) {
			if (activeMultiItemId != null) setActiveMultiItemId(null);
			return;
		}
		if (!multiItems.some((item) => item.id === activeMultiItemId)) {
			setActiveMultiItemId(multiItems[0].id);
		}
	}, [multiItems, activeMultiItemId]);

	useEffect(() => {
		if (!multi) return;
		const availableSlots = Math.max(0, 5 - multiProbeJobs.current.size);
		const nextItems = multiItems
			.filter((item) => item.status === "queued" && /^https?:\/\//i.test(item.url) && !multiProbeJobs.current.has(item.id))
			.sort((left, right) => Number(right.id === activeMultiItemId) - Number(left.id === activeMultiItemId))
			.slice(0, availableSlots);

		for (const item of nextItems) {
			multiProbeJobs.current.add(item.id);
			setMultiItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "loading", error: null } : entry));
			void probeWithRetries(item.url, false, true)
				.then((outcome) => {
					if (!multiItemsRef.current.some((entry) => entry.id === item.id && entry.url === item.url)) return;
					if (outcome.kind === "playlist") {
						setPlaylistEntries(outcome.entries);
						setPlaylist({
							url: item.url,
							title: outcome.title,
							count: outcome.count,
							hasVideo: Boolean(watchUrlWithoutList(item.url)),
							entries: outcome.entries,
							sourceCardId: item.id,
						});
						setMultiItems((current) => current.map((entry) => entry.id === item.id
							? { ...entry, status: "failed", error: t("queue.multiplePlaylistDetected"), retryable: true, pendingFormat: null, pendingQuality: null }
							: entry));
						return;
					}
					if (outcome.kind === "rejected") {
						setMultiItems((current) => current.map((entry) => entry.id === item.id
							? { ...entry, status: "failed", error: t(`queue.reject.${outcome.reason}`), retryable: false, pendingFormat: null, pendingQuality: null }
							: entry));
						return;
					}

					setMultiItems((current) => current.map((entry) => {
						if (entry.id !== item.id) return entry;
						const availableFormats = formatChoices(outcome.formats);
						let selectedFormat = defaultFormatChoice(outcome.formats);
						let warning: string | null = null;
						if (entry.pendingFormat) {
							const requested = availableFormats.find((format) => format.id === entry.pendingFormat?.id);
						if (requested) selectedFormat = requested;
						else warning = t("queue.bulkFormatUnavailable", { format: entry.pendingFormat.label });
						}
						const qualities = selectedFormat ? qualityChoices(selectedFormat, outcome.formats, outcome.duration, best) : [];
						let selectedQuality = qualities.find((quality) => quality.id === "best") ?? qualities[0] ?? null;
						if (entry.pendingQuality) {
							if (selectedFormat?.category !== entry.pendingQuality.category) {
								warning ??= t("queue.bulkQualityUnavailable", { quality: entry.pendingQuality.label });
							} else {
								const match = matchQuality(qualities, entry.pendingQuality, entry.pendingQuality.category, false);
								if (match) selectedQuality = match;
								else warning ??= t("queue.bulkQualityUnavailable", { quality: entry.pendingQuality.label });
							}
						}
						return {
							...entry,
							status: "ready",
							video: outcome,
							formatId: selectedFormat?.id ?? null,
							qualityId: selectedQuality?.id ?? null,
							error: null,
							retryable: false,
							warning,
							pendingFormat: null,
							pendingQuality: null,
						};
					}));
				})
				.catch((err) => {
					if (!multiItemsRef.current.some((entry) => entry.id === item.id && entry.url === item.url)) return;
					setMultiItems((current) => current.map((entry) => entry.id === item.id
						? { ...entry, status: "failed", error: err === cookiePromptDismissed ? t("queue.retryMetadata") : formatError(err, t("queue.errorFailed")), retryable: true }
						: entry));
				})
				.finally(() => {
					multiProbeJobs.current.delete(item.id);
				});
		}
	}, [multi, multiItems, activeMultiItemId, probeWithRetries, t, best]);

	function clearProbe() {
		metadataTarget.current = null;
		setVideo(null);
		setLiveDialogOpen(false);
		setPlaylist(null);
		setPlaylistEntries([]);
		setFormatId(null);
		setQualityId(null);
		setClipRange(null);
		setProbing(false);
		setMetadataStatus(null);
		userChangedSelection.current = false;
	}

	function shouldProbeSingle(value: string, targetMode = mode) {
		const nextLines = linesOf(value);
		return targetMode === "single" && nextLines.length === 1 && /^https?:\/\//i.test(nextLines[0] ?? "");
	}

	function applyFormatToMultiItem(item: MultiLinkItem, target: FormatChoice): MultiLinkItem {
		if (!item.video) return item;
		const formats = formatChoices(item.video.formats);
		const nextFormat = formats.find((format) => format.id === target.id);
		if (!nextFormat) {
			return { ...item, warning: t("queue.bulkFormatUnavailable", { format: target.label }) };
		}
		const previousFormat = formats.find((format) => format.id === item.formatId);
		const previousQualities = previousFormat ? qualityChoices(previousFormat, item.video.formats, item.video.duration, best) : [];
		const previousQuality = previousQualities.find((quality) => quality.id === item.qualityId) ?? null;
		const nextQualities = qualityChoices(nextFormat, item.video.formats, item.video.duration, best);
		const nextQuality = previousQuality
			? matchQuality(nextQualities, previousQuality, nextFormat.category, true)
			: nextQualities.find((quality) => quality.id === "best") ?? nextQualities[0] ?? null;
		return {
			...item,
			formatId: nextFormat.id,
			qualityId: nextQuality?.id ?? null,
			warning: null,
			pendingFormat: null,
			pendingQuality: null,
			addError: null,
		};
	}

	function applyQualityToMultiItem(item: MultiLinkItem, target: { id: string; label: string; category: FormatChoice["category"] }): MultiLinkItem {
		if (!item.video) return item;
		const formats = formatChoices(item.video.formats);
		const selectedFormat = formats.find((format) => format.id === item.formatId) ?? defaultFormatChoice(item.video.formats);
		if (!selectedFormat || selectedFormat.category !== target.category) {
			return { ...item, warning: t("queue.bulkQualityUnavailable", { quality: target.label }) };
		}
		const qualities = qualityChoices(selectedFormat, item.video.formats, item.video.duration, best);
		const match = matchQuality(qualities, target, selectedFormat.category, false);
		if (!match) return { ...item, warning: t("queue.bulkQualityUnavailable", { quality: target.label }) };
		return { ...item, qualityId: match.id, warning: null, pendingQuality: null, addError: null };
	}

	function applyFormatToAll() {
		if (!multiCardFormat) return;
		const target = multiCardFormat;
		const next = multiItems.map((item) => item.status === "ready" && item.video
			? applyFormatToMultiItem(item, target)
			: { ...item, pendingFormat: { id: target.id, label: target.label, category: target.category }, pendingQuality: null, warning: null });
		setMultiItems(next);
		const firstWarning = next.find((item) => item.warning);
		if (firstWarning) setActiveMultiItemId(firstWarning.id);
	}

	function applyQualityToAll() {
		if (!multiCardQuality || !multiCardFormat) return;
		const target = { id: multiCardQuality.id, label: multiCardQuality.label, category: multiCardFormat.category };
		const next = multiItems.map((item) => item.status === "ready" && item.video
			? applyQualityToMultiItem(item, target)
			: { ...item, pendingQuality: target, warning: null });
		setMultiItems(next);
		const firstWarning = next.find((item) => item.warning);
		if (firstWarning) setActiveMultiItemId(firstWarning.id);
	}

	function updateMultipleText(value: string) {
		setText(value);
		setMultiItems((current) => reconcileMultiLinkItems(current, linesOf(value)));
	}

	function applyOutcomes(outcomes: EnqueueOutcome[]) {
		const notes = outcomes
			.map((outcome) => {
				if (outcome.kind === "skipped") {
					return t(`queue.skip.${outcome.reason}`);
				}
				if (outcome.kind === "rejected") {
					return t(`queue.reject.${outcome.reason}`);
				}
				return null;
			})
			.filter(Boolean);
		if (notes.length > 0) {
			toast.add({ title: notes.join(" "), type: "info" });
		}
	}

	async function onPaste() {
		try {
			const next = await readText();
			const trimmed = next.trim();
			if (!trimmed) {
				return;
			}
			if (!multi && trimmed === text) {
				clearProbe();
				immediateProbeUrl.current = linesOf(trimmed)[0] ?? null;
				setProbing(shouldProbeSingle(trimmed));
				setProbeRevision((revision) => revision + 1);
				return;
			}
			const nextText = multi && text.trim() ? `${text.replace(/\s*$/, "")}\n${trimmed}` : trimmed;
			if (multi) updateMultipleText(nextText);
			else setText(nextText);
			clearProbe();
			immediateProbeUrl.current = multi ? null : linesOf(nextText)[0] ?? null;
			setProbing(shouldProbeSingle(nextText));
		} catch (err) {
			toastError(err, t("queue.pasteFailed"));
		}
	}

	async function hydrateQueueItems(items: { id: string; url: string }[]) {
		const pendingItems = [...items];
		const workers = Array.from({ length: Math.min(5, pendingItems.length) }, async () => {
			while (pendingItems.length > 0) {
				const item = pendingItems.shift();
				if (!item) {
					return;
				}
				try {
					const outcome = await probeWithRetries(item.url, false, true);
					if (outcome.kind === "video") {
						await updateQueueMetadata(item.id, outcome.id, outcome.title, outcome.thumbnail, outcome.duration == null ? null : Math.round(outcome.duration), outcome.is_live);
					}
				} catch {
					continue;
				}
			}
		});
		await Promise.all(workers);
	}

	function onAdd() {
		if (multi) {
			if (activeMultiItem?.video?.is_live && !activeMultiItem.liveMode) {
				setLiveMode("from_now");
				setLiveDialogOpen(true);
				return;
			}
			void enqueueCurrent(null);
			return;
		}
		if (video?.is_live) {
			setLiveMode("from_now");
			setLiveDialogOpen(true);
			return;
		}
		void enqueueCurrent(null);
	}

	async function enqueueCurrent(selectedLiveMode: LiveMode | null) {
		if (multi) {
			const activeId = activeMultiItemId;
			const preparedItems = multiItems.map((item) => item.id === activeId && selectedLiveMode
				? { ...item, liveMode: selectedLiveMode }
				: item);
		const fallbackSelection = presetChoices("mp4", best).find((option) => option.id === "video_best")?.selection;
		if (!fallbackSelection) return;
		const targets = preparedItems.flatMap<{ item: MultiLinkItem; selection: Selection; sizeBytes: number | null }>((item) => {
			if (!item.video || item.status !== "ready") {
				const category = item.pendingFormat?.category;
				const choices = category === "audio"
					? presetChoices("mp3", best)
					: category === "video" ? presetChoices("mp4", best) : [];
				const quality = item.pendingQuality;
				const selection = (quality
					? choices.find((choice) => choice.id === quality.id || choice.label.toLowerCase() === quality.label.toLowerCase())?.selection
					: null)
					?? choices[0]?.selection
					?? fallbackSelection;
				return [{ item, selection, sizeBytes: null }];
			}
			if (item.video.is_live && !item.liveMode) return [];
				const formats = formatChoices(item.video.formats);
				const format = formats.find((choice) => choice.id === item.formatId) ?? defaultFormatChoice(item.video.formats);
				if (!format) return [];
				const qualities = qualityChoices(format, item.video.formats, item.video.duration, best);
				const quality = qualities.find((choice) => choice.id === item.qualityId) ?? qualities[0];
				if (!quality) return [];
				const canClip = !item.video.is_live && (
					quality.selection.type === "preset" ||
					(quality.selection.type === "format" && quality.selection.kind !== "storyboard" && quality.selection.kind !== "image")
				);
				const clip = canClip ? item.clipRange : null;
				const clipRatio = clip && item.video.duration && item.video.duration > 0
					? Math.min(1, Math.max(0, (clip.end_seconds - clip.start_seconds) / item.video.duration))
					: 1;
				return [{
					item,
					quality,
					selection: {
						...quality.selection,
						save_thumbnail: quality.selection.type === "format" && quality.selection.kind === "image" ? false : saveThumbnail,
						clip,
					},
					sizeBytes: quality.sizeBytes == null ? null : Math.round(quality.sizeBytes * clipRatio),
				}];
			});
			if (!targets.length) return;
			setMultiItems(preparedItems);
			setBusy(true);
			try {
				const outcomes = await enqueue(targets.map(({ item, selection, sizeBytes }) => ({
					url: item.url,
					video_id: item.video?.id ?? "",
					title: item.video?.title ?? "",
					thumbnail: item.video?.thumbnail ?? null,
					selection,
					live_mode: item.video?.is_live ? item.liveMode : null,
					preflight_checked: item.video != null,
					duration_seconds: item.video?.is_live || item.video?.duration == null ? null : Math.round(item.video.duration),
					size_bytes: item.video?.is_live ? null : sizeBytes,
				})));
				applyOutcomes(outcomes);
				setLiveDialogOpen(false);
				const addedIds = new Set<string>();
				const addErrors = new Map<string, string>();
				const hydration: { id: string; url: string }[] = [];
				outcomes.forEach((outcome, index) => {
					if (outcome.kind === "added") {
						addedIds.add(targets[index].item.id);
						if (!targets[index].item.video) hydration.push({ id: outcome.id, url: targets[index].item.url });
					}
					else if (outcome.kind === "skipped") addErrors.set(targets[index].item.id, t(`queue.skip.${outcome.reason}`));
					else addErrors.set(targets[index].item.id, t(`queue.reject.${outcome.reason}`));
				});
				const remaining = preparedItems
					.filter((item) => !addedIds.has(item.id))
					.map((item) => addErrors.has(item.id) ? { ...item, addError: addErrors.get(item.id) ?? null } : item);
				setMultiItems(remaining);
				setText(remaining.map((item) => item.url).join("\n"));
				if (hydration.length > 0) void hydrateQueueItems(hydration);
			} catch (err) {
				toastError(err, t("queue.errorFailed"));
			} finally {
				setBusy(false);
			}
			return;
		}
		if (lines.length === 0 || (mode === "single" && lines.length !== 1)) {
			return;
		}
		const selection = (multi ? multiCardQuality?.selection : selected?.selection) ?? presetChoices("mp4", best)[0]?.selection;
		if (!selection) {
			return;
		}
		const singleVideo = mode === "single" && lines.length === 1 ? video : null;
		const downloadClip = singleVideo && clipAllowed ? clipRange : null;
		const downloadSelection = {
			...selection,
			save_thumbnail: selection.type === "format" && selection.kind === "image" ? false : saveThumbnail,
			clip: downloadClip,
		};
		setBusy(true);
		try {
			const outcomes = await enqueue(lines.map((url, index) => ({
				url,
				video_id: singleVideo?.id ?? (multi ? playlistEntries[index]?.id : null) ?? "",
				title: singleVideo?.title ?? (multi ? playlistEntries[index]?.title : null) ?? "",
				thumbnail: singleVideo?.thumbnail ?? (multi ? playlistEntries[index]?.thumbnail : null) ?? null,
				selection: downloadSelection,
				live_mode: selectedLiveMode,
				preflight_checked: singleVideo != null,
				duration_seconds: singleVideo && !singleVideo.is_live && singleVideo.duration != null ? Math.round(singleVideo.duration) : null,
				size_bytes: singleVideo?.is_live ? null : singleVideo ? selected?.sizeBytes ?? null : null,
			})));
			applyOutcomes(outcomes);
			setLiveDialogOpen(false);
			const hydration = outcomes.flatMap((outcome, index) =>
				outcome.kind === "added" && !singleVideo ? [{ id: outcome.id, url: lines[index] }] : [],
			);
			clearProbe();
			setText("");
			if (hydration.length > 0) {
				void hydrateQueueItems(hydration);
			}
		} catch (err) {
			toastError(err, t("queue.errorFailed"));
		} finally {
			setBusy(false);
		}
	}

	function onOnlyThis() {
		if (!playlist) {
			return;
		}
		const watch = watchUrlWithoutList(playlist.url);
		if (!watch) {
			return;
		}
		clearProbe();
		setMode("single");
		immediateProbeUrl.current = watch;
		setProbing(true);
		setText(watch);
	}

	async function onAddAll() {
		if (!playlist) {
			return;
		}
		if (playlist.entries.length === 0 || busy) {
			return;
		}
		clearProbe();
		setMode("multiple");
		updateMultipleText(playlist.entries.map((entry) => entry.url).join("\n"));
	}

	async function onStart() {
		try {
			await start();
		} catch (err) {
			toastError(err, t("queue.errorFailed"));
		}
	}

	async function onStop() {
		try {
			if (activeLive && activeItem) {
				setFinishingLiveId(activeItem.id);
				await finishLiveRecording();
			} else {
				await stop();
			}
		} catch (err) {
			setFinishingLiveId(null);
			toastError(err, t("queue.errorFailed"));
		}
	}

	const linksValid = lines.every((line) => /^https?:\/\//i.test(line));
	const showDetailsCard = (multi && multiItems.length > 0) || probing || video != null || playlist != null;
	const showFormatPicker = multi
		? activeMultiItem?.status === "ready" && multiCardQualities.length > 0
		: video != null && options.length > 0;
	const metadataBusy = probing || metadataStatus?.kind === "loading" || metadataStatus?.kind === "retrying";
	const canAdd = !busy && (multi
		? multiItems.some((item) => /^https?:\/\//i.test(item.url))
		: !metadataBusy && lines.length === 1 && linksValid);

	return (
		<PageShell>
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("queue.headline")}</h1>
				<p className="max-w-prose text-sm text-muted-foreground">{t("queue.sub")}</p>
			</div>
			<FieldGroup>
				<Field>
					<div className="w-fit">
						<ToggleGroup
							aria-label={t("queue.inputMode")}
							className="w-fit rounded-lg bg-transparent p-1 dark:bg-input/30"
							size="sm"
							spacing={1}
							value={[mode]}
							onValueChange={(value) => {
								const next = value[0];
								if (next === "single" || next === "multiple") {
									setMode(next);
									clearProbe();
									if (next === "single") {
										setProbing(shouldProbeSingle(text, next));
									}
								}
							}}>
							<ToggleGroupItem value="single" className="min-w-24 justify-center aria-pressed:bg-background aria-pressed:shadow-xs">
								<Link2Icon data-icon="inline-start" />
								{t("queue.single")}
							</ToggleGroupItem>
							<ToggleGroupItem value="multiple" className="min-w-24 justify-center aria-pressed:bg-background aria-pressed:shadow-xs">
								<ListVideoIcon data-icon="inline-start" />
								{t("queue.multiple")}
							</ToggleGroupItem>
						</ToggleGroup>
					</div>
					<div className="flex items-start gap-2">
						<div className="relative min-w-0 flex-1">
							<LinkIcon className={`pointer-events-none absolute left-3 size-4 text-muted-foreground ${multi ? "top-2.5" : "top-1/2 -translate-y-1/2"}`} />
							{multi ? (
								<Textarea
									value={text}
									rows={3}
									disabled={busy}
									className="min-h-20 resize-none py-2 pr-12 pl-9"
									placeholder={t("queue.linksMultiplePlaceholder")}
									onChange={(event) => {
										updateMultipleText(event.target.value);
										clearProbe();
										setProbing(shouldProbeSingle(event.target.value));
									}}
								/>
							) : (
								<Input
									value={text}
									className="h-9 min-w-0 pr-12 pl-9"
									placeholder={t("queue.linksPlaceholder")}
									onChange={(event) => {
									immediateProbeUrl.current = (event.nativeEvent as InputEvent).inputType === "insertFromPaste"
										? linesOf(event.target.value)[0] ?? null
										: null;
									setText(event.target.value);
									clearProbe();
									setProbing(shouldProbeSingle(event.target.value));
									}}
								/>
							)}
							<div className={`absolute right-1 flex gap-0.5 ${multi ? "top-1 items-start" : "inset-y-0 items-center"}`}>
								{metadataBusy ? <Spinner /> : null}
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									className="text-muted-foreground hover:bg-accent hover:text-foreground"
									aria-label={t("queue.paste")}
									onClick={() => void onPaste()}>
									<ClipboardPasteIcon />
								</Button>
							</div>
						</div>
						<Button type="button" size="lg" className="w-24 shrink-0" disabled={!canAdd} onClick={onAdd}>
							{busy ? <Spinner data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />}
							{t("queue.add")}
						</Button>
					</div>
				</Field>
				{showDetailsCard ? (
					<Card className="gap-0 py-0">
						{multi && activeMultiItem ? <CardHeader className="grid-cols-[1fr_auto] items-center gap-4 border-b pt-4 pb-4">
							<CardAction className="col-start-2 row-span-1 flex items-center gap-1">
								<Button type="button" variant="ghost" size="icon-sm" aria-label={t("queue.previousLink")} disabled={activeMultiIndex <= 0} onClick={() => setActiveMultiItemId(multiItems[activeMultiIndex - 1]?.id ?? null)}><ChevronLeftIcon /></Button>
								<span className="text-xs font-medium tabular-nums text-muted-foreground" aria-live="polite">{activeMultiIndex + 1}/{multiItems.length}</span>
								<Button type="button" variant="ghost" size="icon-sm" aria-label={t("queue.nextLink")} disabled={activeMultiIndex < 0 || activeMultiIndex >= multiItems.length - 1} onClick={() => setActiveMultiItemId(multiItems[activeMultiIndex + 1]?.id ?? null)}><ChevronRightIcon /></Button>
							</CardAction>
						</CardHeader> : null}
						<CardContent className="p-0">
							{multi ? activeMultiItem ? (
								<div className="flex flex-col gap-4 p-6">
									{activeMultiItem.status === "queued" || activeMultiItem.status === "loading" ? (
										<div className="flex gap-4">
											<Skeleton className="aspect-video w-full shrink-0 rounded-lg sm:w-56" />
											<div className="hidden min-w-0 flex-1 flex-col justify-center gap-2 sm:flex">
												<Skeleton className="h-5 w-3/4" />
												<Skeleton className="h-4 w-1/2" />
											</div>
										</div>
									) : null}
									{activeMultiItem.status === "ready" && activeMultiItem.video ? (
										<div className="flex flex-col gap-4 sm:flex-row">
											<div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-muted sm:w-56">
												{activeMultiItem.video.thumbnail ? <img src={activeMultiItem.video.thumbnail} alt="" loading="eager" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center"><BrandMark className="size-8 opacity-40" /></div>}
												{!activeMultiItem.video.is_live && formatDuration(activeMultiItem.video.duration) ? <Badge variant="secondary" className="absolute right-1 bottom-1 rounded-md border-0 bg-black/80 text-white shadow-none">{formatDuration(activeMultiItem.video.duration)}</Badge> : null}
											</div>
											<div className="flex min-w-0 flex-col justify-center gap-2">
												<p className="break-words text-base font-medium text-foreground">{activeMultiItem.video.title}{activeMultiItem.video.is_live ? <Badge variant="destructive" className="ml-2 align-middle"><RadioIcon aria-hidden="true" />{t("queue.live")}</Badge> : null}</p>
												{activeMultiItem.video.channel || formatCount(activeMultiItem.video.view_count) || formatUploadDate(activeMultiItem.video.upload_date) ? <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
													{activeMultiItem.video.channel ? <span className="inline-flex items-center gap-1.5"><UserRoundIcon className="size-3.5" />{activeMultiItem.video.channel}</span> : null}
													{formatCount(activeMultiItem.video.view_count) ? <span className="inline-flex items-center gap-1.5"><EyeIcon className="size-3.5" />{formatCount(activeMultiItem.video.view_count)}</span> : null}
													{formatUploadDate(activeMultiItem.video.upload_date) ? <span className="inline-flex items-center gap-1.5"><CalendarDaysIcon className="size-3.5" />{formatUploadDate(activeMultiItem.video.upload_date)}</span> : null}
												</div> : null}
											</div>
										</div>
									) : null}
									{activeMultiItem.error ? <Alert variant="warning"><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>{activeMultiItem.error === "invalid" ? t("queue.invalidLink") : activeMultiItem.error}</span>{activeMultiItem.retryable ? <Button type="button" variant="outline" size="sm" onClick={() => setMultiItems((current) => current.map((item) => item.id === activeMultiItem.id ? { ...item, status: "queued", error: null, retryable: false } : item))}>{t("queue.retryMetadata")}</Button> : null}</AlertDescription></Alert> : null}
									{activeMultiItem.warning ? <Alert variant="warning"><AlertDescription>{activeMultiItem.warning}</AlertDescription></Alert> : null}
									{activeMultiItem.addError ? <Alert variant="warning"><AlertDescription>{activeMultiItem.addError}</AlertDescription></Alert> : null}
									{showFormatPicker && activeMultiItem.video ? <div className="flex flex-col gap-4 border-t border-border bg-muted p-6">
										<FormatPicker
										formats={multiCardFormats}
										formatId={multiCardFormat?.id ?? null}
										qualities={multiCardQualities}
										qualityId={multiCardQuality?.id ?? null}
										clipEnabled={activeMultiItem.clipRange != null}
										thumbnailEnabled={saveThumbnail}
										showClip={!activeMultiItem.video.is_live}
										showThumbnail
										onFormat={(id) => {
											const nextFormat = multiCardFormats.find((format) => format.id === id);
											const qualities = nextFormat ? qualityChoices(nextFormat, activeMultiItem.video!.formats, activeMultiItem.video!.duration, best) : [];
											setMultiItems((current) => current.map((item) => item.id === activeMultiItem.id ? { ...item, formatId: id, qualityId: qualities.find((quality) => quality.id === "best")?.id ?? qualities[0]?.id ?? null, warning: null, addError: null, pendingFormat: null, pendingQuality: null } : item));
										}}
										onQuality={(id) => setMultiItems((current) => current.map((item) => item.id === activeMultiItem.id ? { ...item, qualityId: id, warning: null, addError: null, pendingQuality: null } : item))}
										onClipEnabled={(enabled) => setMultiItems((current) => current.map((item) => item.id === activeMultiItem.id ? { ...item, clipRange: enabled && item.video?.duration ? { start_seconds: 0, end_seconds: item.video.duration } : null } : item))}
										onThumbnailEnabled={setSaveThumbnail}
										onApplyFormat={applyFormatToAll}
										onApplyQuality={applyQualityToAll}
									/>
										{activeMultiItem.clipRange && activeMultiItem.video.duration && activeMultiItem.video.duration > 1 && multiClipAllowed ? <ClipPicker duration={activeMultiItem.video.duration} range={activeMultiItem.clipRange} onChange={(range) => setMultiItems((current) => current.map((item) => item.id === activeMultiItem.id ? { ...item, clipRange: range } : item))} /> : null}
									</div> : null}
								</div>
							) : null : <>
								<div className="p-6">
									{probing ? <div className="flex gap-4">
										<Skeleton className="aspect-video w-48 shrink-0 rounded-lg" />
										<div className="flex min-w-0 flex-1 flex-col justify-center gap-2"><Skeleton className="h-5 w-3/4" /><Skeleton className="h-4 w-1/2" /><div className="flex gap-1.5"><Skeleton className="h-5 w-20 rounded-full" /><Skeleton className="h-5 w-16 rounded-full" /></div></div>
									</div> : null}
									{video && !probing ? <div className="flex gap-4">
										<div className="relative aspect-video w-48 shrink-0 overflow-hidden rounded-lg bg-muted">{video.thumbnail ? <img src={video.thumbnail} alt="" className="size-full object-cover" /> : <div className="flex size-full items-center justify-center"><BrandMark className="size-8 opacity-40" /></div>}{!video.is_live && formatDuration(video.duration) ? <Badge variant="secondary" className="absolute right-1 bottom-1 rounded-md border-0 bg-black/80 text-white shadow-none">{formatDuration(video.duration)}</Badge> : null}</div>
										<div className="flex min-w-0 flex-col justify-center gap-2">
											<p className="text-base font-medium text-foreground">{video.title}{video.is_live ? <Badge variant="destructive" className="ml-2 align-middle"><RadioIcon aria-hidden="true" />{t("queue.live")}</Badge> : null}</p>
											{video.channel || formatCount(video.view_count) || formatUploadDate(video.upload_date) ? <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">{video.channel ? <span className="inline-flex items-center gap-1.5"><UserRoundIcon className="size-3.5" />{video.channel}</span> : null}{formatCount(video.view_count) ? <span className="inline-flex items-center gap-1.5"><EyeIcon className="size-3.5" />{formatCount(video.view_count)}</span> : null}{formatUploadDate(video.upload_date) ? <span className="inline-flex items-center gap-1.5"><CalendarDaysIcon className="size-3.5" />{formatUploadDate(video.upload_date)}</span> : null}</div> : null}
										</div>
									</div> : null}
								</div>
								{showFormatPicker && !playlist ? <div className="flex flex-col gap-4 border-t border-border bg-muted p-6">
									<FormatPicker
									formats={formatOptions}
									formatId={selectedFormat?.id ?? null}
									qualities={options}
									qualityId={selected?.id ?? null}
									clipEnabled={clipRange != null}
									thumbnailEnabled={saveThumbnail}
									showClip={!video?.is_live}
									showThumbnail
									onFormat={(id) => { userChangedSelection.current = true; setFormatId(id); setQualityId("best"); }}
									onQuality={(id) => { userChangedSelection.current = true; setQualityId(id); }}
									onClipEnabled={(enabled) => setClipRange(enabled && video?.duration ? { start_seconds: 0, end_seconds: video.duration } : null)}
									onThumbnailEnabled={setSaveThumbnail}
								/>
									{clipRange && video?.duration && video.duration > 1 && clipAllowed ? <ClipPicker duration={video.duration} range={clipRange} onChange={setClipRange} /> : null}
								</div> : null}
							</>}
						</CardContent>
					</Card>
				) : null}
			</FieldGroup>
			<div className="flex flex-col gap-3">
				<h2 className="text-sm font-medium text-foreground">{t("queue.title")}</h2>
				<QueueList
					snapshot={snapshot}
					actions={
							downloading ? (
							<Button type="button" variant="destructive" size="default" className="shrink-0" disabled={finishingLive} onClick={() => void onStop()}>
								<SquareIcon data-icon="inline-start" />
								{activeLive ? t("queue.finishLiveRecording") : t("queue.stop")}
							</Button>
						) : (
							<Button type="button" size="default" className="shrink-0" disabled={!pending} onClick={() => void onStart()}>
								<PlayIcon data-icon="inline-start" />
								{t("queue.start")}
							</Button>
						)
					}
				/>
			</div>
			<Dialog
				open={liveDialogOpen}
				onOpenChange={setLiveDialogOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>{t("queue.liveDialogTitle")}</DialogTitle>
						<DialogDescription>{t("queue.liveDialogBody")}</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col gap-4">
						<ToggleGroup
							aria-label={t("queue.liveSelectionLabel")}
							className="w-full flex-col"
							variant="outline"
							spacing={1}
							value={[liveMode]}
							onValueChange={(value) => {
								const next = value[0];
								if (next === "from_now" || next === "from_start") {
									setLiveMode(next);
								}
							}}>
							<ToggleGroupItem value="from_now" className="h-auto min-h-16 w-full justify-start gap-2 whitespace-normal px-5 py-3 text-left aria-pressed:border-primary/50 aria-pressed:bg-accent aria-pressed:text-accent-foreground">
								<RadioIcon data-icon="inline-start" className="size-5" aria-hidden="true" />
								<span className="flex min-w-0 flex-1 flex-col gap-1">
									<span className="font-medium">{t("queue.liveFromNow")}</span>
									<span className="text-xs font-normal text-muted-foreground">{t("queue.liveFromNowDescription")}</span>
								</span>
								{liveMode === "from_now" ? <CheckIcon data-icon="inline-end" aria-hidden="true" /> : null}
							</ToggleGroupItem>
							<ToggleGroupItem value="from_start" className="h-auto min-h-16 w-full justify-start gap-2 whitespace-normal px-5 py-3 text-left aria-pressed:border-primary/50 aria-pressed:bg-accent aria-pressed:text-accent-foreground">
								<HistoryIcon data-icon="inline-start" className="size-5" aria-hidden="true" />
								<span className="flex min-w-0 flex-1 flex-col gap-1">
									<span className="font-medium">{t("queue.liveFromStart")}</span>
									<span className="text-xs font-normal text-muted-foreground">{t("queue.liveFromStartDescription")}</span>
								</span>
								{liveMode === "from_start" ? <CheckIcon data-icon="inline-end" aria-hidden="true" /> : null}
							</ToggleGroupItem>
						</ToggleGroup>
						{liveMode === "from_start" ? (
							<Alert variant="warning" className="grid-cols-[auto_1fr] items-center gap-x-2">
								<TriangleAlertIcon aria-hidden="true" />
								<AlertDescription>{t("queue.liveFromStartWarning")}</AlertDescription>
							</Alert>
						) : null}
					</div>
					<DialogFooter>
						<Button type="button" variant="outline" disabled={busy} onClick={() => setLiveDialogOpen(false)}>{t("queue.clearQueueCancel")}</Button>
						<Button type="button" disabled={busy} onClick={() => void enqueueCurrent(liveMode)}>{busy ? <Spinner data-icon="inline-start" /> : null}{t("queue.add")}</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<Dialog
				open={playlist != null}
				onOpenChange={(open) => {
					if (!open) {
						setPlaylist(null);
					}
				}}>
				<DialogContent className="sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>{t("queue.playlistTitle")}</DialogTitle>
					</DialogHeader>
					<div className="flex flex-col gap-4">
						<p className="text-sm text-foreground">{playlist?.title || t("queue.playlistTitle")}</p>
						<p className="text-sm text-muted-foreground">{t("queue.playlistCount", { count: playlist?.count ?? 0 })}</p>
					</div>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => setPlaylist(null)}>
							{t("queue.close")}
						</Button>
						{playlist?.hasVideo ? (
							<Button type="button" variant="secondary" disabled={busy} onClick={onOnlyThis}>
								{t("queue.onlyThisVideo")}
							</Button>
						) : null}
						<Button type="button" disabled={busy || !playlist?.entries.length} onClick={() => void onAddAll()}>
							{t("queue.addAll", { count: playlist?.count ?? 0 })}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<AlertDialog open={cookiePrompt != null} onOpenChange={(open) => {
				if (!open) {
					settleCookiePrompt(false);
				}
			}}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{cookiePrompt ? t(`queue.cookie.${cookiePrompt.kind}.title`) : null}</AlertDialogTitle>
						<AlertDialogDescription>{cookiePrompt ? t(`queue.cookie.${cookiePrompt.kind}.body`) : null}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						{cookiePrompt?.kind === "decryption" || cookiePrompt?.kind === "metadata" ? (
							<AlertDialogAction onClick={() => settleCookiePrompt(false)}>{t("queue.cookie.dismiss")}</AlertDialogAction>
						) : (
							<>
								<AlertDialogCancel>{t("queue.cookie.dismiss")}</AlertDialogCancel>
								<AlertDialogAction onClick={() => settleCookiePrompt(true)}>{cookiePrompt ? t(`queue.cookie.${cookiePrompt.kind}.action`) : null}</AlertDialogAction>
							</>
						)}
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</PageShell>
	);
}
