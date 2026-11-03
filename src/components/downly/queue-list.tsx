import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArchiveIcon, EllipsisVerticalIcon, FolderIcon, LinkIcon, RefreshCwIcon, Trash2Icon, XIcon } from "lucide-react";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { BrandMark } from "@/components/downly/brand-mark";
import { MediaRow } from "@/components/downly/media-row";
import {
	archiveCompletedSessionAll,
	archiveSession,
	cancelItem,
	deleteCompletedSessionItem,
	retryFailedSession,
	revealPath,
} from "@/lib/api";
import { toastError } from "@/lib/errors";
import { formatBytes } from "@/lib/downly";
import { describeSelection } from "@/lib/quality-options";
import type { HistoryItem, QueueEntry, Snapshot } from "@/lib/downly";

type FilterId = "all" | "pending" | "active" | "completed" | "failed" | "cancelled";

const filters: FilterId[] = ["all", "pending", "active", "completed", "failed", "cancelled"];

type Props = {
	snapshot: Snapshot;
	actions?: ReactNode;
};

type Row = { kind: "queue"; item: QueueEntry } | { kind: "session"; item: HistoryItem };

export function QueueList({ snapshot, actions }: Props) {
	const { t } = useTranslation();
	const best = t("queue.best");
	const [filter, setFilter] = useState<FilterId>("all");
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
	const rows = rowsFor(snapshot, filter);

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-3">
				<ToggleGroup
					className="min-w-0 w-auto max-w-full flex-1 flex-wrap"
					variant="outline"
					spacing={2}
					value={[filter]}
					onValueChange={(value) => {
						const next = value[0];
						if (isFilter(next)) {
							setFilter(next);
						}
					}}>
					{filters.map((item) => (
						<ToggleGroupItem key={item} value={item}>
							{t(`queue.filters.${item}`)}
							<Badge variant={filter === item ? "default" : "secondary"}>{counts[item]}</Badge>
						</ToggleGroupItem>
					))}
				</ToggleGroup>
				<div className="flex shrink-0 items-center gap-1">
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
							</DropdownMenuContent>
						</DropdownMenu>
					) : null}
				</div>
			</div>
			{counts.all === 0 ? (
				<Empty className="flex-none border border-dashed border-border">
					<EmptyHeader>
						<EmptyMedia>
							<BrandMark className="size-8 opacity-40" />
						</EmptyMedia>
						<EmptyTitle>{t("queue.emptyTitle")}</EmptyTitle>
						<EmptyDescription>{t("queue.empty")}</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : rows.length === 0 ? (
				<p className="text-sm text-muted-foreground">{t("queue.filterEmpty")}</p>
			) : (
				<div>
					{rows.map((row) =>
						row.kind === "queue" ? (
							<QueueRow key={row.item.id} item={row.item} snapshot={snapshot} best={best} />
						) : (
							<SessionRow key={row.item.id} item={row.item} best={best} />
						),
					)}
				</div>
			)}
		</div>
	);
}

function QueueRow({ item, snapshot, best }: { item: QueueEntry; snapshot: Snapshot; best: string }) {
	const { t } = useTranslation();
	const progress = snapshot.progress?.id === item.id ? snapshot.progress : null;
	return (
		<MediaRow
			thumbnail={item.thumbnail}
			title={item.title}
			meta={
				<div className="flex min-w-0 flex-col gap-1.5">
					<div className="flex min-w-0 flex-wrap items-center gap-1.5">
						<Badge variant={item.status === "active" ? "default" : "outline"}>{t(`queue.${item.status}`)}</Badge>
						<Badge variant="outline">{describeSelection(item.selection, best)}</Badge>
					</div>
					{progress ? (
						<div className="flex flex-col gap-1">
							<Progress value={progress.percent ?? 0} />
							<p className="flex gap-2 text-xs text-muted-foreground">
								{progress.percent != null ? <span>{progress.percent.toFixed(0)}%</span> : null}
								{progress.speed ? <span>{progress.speed}</span> : null}
								{progress.eta ? <span>{progress.eta}</span> : null}
							</p>
						</div>
					) : null}
				</div>
			}
			actions={
				(item.status === "pending" || item.status === "active") ? (
					<Button
						type="button"
						variant="destructive"
						size="icon"
						className="bg-destructive/10 text-destructive hover:bg-destructive/20"
						aria-label={t(item.status === "active" ? "queue.cancelDownload" : "queue.remove")}
						onClick={() => void cancelItem(item.id).catch((err) => toastError(err, t("queue.errorFailed")))}>
						<XIcon />
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
	return (
		<MediaRow
			thumbnail={item.thumbnail}
			title={item.title}
			meta={
				<div className="flex min-w-0 flex-col gap-1">
					<div className="flex min-w-0 flex-wrap items-center gap-1.5">
						<Badge variant={variant}>{label}</Badge>
						<Badge variant="outline">{describeSelection(item.selection, best)}</Badge>
						{item.status === "success" && item.size_bytes ? <Badge variant="secondary">{formatBytes(item.size_bytes)}</Badge> : null}
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
					) : null
			}
		/>
	);
}

function rowsFor(snapshot: Snapshot, filter: FilterId): Row[] {
	const pending = snapshot.queue.filter((item) => item.status === "pending").map((item) => ({ kind: "queue" as const, item }));
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

function isFilter(value: string | undefined): value is FilterId {
	return filters.some((item) => item === value);
}
