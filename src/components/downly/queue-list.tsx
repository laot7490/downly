import { Fragment, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { DragDropProvider, PointerSensor, type DragEndEvent } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
	SiFacebook,
	SiInstagram,
	SiKick,
	SiReddit,
	SiTiktok,
	SiTwitch,
	SiX,
	SiYoutube,
} from "@icons-pack/react-simple-icons";
import { ArchiveIcon, EllipsisVerticalIcon, FolderIcon, LinkIcon, MenuIcon, RadioIcon, RefreshCwIcon, Trash2Icon, XIcon } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BrandMark } from "@/components/downly/brand-mark";
import { DownloadBadges } from "@/components/downly/download-badges";
import { MediaRow } from "@/components/downly/media-row";
import {
	archiveCompletedSessionAll,
	archiveSession,
	cancelItem,
	clearQueue,
	deleteCompletedSessionItem,
	retryFailedSession,
	retryCancelledSessionItem,
	removeCancelledSessionItem,
	retryFailedSessionItem,
	removeFailedSessionItem,
	reorderQueueItem,
	revealPath,
} from "@/lib/api";
import { toastError } from "@/lib/errors";
import type { HistoryItem, QueueEntry, Snapshot } from "@/lib/downly";

const supportedSites = [
	{ name: "YouTube", Icon: SiYoutube },
	{ name: "TikTok", Icon: SiTiktok },
	{ name: "Instagram", Icon: SiInstagram },
	{ name: "Twitch", Icon: SiTwitch },
	{ name: "X", Icon: SiX },
	{ name: "Kick", Icon: SiKick },
	{ name: "Facebook", Icon: SiFacebook },
	{ name: "Reddit", Icon: SiReddit },
];
const supportedSitesUrl = "https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md";
const pointerSensors = [PointerSensor];

type FilterId = "all" | "pending" | "active" | "completed" | "failed" | "cancelled";

const filters: FilterId[] = ["all", "pending", "active", "completed", "failed", "cancelled"];

type Props = {
	snapshot: Snapshot;
	actions?: ReactNode;
};

type Row = { kind: "queue"; item: QueueEntry } | { kind: "session"; item: HistoryItem };
type PendingGroup = "live" | "regular";
type LocalOrder = { group: PendingGroup; ids: string[] };

export function QueueList({ snapshot, actions }: Props) {
	const { t } = useTranslation();
	const reducedMotion = useReducedMotion();
	const best = t("queue.best");
	const [filter, setFilter] = useState<FilterId>("all");
	const [clearOpen, setClearOpen] = useState(false);
	const [clearing, setClearing] = useState(false);
	const [localOrder, setLocalOrder] = useState<LocalOrder | null>(null);
	const counts = {
		all: snapshot.queue.length + snapshot.session.length,
		pending: snapshot.queue.filter((item) => item.status === "pending").length,
		active: snapshot.queue.filter((item) => item.status === "active").length,
		completed: snapshot.session.filter((item) => item.status === "success").length,
		failed: snapshot.session.filter((item) => item.status === "failed").length,
		cancelled: snapshot.session.filter((item) => item.status === "cancelled").length,
	};
	const failedCount = snapshot.session.filter((item) => item.status === "failed").length;
	const completedCount = snapshot.session.filter((item) => item.status === "success").length;
	const hasClearableItems = snapshot.queue.length > 0 || snapshot.session.length > 0;
	useEffect(() => {
		if (!localOrder) return;
		const currentIds = snapshot.queue
			.filter((item) => item.status === "pending" && (item.live_mode != null) === (localOrder.group === "live"))
			.map((item) => item.id);
		const expectedIds = localOrder.ids.filter((id) => currentIds.includes(id));
		const addedCount = currentIds.length - expectedIds.length;
		const hasExpectedOrder = currentIds.slice(addedCount).every((id, index) => id === expectedIds[index]);
		const hasNewItemsAtTop = currentIds.slice(0, addedCount).every((id) => !localOrder.ids.includes(id));
		if (hasExpectedOrder && hasNewItemsAtTop) setLocalOrder(null);
	}, [snapshot.queue, localOrder]);
	const rows = rowsFor(snapshot, filter, localOrder);
	const pendingRows = rows.filter((row): row is Extract<Row, { kind: "queue" }> => row.kind === "queue" && row.item.status === "pending");
	const livePending = pendingRows.filter((row) => row.item.live_mode != null);
	const regularPending = pendingRows.filter((row) => row.item.live_mode == null);
	const pendingIndexes = new Map<string, number>();
	for (const [index, row] of livePending.entries()) pendingIndexes.set(row.item.id, index);
	for (const [index, row] of regularPending.entries()) pendingIndexes.set(row.item.id, index);

	function handleDragEnd(event: DragEndEvent) {
		if (event.canceled || !isSortable(event.operation.source)) return;
		const source = event.operation.source;
		if (source.initialIndex === source.index) return;
		const id = String(source.id);
		const item = pendingRows.find((row) => row.item.id === id)?.item;
		if (!item) return;
		const group = item.live_mode != null ? "live" : "regular";
		const groupRows = group === "live" ? livePending : regularPending;
		const reordered = [...groupRows];
		const [moved] = reordered.splice(source.initialIndex, 1);
		if (!moved) return;
		reordered.splice(source.index, 0, moved);
		const ids = reordered.map((row) => row.item.id);
		setLocalOrder({ group, ids });
		void reorderQueueItem(id, ids[source.index + 1] ?? null)
			.then((changed) => {
				if (!changed) setLocalOrder(null);
			})
			.catch((err) => {
				setLocalOrder(null);
				toastError(err, t("queue.errorFailed"));
			});
	}

	async function onClearQueue() {
		setClearing(true);
		try {
			await clearQueue();
			setClearOpen(false);
		} catch (err) {
			toastError(err, t("queue.clearFailed"));
		} finally {
			setClearing(false);
		}
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-3">
				<ToggleGroup
					className="w-fit min-w-0 max-w-full flex-wrap rounded-lg bg-transparent p-1 dark:bg-input/30"
					size="sm"
					spacing={1}
					value={[filter]}
					onValueChange={(value) => {
						const next = value[0];
						if (isFilter(next)) {
							setFilter(next);
						}
					}}>
					{filters.map((item, index) => (
						<Fragment key={item}>
							<ToggleGroupItem value={item} className="aria-pressed:bg-background aria-pressed:shadow-xs">
								{t(`queue.filters.${item}`)}
								<Badge variant={filter === item ? "default" : "secondary"}>{counts[item]}</Badge>
							</ToggleGroupItem>
							{index < filters.length - 1 ? <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" /> : null}
						</Fragment>
					))}
				</ToggleGroup>
				<div className="ml-auto flex shrink-0 items-center gap-1">
					{actions}
					{actions ? (
						<DropdownMenu>
							<DropdownMenuTrigger
								render={<Button type="button" variant="outline" size="icon" aria-label={t("queue.moreActions")} />}
							>
								<EllipsisVerticalIcon />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="min-w-52">
								<DropdownMenuItem
									disabled={failedCount === 0}
									onClick={() => void retryFailedSession().catch((err) => toastError(err, t("queue.errorFailed")))}
								>
									<RefreshCwIcon />
									{t("queue.retryFailed")}
								</DropdownMenuItem>
								<DropdownMenuItem
									disabled={completedCount === 0}
									onClick={() => void archiveCompletedSessionAll().catch((err) => toastError(err, t("queue.archiveFailed")))}
								>
									<ArchiveIcon />
									{t("queue.archiveCompleted")}
								</DropdownMenuItem>
								<DropdownMenuItem variant="destructive" disabled={!hasClearableItems} onClick={() => setClearOpen(true)}>
									<Trash2Icon />
									{t("queue.clearQueue")}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					) : null}
				</div>
			</div>
			<AlertDialog open={clearOpen} onOpenChange={(open) => !clearing && setClearOpen(open)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("queue.clearQueueTitle")}</AlertDialogTitle>
						<AlertDialogDescription>{t("queue.clearQueueBody")}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={clearing}>{t("queue.clearQueueCancel")}</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={clearing}
							onClick={(event) => {
								event.preventDefault();
								void onClearQueue();
							}}>
							{t("queue.clearQueueConfirm")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
			{counts.all === 0 ? (
				<Empty className="flex-none border-2 border-dashed border-border">
					<EmptyHeader>
						<EmptyMedia>
							<BrandMark className="size-8 opacity-40" />
						</EmptyMedia>
						<EmptyTitle>{t("queue.emptyTitle")}</EmptyTitle>
						<EmptyDescription>{t("queue.empty")}</EmptyDescription>
					</EmptyHeader>
					<EmptyContent className="max-w-lg">
						<div className="flex w-full max-w-[25rem] flex-wrap justify-center gap-1.5">
							{supportedSites.map(({ name, Icon }) => (
								<Badge
									key={name}
									variant="secondary"
									className="h-6 gap-1.5 border-0 text-[11px] font-medium text-muted-foreground">
									<Icon
										aria-hidden="true"
										color="var(--muted-foreground)"
										size={14}
									/>
									{name}
								</Badge>
							))}
							<Badge variant="secondary" className="h-6 border-0 px-2 text-[11px] font-medium text-muted-foreground">
								{t("queue.moreSupportedSites")}
							</Badge>
						</div>
						<a
							href={supportedSitesUrl}
							className="mt-0.5 text-xs font-medium text-primary underline-offset-4 hover:underline"
							onClick={(event) => {
								event.preventDefault();
								void openUrl(supportedSitesUrl);
							}}>
							{t("queue.viewSupportedSites")}
						</a>
					</EmptyContent>
				</Empty>
			) : rows.length === 0 ? (
				<p className="text-sm text-muted-foreground">{t("queue.filterEmpty")}</p>
			) : (
				<DragDropProvider sensors={pointerSensors} onDragEnd={handleDragEnd}>
					<div className="flex flex-col gap-2">
						{rows.map((row) => {
							if (row.kind === "session") return <SessionRow key={row.item.id} item={row.item} best={best} />;
							if (row.item.status === "active") return <QueueRow key={row.item.id} item={row.item} snapshot={snapshot} best={best} />;
							const group = row.item.live_mode != null ? "live" : "regular";
							return (
								<SortableQueueRow
									key={row.item.id}
									item={row.item}
									snapshot={snapshot}
									best={best}
									index={pendingIndexes.get(row.item.id) ?? 0}
									group={group}
									reducedMotion={reducedMotion}
								/>
							);
						})}
					</div>
				</DragDropProvider>
			)}
		</div>
	);
}

function SortableQueueRow({
	item,
	snapshot,
	best,
	index,
	group,
	reducedMotion,
}: {
	item: QueueEntry;
	snapshot: Snapshot;
	best: string;
	index: number;
	group: PendingGroup;
	reducedMotion: boolean;
}) {
	const rowRef = useRef<HTMLDivElement>(null);
	const handleRef = useRef<HTMLSpanElement>(null);
	const { isDragging } = useSortable({
		id: item.id,
		index,
		group,
		element: rowRef,
		handle: handleRef,
		transition: reducedMotion ? null : { duration: 220, easing: "cubic-bezier(0.16, 1, 0.3, 1)", idle: true },
	});
	return (
		<div
			ref={rowRef}
			data-dragging={isDragging}
			className="relative rounded-md transition-[background-color,box-shadow] duration-150 motion-reduce:transition-none data-[dragging=true]:z-10 data-[dragging=true]:bg-muted/40 data-[dragging=true]:shadow-sm">
			<QueueRow item={item} snapshot={snapshot} best={best} dragHandleRef={handleRef} />
		</div>
	);
}

function QueueRow({
	item,
	snapshot,
	best,
	dragHandleRef,
}: {
	item: QueueEntry;
	snapshot: Snapshot;
	best: string;
	dragHandleRef?: RefObject<HTMLSpanElement | null>;
}) {
	const { t } = useTranslation();
	const progress = snapshot.progress?.id === item.id ? snapshot.progress : null;
	const isLive = item.live_mode != null;
	return (
		<MediaRow
			leading={dragHandleRef ? (
				<span ref={dragHandleRef} aria-hidden="true" className="flex h-9 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/60 transition-colors hover:text-foreground active:cursor-grabbing active:text-foreground">
					<MenuIcon className="size-4" />
				</span>
			) : item.status === "active" ? (
				<span aria-hidden="true" className="flex h-9 w-5 shrink-0 cursor-not-allowed items-center justify-center text-muted-foreground/30">
					<MenuIcon className="size-4" />
				</span>
			) : undefined}
			thumbnail={item.thumbnail}
			title={item.title}
			meta={
				<div className="flex min-w-0 flex-col gap-1.5">
					<div className="flex min-w-0 flex-wrap items-center gap-1.5">
						<Badge variant={item.status === "active" ? "default" : "outline"}>{t(item.status === "active" && item.live_mode === "from_now" ? "queue.recording" : `queue.${item.status}`)}</Badge>
						{isLive ? <Badge variant="destructive"><RadioIcon aria-hidden="true" />{t("queue.live")}</Badge> : null}
						<DownloadBadges selection={item.selection} best={best} durationSeconds={isLive ? null : item.duration_seconds} sizeBytes={isLive ? null : item.size_bytes} estimatedSize />
					</div>
					{progress ? (
						<div className="flex flex-col gap-1">
							<Progress value={isLive ? null : progress.percent ?? 0} />
							<p className="flex gap-2 text-xs text-muted-foreground">
								{progress.percent != null ? <span>{progress.percent.toFixed(0)}%</span> : null}
								{progress.speed ? <span>{progress.speed}</span> : null}
								{!isLive && progress.eta ? <span>{progress.eta}</span> : null}
							</p>
						</div>
					) : null}
				</div>
			}
			actions={
				(item.status === "pending" || item.status === "active") ? (
					<Button
						type="button"
						variant="outline"
						size="icon"
						aria-label={t(item.status === "active" ? "queue.cancelDownload" : "queue.remove")}
						onClick={() => void cancelItem(item.id).catch((err) => toastError(err, t("queue.errorFailed")))}>
						{item.status === "active" ? <XIcon /> : <Trash2Icon />}
					</Button>
				) : null
			}
		/>
	);
}

function SessionRow({ item, best }: { item: HistoryItem; best: string }) {
	const { t } = useTranslation();
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const variant = item.status === "success" ? "success" : item.status === "failed" ? "destructive" : "outline";
	const label = item.status === "success" ? t("queue.filters.completed") : t(`history.${item.status}`);
	const isLive = item.live_mode != null;
	return (
		<MediaRow
			thumbnail={item.thumbnail}
			title={item.title}
			meta={
				<div className="flex min-w-0 flex-col gap-1">
					<div className="flex min-w-0 flex-wrap items-center gap-1.5">
						<Badge variant={variant}>{label}</Badge>
						{isLive ? <Badge variant="destructive"><RadioIcon aria-hidden="true" />{t("queue.live")}</Badge> : null}
						<DownloadBadges selection={item.selection} best={best} durationSeconds={isLive ? null : item.duration_seconds} sizeBytes={isLive ? null : item.status === "success" ? item.size_bytes : null} />
					</div>
					{item.error ? <p className="text-sm text-destructive">{item.error}</p> : null}
				</div>
			}
			actions={
				item.status === "success" ? (
					<>
						<Button
							type="button"
							variant="outline"
							size="icon"
							aria-label={t("history.reveal")}
							disabled={!item.path}
							onClick={() => item.path && void revealPath(item.path).catch((err) => toastError(err, t("queue.errorFailed")))}>
							<FolderIcon />
						</Button>
						<DropdownMenu>
							<DropdownMenuTrigger
							render={<Button type="button" variant="outline" size="icon" aria-label={t("history.more")} />}
							>
								<EllipsisVerticalIcon />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="min-w-40">
								<DropdownMenuItem onClick={() => void navigator.clipboard.writeText(item.url)}>
									<LinkIcon />
									{t("history.copy")}
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={() => void archiveSession(item.id).catch((err) => toastError(err, t("queue.archiveFailed")))}
								>
									<ArchiveIcon />
									{t("queue.archive")}
								</DropdownMenuItem>
								<DropdownMenuItem variant="destructive" disabled={!item.path} onClick={() => setDeleteOpen(true)}>
									<Trash2Icon />
									{t("queue.deleteCompleted")}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
						<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>{t("queue.deleteCompletedTitle")}</AlertDialogTitle>
									<AlertDialogDescription>{t("queue.deleteCompletedBody", { title: item.title })}</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel disabled={deleting}>{t("queue.deleteCompletedCancel")}</AlertDialogCancel>
									<AlertDialogAction
										disabled={deleting || !item.path}
										onClick={(event) => {
											event.preventDefault();
											setDeleting(true);
											void deleteCompletedSessionItem(item.id)
												.then(() => setDeleteOpen(false))
												.catch((err) => toastError(err, t("queue.deleteCompletedFailed")))
												.finally(() => setDeleting(false));
										}}>
										{t("queue.deleteCompleted")}
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
					</>
				) : item.status === "failed" || item.status === "cancelled" ? (
					<div className="flex gap-2">
						{item.path ? (
							<Button
								type="button"
								variant="outline"
								size="icon"
								aria-label={t("history.reveal")}
								onClick={() => void revealPath(item.path!).catch((err) => toastError(err, t("queue.errorFailed")))}>
								<FolderIcon />
							</Button>
						) : null}
						<Button
							type="button"
							variant="outline"
							size="icon"
							aria-label={t("history.retry")}
							onClick={() => void (item.status === "failed" ? retryFailedSessionItem(item.id) : retryCancelledSessionItem(item.id)).catch((err) => toastError(err, t("queue.errorFailed")))}>
							<RefreshCwIcon />
						</Button>
						<Button
							type="button"
							variant="outline"
							size="icon"
							aria-label={t("queue.remove")}
							onClick={() => void (item.status === "failed" ? removeFailedSessionItem(item.id) : removeCancelledSessionItem(item.id)).catch((err) => toastError(err, t("queue.errorFailed")))}>
							<Trash2Icon />
						</Button>
					</div>
				) : null
			}
		/>
	);
}

function rowsFor(snapshot: Snapshot, filter: FilterId, localOrder: LocalOrder | null): Row[] {
	const livePending = snapshot.queue.filter((item) => item.status === "pending" && item.live_mode != null);
	const regularPending = snapshot.queue.filter((item) => item.status === "pending" && item.live_mode == null);
	const pending = [
		...applyLocalOrder(livePending, localOrder?.group === "live" ? localOrder.ids : null),
		...applyLocalOrder(regularPending, localOrder?.group === "regular" ? localOrder.ids : null),
	].map((item) => ({ kind: "queue" as const, item }));
	const active = snapshot.queue.filter((item) => item.status === "active").map((item) => ({ kind: "queue" as const, item }));
	const session = [...snapshot.session]
		.sort((a, b) => b.finished_at - a.finished_at)
		.map((item) => ({ kind: "session" as const, item }));
	if (filter === "pending") {
		return pending;
	}
	if (filter === "active") {
		return active;
	}
	if (filter === "completed") {
		return session.filter((row) => row.item.status === "success");
	}
	if (filter === "failed") {
		return session.filter((row) => row.item.status === "failed");
	}
	if (filter === "cancelled") {
		return session.filter((row) => row.item.status === "cancelled");
	}
	return [...active, ...pending, ...session];
}

function applyLocalOrder(items: QueueEntry[], order: string[] | null): QueueEntry[] {
	if (!order) return items;
	const ranks = new Map(order.map((id, index) => [id, index]));
	return items
		.map((item, index) => ({ item, index, rank: ranks.get(item.id) }))
		.sort((a, b) => {
			if (a.rank == null && b.rank == null) return a.index - b.index;
			if (a.rank == null) return -1;
			if (b.rank == null) return 1;
			return a.rank - b.rank;
		})
		.map(({ item }) => item);
}

function isFilter(value: string | undefined): value is FilterId {
	return filters.some((item) => item === value);
}

function useReducedMotion() {
	const [reducedMotion, setReducedMotion] = useState(
		() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
	);
	useEffect(() => {
		const query = window.matchMedia("(prefers-reduced-motion: reduce)");
		const update = () => setReducedMotion(query.matches);
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);
	return reducedMotion;
}
