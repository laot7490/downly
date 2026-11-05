import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { CalendarDaysIcon, CheckIcon, ClipboardPasteIcon, DownloadIcon, EyeIcon, HistoryIcon, Link2Icon, LinkIcon, ListVideoIcon, PlayIcon, RadioIcon, SquareIcon, TriangleAlertIcon, UserRoundIcon } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import { enqueue, expandPlaylist, finishLiveRecording, probe, retryFailedSessionItem, start, stop, updateQueueMetadata } from "@/lib/api";
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
	type Snapshot,
} from "@/lib/downly";
import { presetChoices } from "@/lib/quality-options";
import { defaultFormatChoice, formatChoices, qualityChoices, type FormatChoice, type QualityChoice } from "@/lib/media-options";

type Props = {
	snapshot: Snapshot;
};

type CookiePromptRequest = { kind: CookieErrorKind | "metadata"; resolve: (retry: boolean) => void };
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
	const [liveDialogOpen, setLiveDialogOpen] = useState(false);
	const [liveMode, setLiveMode] = useState<LiveMode>("from_now");
	const [finishingLiveId, setFinishingLiveId] = useState<string | null>(null);
	const [playlist, setPlaylist] = useState<{
		url: string;
		title: string | null;
		count: number;
		hasVideo: boolean;
	} | null>(null);
	const [cookiePrompt, setCookiePrompt] = useState<CookiePromptRequest | null>(null);
	const activeCookiePrompt = useRef<CookiePromptRequest | null>(null);
	const queuedCookiePrompts = useRef<CookiePromptRequest[]>([]);
	const seenFailed = useRef(new Set<string>());
	const failedSeeded = useRef(false);
	const metadataJobs = useRef(new Map<string, Promise<ProbeOutcome>>());
	const userChangedSelection = useRef(false);
	const metadataTarget = useRef<string | null>(null);

	const lines = useMemo(() => linesOf(text), [text]);
	const multi = mode === "multiple";
	const downloading = snapshot.queue.some((item) => item.status === "active") || snapshot.progress != null;
	const activeItem = snapshot.queue.find((item) => item.status === "active") ?? null;
	const activeLive = activeItem?.live_mode != null;
	const finishingLive = activeItem != null && activeLive && finishingLiveId === activeItem.id;
	const pending = snapshot.queue.some((item) => item.status === "pending");

	const formatOptions: FormatChoice[] = useMemo(() => video ? formatChoices(video.formats) : [], [video]);
	const selectedFormat = formatOptions.find((option) => option.id === formatId) ?? formatOptions[0] ?? null;
	const baseOptions: QualityChoice[] = useMemo(() => selectedFormat && video ? qualityChoices(selectedFormat, video.formats, video.duration, best) : [], [selectedFormat, video, best]);
	const multiFormatOptions: FormatChoice[] = [
		{ id: "video:mp4", ext: "mp4", label: "MP4", category: "video" },
		{ id: "audio:mp3", ext: "mp3", label: "MP3", category: "audio" },
	];
	const multiFormatId = formatId === "audio:mp3" ? "audio:mp3" : "video:mp4";
	const multiQualityOptions: QualityChoice[] = useMemo(() => presetChoices(multiFormatId === "audio:mp3" ? "mp3" : "mp4", best).map((option) => ({ id: option.id, label: option.label, selection: option.selection, sizeBytes: option.sizeBytes })), [multiFormatId, best]);
	const multiSelected = multiQualityOptions.find((option) => option.id === qualityId) ?? multiQualityOptions[0] ?? null;
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
						setPlaylist({
							url,
							title: outcome.title,
							count: outcome.count,
							hasVideo: Boolean(watchUrlWithoutList(url)),
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
		}, 400);
		return () => {
			cancelled = true;
			window.clearTimeout(timer);
		};
	}, [mode, text, t, lines, probeRevision, probeWithRetries]);

	function clearProbe() {
		metadataTarget.current = null;
		setVideo(null);
		setLiveDialogOpen(false);
		setPlaylist(null);
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

	async function runWithCookiePrompt<T>(operation: () => Promise<T>): Promise<T> {
		try {
			return await operation();
		} catch (err) {
			const cookieError = classifyCookieError(err);
			if (!cookieError) {
				throw err;
			}
			const retry = await askCookiePrompt(cookieError);
			if (!retry || cookieError === "decryption") {
				throw cookiePromptDismissed;
			}
			return operation();
		}
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
				setProbing(shouldProbeSingle(trimmed));
				setProbeRevision((revision) => revision + 1);
				return;
			}
			const nextText = multi && text.trim() ? `${text.replace(/\s*$/, "")}\n${trimmed}` : trimmed;
			setText(nextText);
			clearProbe();
			setProbing(shouldProbeSingle(nextText));
		} catch (err) {
			toastError(err, t("queue.pasteFailed"));
		}
	}

	async function hydrateQueueItems(items: { id: string; url: string }[]) {
		const pendingItems = [...items];
		const workers = Array.from({ length: Math.min(3, pendingItems.length) }, async () => {
			while (pendingItems.length > 0) {
				const item = pendingItems.shift();
				if (!item) {
					return;
				}
				try {
					const outcome = await probeWithRetries(item.url, false, true);
					if (outcome.kind === "video") {
						await updateQueueMetadata(item.id, outcome.id, outcome.title, outcome.thumbnail, outcome.duration == null ? null : Math.round(outcome.duration));
					}
				} catch {
					continue;
				}
			}
		});
		await Promise.all(workers);
	}

	function onAdd() {
		if (video?.is_live) {
			setLiveMode("from_now");
			setLiveDialogOpen(true);
			return;
		}
		void enqueueCurrent(null);
	}

	async function enqueueCurrent(selectedLiveMode: LiveMode | null) {
		if (lines.length === 0 || (mode === "single" && lines.length !== 1)) {
			return;
		}
		const selection = selected?.selection ?? presetChoices("mp4", best)[0]?.selection;
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
			const outcomes = await enqueue(lines.map((url) => ({
				url,
				video_id: singleVideo?.id ?? "",
				title: singleVideo?.title ?? "",
				thumbnail: singleVideo?.thumbnail ?? null,
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

	async function onOnlyThis() {
		if (!playlist) {
			return;
		}
		const watch = watchUrlWithoutList(playlist.url);
		if (!watch) {
			return;
		}
		setBusy(true);
		try {
			setPlaylist(null);
			metadataTarget.current = watch;
			setMetadataStatus({ kind: "loading" });
			const outcome = await probeWithRetries(watch, false, true);
			if (outcome.kind === "video") {
				setText(watch);
				setVideo(outcome);
				const format = defaultFormatChoice(outcome.formats);
				setFormatId(format?.id ?? null);
				setQualityId(format ? "best" : null);
			} else if (outcome.kind === "rejected") {
				toast.add({ title: t(`queue.reject.${outcome.reason}`), type: "error" });
			}
		} catch (err) {
			if (err === cookiePromptDismissed) {
				return;
			}
			toast.add({
				title: t("queue.metadataFailed", { error: formatError(err, t("queue.errorFailed")) }),
				type: "error",
			});
		} finally {
			metadataTarget.current = null;
			setMetadataStatus(null);
			setBusy(false);
		}
	}

	async function onAddAll() {
		if (!playlist) {
			return;
		}
		const selection = multiSelected?.selection ?? presetChoices(multiFormatId === "audio:mp3" ? "mp3" : "mp4", best)[0]?.selection;
		if (!selection) return;
		setBusy(true);
		try {
			const summary = await runWithCookiePrompt(() => expandPlaylist(playlist.url));
			const outcomes = await enqueue(
				summary.entries.map((entry) => ({
					url: entry.url,
					video_id: entry.id ?? "",
					title: entry.title ?? entry.url,
					thumbnail: entry.thumbnail,
					selection: { ...selection, save_thumbnail: saveThumbnail },
					preflight_checked: false,
					duration_seconds: null,
					size_bytes: null,
				})),
			);
			applyOutcomes(outcomes);
			setPlaylist(null);
			setText("");
		} catch (err) {
			if (err === cookiePromptDismissed) {
				return;
			}
			toastError(err, t("queue.errorFailed"));
		} finally {
			setBusy(false);
		}
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
	const showDetailsCard = (multi && lines.length > 0) || probing || video != null || playlist != null;
	const pickerFormats = multi ? multiFormatOptions : formatOptions;
	const pickerQualities = multi ? multiQualityOptions : options;
	const pickerFormatId = multi ? multiFormatId : selectedFormat?.id ?? null;
	const pickerQuality = multi ? multiSelected : selected;
	const showFormatPicker = (multi || video != null) && pickerQualities.length > 0;
	const metadataBusy = probing || metadataStatus?.kind === "loading" || metadataStatus?.kind === "retrying";
	const canAdd = !busy && !metadataBusy && lines.length > 0 && linksValid && (multi || lines.length === 1);

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
									className="min-h-20 resize-none py-2 pr-12 pl-9"
									placeholder={t("queue.linksMultiplePlaceholder")}
									onChange={(event) => {
										setText(event.target.value);
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
						<CardContent className="p-0">
							<div className={multi ? "hidden" : "p-6"}>
							{probing ? (
								<div className="flex gap-4">
									<Skeleton className="aspect-video w-48 shrink-0 rounded-lg" />
									<div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
										<Skeleton className="h-5 w-3/4" />
										<Skeleton className="h-4 w-1/2" />
										<div className="flex gap-1.5">
											<Skeleton className="h-5 w-20 rounded-full" />
											<Skeleton className="h-5 w-16 rounded-full" />
										</div>
									</div>
								</div>
							) : null}
							{video && !probing ? (
								<div className="flex gap-4">
									<div className="relative aspect-video w-48 shrink-0 overflow-hidden rounded-lg bg-muted">
										{video.thumbnail ? (
											<img src={video.thumbnail} alt="" className="size-full object-cover" />
										) : (
											<div className="flex size-full items-center justify-center">
												<BrandMark className="size-8 opacity-40" />
											</div>
										)}
										{!video.is_live && formatDuration(video.duration) ? (
											<Badge variant="secondary" className="absolute right-1 bottom-1 rounded-md border-0 bg-black/80 text-white shadow-none">
												{formatDuration(video.duration)}
											</Badge>
										) : null}
									</div>
									<div className="flex min-w-0 flex-col justify-center gap-2">
										<p className="text-base font-medium text-foreground">{video.title}{video.is_live ? <Badge variant="destructive" className="ml-2 align-middle"><RadioIcon aria-hidden="true" />{t("queue.live")}</Badge> : null}</p>
										{video.channel || formatCount(video.view_count) || formatUploadDate(video.upload_date) ? (
											<div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
											{video.channel ? <span className="inline-flex items-center gap-1.5"><UserRoundIcon className="size-3.5" />{video.channel}</span> : null}
											{formatCount(video.view_count) ? <span className="inline-flex items-center gap-1.5"><EyeIcon className="size-3.5" />{formatCount(video.view_count)}</span> : null}
											{formatUploadDate(video.upload_date) ? <span className="inline-flex items-center gap-1.5"><CalendarDaysIcon className="size-3.5" />{formatUploadDate(video.upload_date)}</span> : null}
											</div>
										) : null}
									</div>
								</div>
							) : null}
							</div>
							{showFormatPicker && !playlist ? (
								<div className={`flex flex-col gap-4 p-6 ${multi ? "" : "border-t border-border bg-muted"}`}>
								{showFormatPicker && !playlist ? <>
									<FormatPicker
										formats={pickerFormats}
										formatId={pickerFormatId}
										qualities={pickerQualities}
										qualityId={pickerQuality?.id ?? null}
										clipEnabled={clipRange != null}
										thumbnailEnabled={saveThumbnail}
										showClip={!multi && !video?.is_live}
										showThumbnail
										onFormat={(id) => {
											userChangedSelection.current = true;
											setFormatId(id);
											setQualityId("best");
										}}
										onQuality={(id) => {
											userChangedSelection.current = true;
											setQualityId(id);
										}}
										onClipEnabled={(enabled) => setClipRange(enabled && video?.duration ? { start_seconds: 0, end_seconds: video.duration } : null)}
										onThumbnailEnabled={setSaveThumbnail}
									/>
									{!multi && clipRange && video && video.duration && video.duration > 1 && clipAllowed ? (
										<ClipPicker duration={video.duration} range={clipRange} onChange={setClipRange} />
									) : null}
								</> : null}
								</div>
							) : null}
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
						<Field orientation="horizontal" className="items-center">
							<Checkbox
								id="save-thumbnail"
								checked={saveThumbnail}
								onCheckedChange={(checked) => setSaveThumbnail(checked === true)}
							/>
							<FieldLabel htmlFor="save-thumbnail">{t("queue.saveThumbnail")}</FieldLabel>
						</Field>
					</div>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => setPlaylist(null)}>
							{t("queue.close")}
						</Button>
						{playlist?.hasVideo ? (
							<Button type="button" variant="secondary" disabled={busy} onClick={() => void onOnlyThis()}>
								{t("queue.onlyThisVideo")}
							</Button>
						) : null}
						<Button type="button" disabled={busy} onClick={() => void onAddAll()}>
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
