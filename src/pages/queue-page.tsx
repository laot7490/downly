import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ClipboardPasteIcon, DownloadIcon, EyeIcon, Link2Icon, LinkIcon, ListVideoIcon, PlayIcon, SquareIcon, UserRoundIcon } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FormatPicker } from "@/components/downly/format-picker";
import { PageShell } from "@/components/downly/page-shell";
import { QueueList } from "@/components/downly/queue-list";
import { BrandMark } from "@/components/downly/brand-mark";
import { enqueue, expandPlaylist, probe, start, stop, updateQueueMetadata } from "@/lib/api";
import { formatError, toastError } from "@/lib/errors";
import {
	formatCount,
	formatDuration,
	isYouTube,
	linesOf,
	watchUrlWithoutList,
	type AppUpdate,
	type EnqueueOutcome,
	type ProbeOutcome,
	type Snapshot,
} from "@/lib/downly";
import {
	availableContainers,
	bestQualityId,
	presetChoices,
	qualityChoices,
	type ContainerKind,
	type QualityOption,
} from "@/lib/quality-options";

type Props = {
	snapshot: Snapshot;
	update: AppUpdate | null;
};


export function QueuePage({ snapshot, update }: Props) {
	const { t } = useTranslation();
	const best = t("queue.best");
	const [text, setText] = useState("");
	const [mode, setMode] = useState<"single" | "multiple">("single");
	const [busy, setBusy] = useState(false);
	const [probing, setProbing] = useState(false);
	const [probeRevision, setProbeRevision] = useState(0);
	const [metadataStatus, setMetadataStatus] = useState<{ kind: "loading" | "retrying" | "failed"; message: string } | null>(null);
	const [video, setVideo] = useState<Extract<ProbeOutcome, { kind: "video" }> | null>(null);
	const [container, setContainer] = useState<ContainerKind>("mp4");
	const [qualityId, setQualityId] = useState<string | null>(null);
	const [saveThumbnail, setSaveThumbnail] = useState(false);
	const [playlist, setPlaylist] = useState<{
		url: string;
		title: string | null;
		count: number;
		hasVideo: boolean;
	} | null>(null);
	const [updateAsk, setUpdateAsk] = useState(false);
	const seenFailed = useRef(new Set<string>());
	const failedSeeded = useRef(false);
	const metadataJobs = useRef(new Map<string, Promise<ProbeOutcome>>());
	const userChangedSelection = useRef(false);
	const metadataTarget = useRef<string | null>(null);

	const lines = useMemo(() => linesOf(text), [text]);
	const multi = mode === "multiple";
	const downloading = snapshot.queue.some((item) => item.status === "active") || snapshot.progress != null;
	const pending = snapshot.queue.some((item) => item.status === "pending");

	const probedContainers = video ? availableContainers(video.formats) : [];
	const containers: ContainerKind[] = video ? probedContainers : ["mp4", "mp3", "m4a"];
	const options: QualityOption[] = useMemo(() => {
		if (video) {
			return qualityChoices(container, video.formats, video.duration, best);
		}
		if (lines.length > 0 || playlist) {
			return presetChoices(container === "m4a" ? "mp3" : container, best);
		}
		return [];
	}, [video, container, lines.length, playlist, best]);
	const selected = options.find((option) => option.id === qualityId) ?? options[0] ?? null;
	const probeWithRetries = useCallback((url: string, reportStatus = true) => {
		const existing = metadataJobs.current.get(url);
		if (existing) {
			return existing;
		}
		const job = (async () => {
			for (let attempt = 1; attempt <= 3; attempt += 1) {
				try {
					return await probe(url);
				} catch (err) {
					if (attempt === 3) {
						if (reportStatus && metadataTarget.current === url) {
							setMetadataStatus({
								kind: "failed",
								message: t("queue.metadataFailed", { error: formatError(err, t("queue.errorFailed")) }),
							});
						}
						throw err;
					}
					const seconds = attempt;
					if (reportStatus && metadataTarget.current === url) {
						setMetadataStatus({
							kind: "retrying",
							message: t("queue.metadataRetrying", { attempt: attempt + 1, total: 3, seconds }),
						});
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
	}, [t]);

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
			toast.add({
				title: formatError(item.error, t("queue.errorFailed")),
				type: "error",
			});
		}
	}, [snapshot.session, t]);

	useEffect(() => {
		if (mode !== "single" || lines.length !== 1 || !/^https?:\/\//i.test(lines[0] ?? "")) {
			return;
		}
		const url = lines[0];
		metadataTarget.current = url;
		let cancelled = false;
		const timer = window.setTimeout(() => {
			setProbing(true);
			setMetadataStatus({ kind: "loading", message: "" });
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
						if (!userChangedSelection.current) {
							setContainer("mp4");
							setQualityId(bestQualityId("mp4"));
						}
						return;
					}
					setVideo(outcome);
					setMetadataStatus(null);
					if (!userChangedSelection.current) {
						const nextContainers = availableContainers(outcome.formats);
						const next = nextContainers[0] ?? "mp4";
						setContainer(next);
						setQualityId(bestQualityId(next));
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
		setPlaylist(null);
		setQualityId(null);
		setProbing(false);
		setMetadataStatus(null);
		userChangedSelection.current = false;
	}

	function shouldProbeSingle(value: string, targetMode = mode) {
		const nextLines = linesOf(value);
		return targetMode === "single" && nextLines.length === 1 && /^https?:\/\//i.test(nextLines[0] ?? "");
	}

	function applyContainer(next: ContainerKind, formats?: Extract<ProbeOutcome, { kind: "video" }>) {
		userChangedSelection.current = true;
		setContainer(next);
		setQualityId(bestQualityId(formats ? next : next === "m4a" ? "mp3" : next));
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
			const next = await navigator.clipboard.readText();
			const trimmed = next.trim();
			if (!trimmed) {
				return;
			}
			if (trimmed === text) {
				clearProbe();
			setProbing(shouldProbeSingle(trimmed));
				setProbeRevision((revision) => revision + 1);
				return;
			}
			setText(trimmed);
			clearProbe();
			setProbing(shouldProbeSingle(trimmed));
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
					const outcome = await probeWithRetries(item.url, false);
					if (outcome.kind === "video") {
						await updateQueueMetadata(item.id, outcome.title, outcome.thumbnail);
					}
				} catch {
					continue;
				}
			}
		});
		await Promise.all(workers);
	}

	async function onAdd() {
		if (lines.length === 0 || (mode === "single" && lines.length !== 1)) {
			return;
		}
		const selection = selected?.selection ?? presetChoices("mp4", best)[0]?.selection;
		if (!selection) {
			return;
		}
		const downloadSelection = { ...selection, save_thumbnail: saveThumbnail };
		setBusy(true);
		try {
			const singleVideo = mode === "single" && lines.length === 1 ? video : null;
			const outcomes = await enqueue(lines.map((url) => ({
				url,
				video_id: singleVideo?.id ?? "",
				title: singleVideo?.title ?? "",
				thumbnail: singleVideo?.thumbnail ?? null,
				selection: downloadSelection,
			})));
			applyOutcomes(outcomes);
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

	function retryMetadata() {
		clearProbe();
		setProbing(shouldProbeSingle(text));
		setProbeRevision((revision) => revision + 1);
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
			setMetadataStatus({ kind: "loading", message: "" });
			const outcome = await probeWithRetries(watch);
			if (outcome.kind === "video") {
				setText(watch);
				setVideo(outcome);
				const nextContainers = availableContainers(outcome.formats);
				const next = nextContainers[0] ?? "mp4";
				setContainer(next);
				setQualityId(bestQualityId(next));
			} else if (outcome.kind === "rejected") {
				toast.add({ title: t(`queue.reject.${outcome.reason}`), type: "error" });
			}
		} catch (err) {
			toastError(err, t("queue.errorFailed"));
		} finally {
			metadataTarget.current = null;
			setMetadataStatus(null);
			setBusy(false);
		}
	}

	async function onAddAll() {
		if (!playlist || !selected) {
			return;
		}
		setBusy(true);
		try {
			const summary = await expandPlaylist(playlist.url);
			const outcomes = await enqueue(
				summary.entries.map((entry) => ({
					url: entry.url,
					video_id: entry.id ?? "",
					title: entry.title ?? entry.url,
					thumbnail: entry.thumbnail,
					selection: { ...selected.selection, save_thumbnail: saveThumbnail },
				})),
			);
			applyOutcomes(outcomes);
			setPlaylist(null);
			setText("");
		} catch (err) {
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
			await stop();
		} catch (err) {
			toastError(err, t("queue.errorFailed"));
		}
	}

	async function openUpdate() {
		if (!update?.url) {
			return;
		}
		if (downloading) {
			setUpdateAsk(true);
			return;
		}
		await openUrl(update.url);
	}

	async function confirmUpdate() {
		setUpdateAsk(false);
		if (downloading) {
			await onStop();
		}
		if (update?.url) {
			await openUrl(update.url);
		}
	}

	const linksValid = lines.every((line) => /^https?:\/\//i.test(line));
	const showDetailsCard = (multi && lines.length > 0) || probing || video != null || playlist != null || metadataStatus?.kind === "failed";
	const showFormatPicker = multi || video != null || metadataStatus?.kind === "failed";
	const metadataBusy = probing || metadataStatus?.kind === "loading" || metadataStatus?.kind === "retrying";
	const canAdd = !busy && lines.length > 0 && linksValid && (multi || lines.length === 1);

	return (
		<PageShell>
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("queue.headline")}</h1>
				<p className="max-w-prose text-sm text-muted-foreground">{t("queue.sub")}</p>
			</div>
			{update?.newer ? (
				<Alert>
					<AlertTitle>{t("queue.updateReady")}</AlertTitle>
					<AlertDescription className="flex flex-col gap-2">
						<span>{update.version}</span>
						<Button type="button" size="sm" onClick={() => void openUpdate()}>
							{t("queue.updateOpen")}
						</Button>
					</AlertDescription>
				</Alert>
			) : null}
			<FieldGroup>
				<Field>
					<ToggleGroup
						aria-label={t("queue.inputMode")}
						variant="outline"
						spacing={0}
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
						<ToggleGroupItem value="single" className="min-w-24 justify-center">
							<Link2Icon data-icon="inline-start" />
							{t("queue.single")}
						</ToggleGroupItem>
						<ToggleGroupItem value="multiple" className="min-w-24 justify-center">
							<ListVideoIcon data-icon="inline-start" />
							{t("queue.multiple")}
						</ToggleGroupItem>
					</ToggleGroup>
					<div className="flex items-start gap-2">
						<div className="relative min-w-0 flex-1">
							<LinkIcon
								className={`pointer-events-none absolute size-4 text-muted-foreground ${multi ? "left-3 top-3" : "left-3 top-1/2 -translate-y-1/2"}`}
							/>
							<Textarea
								value={text}
								rows={multi ? 3 : 1}
								className={`resize-none py-2 pr-12 pl-9 ${multi ? "min-h-20" : "min-h-9"}`}
								placeholder={t(multi ? "queue.linksMultiplePlaceholder" : "queue.linksPlaceholder")}
								onChange={(event) => {
									setText(event.target.value);
									clearProbe();
									setProbing(shouldProbeSingle(event.target.value));
								}}
							/>
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
						<Button type="button" size="lg" className="w-24 shrink-0" disabled={!canAdd} onClick={() => void onAdd()}>
							{busy ? <Spinner data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />}
							{t("queue.add")}
						</Button>
					</div>
					{metadataStatus && metadataStatus.kind !== "loading" ? (
						<Alert>
							<AlertDescription className="flex flex-wrap items-center justify-between gap-2">
								<span role="status">{metadataStatus.message}</span>
								{metadataStatus.kind === "failed" && mode === "single" && lines.length === 1 ? (
									<Button type="button" variant="ghost" size="sm" onClick={retryMetadata}>
										{t("queue.retryMetadata")}
									</Button>
								) : null}
							</AlertDescription>
						</Alert>
					) : null}
				</Field>
				{showDetailsCard ? (
					<Card>
						<CardContent className="flex flex-col gap-4">
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
										{formatDuration(video.duration) ? (
											<Badge variant="secondary" className="absolute right-1.5 bottom-1.5">
												{formatDuration(video.duration)}
											</Badge>
										) : null}
									</div>
									<div className="flex min-w-0 flex-col justify-center gap-2">
										<p className="text-base font-medium text-foreground">{video.title}</p>
										{isYouTube(lines[0] ?? "") ? (
											<div className="flex flex-wrap items-center gap-1.5">
										{video.channel ? (
											<Badge variant="secondary">
												<UserRoundIcon data-icon="inline-start" />
												{video.channel}
											</Badge>
										) : null}
												{formatCount(video.view_count) ? (
													<Badge variant="secondary">
														<EyeIcon data-icon="inline-start" />
														{formatCount(video.view_count)}
													</Badge>
												) : null}
											</div>
										) : null}
									</div>
								</div>
							) : null}
							{showFormatPicker && !playlist ? (
								<>
									<FormatPicker
										container={container === "m4a" && !video ? "mp3" : container}
										containers={containers}
										qualityId={selected?.id ?? null}
										options={options}
										onContainer={(next) => applyContainer(next, video ?? undefined)}
													onQuality={(id) => {
													userChangedSelection.current = true;
													setQualityId(id);
												}}
									/>
									<Field orientation="horizontal" className="items-center">
										<Checkbox
											id="save-thumbnail"
											checked={saveThumbnail}
											onCheckedChange={(checked) => setSaveThumbnail(checked === true)}
										/>
										<FieldLabel htmlFor="save-thumbnail">{t("queue.saveThumbnail")}</FieldLabel>
									</Field>
								</>
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
							<Button type="button" variant="destructive" size="default" className="shrink-0" onClick={() => void onStop()}>
								<SquareIcon data-icon="inline-start" />
								{t("queue.stop")}
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
						<FormatPicker
							container={container === "m4a" ? "mp3" : container}
							containers={["mp4", "mp3"]}
							qualityId={selected?.id ?? null}
							options={presetChoices(container === "m4a" ? "mp3" : container, best)}
							onContainer={(next) => applyContainer(next)}
							onQuality={setQualityId}
						/>
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
						<Button type="button" disabled={busy || !selected} onClick={() => void onAddAll()}>
							{t("queue.addAll", { count: playlist?.count ?? 0 })}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<AlertDialog open={updateAsk} onOpenChange={setUpdateAsk}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("queue.updateReady")}</AlertDialogTitle>
						<AlertDialogDescription>{t("queue.updateWhileDownloading")}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("queue.updateCancel")}</AlertDialogCancel>
						<AlertDialogAction onClick={() => void confirmUpdate()}>{t("queue.updateConfirm")}</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</PageShell>
	);
}
