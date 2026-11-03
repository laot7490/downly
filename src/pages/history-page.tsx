import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon, EllipsisVerticalIcon, FolderIcon, LinkIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { BrandMark } from "@/components/downly/brand-mark";
import { MediaRow } from "@/components/downly/media-row";
import { PageShell } from "@/components/downly/page-shell";
import { clearHistory, removeHistory, revealPath } from "@/lib/api";
import { formatBytes } from "@/lib/downly";
import { describeSelection } from "@/lib/quality-options";
import type { HistoryItem, Snapshot } from "@/lib/downly";

type Props = {
	snapshot: Snapshot;
};

type DayGroup = {
	key: string;
	label: string;
	items: HistoryItem[];
};

function startOfDay(date: Date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayKey(seconds: number) {
	const date = new Date(seconds * 1000);
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

export function HistoryPage({ snapshot }: Props) {
	const { t, i18n } = useTranslation();
	const [askClear, setAskClear] = useState(false);
	const [openDays, setOpenDays] = useState<Record<string, boolean>>({});
	const best = t("queue.best");
	const items = snapshot.history.filter((item) => item.status === "success").sort((a, b) => b.finished_at - a.finished_at);
	const groups = groupDays(items, t, i18n.language);

	return (
		<PageShell>
			<div className="flex items-center justify-between gap-3">
				<div className="flex flex-col gap-1">
					<h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("history.title")}</h1>
					<p className="text-sm text-muted-foreground">{t("history.sub")}</p>
				</div>
				{items.length > 0 ? (
					<Button type="button" variant="outline" onClick={() => setAskClear(true)}>
						<Trash2Icon data-icon="inline-start" />
						{t("history.clear")}
					</Button>
				) : null}
			</div>
			{items.length === 0 ? (
				<Empty className="flex-none border border-dashed border-border">
					<EmptyHeader>
						<EmptyMedia>
							<BrandMark className="size-8 opacity-40" />
						</EmptyMedia>
						<EmptyTitle>{t("history.emptyTitle")}</EmptyTitle>
						<EmptyDescription>{t("history.empty")}</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<ScrollArea className="max-h-[calc(100svh-11rem)]">
					<div className="flex flex-col pr-3">
						{groups.map((group, index) => {
							const open = openDays[group.key] ?? index < 3;
							return (
								<Collapsible
									key={group.key}
									open={open}
									onOpenChange={(next) => setOpenDays((current) => ({ ...current, [group.key]: next }))}>
									<CollapsibleTrigger className="flex w-full items-center gap-2 py-2 text-left text-sm font-medium text-foreground">
										<ChevronDownIcon
											className={open ? "transition-transform" : "-rotate-90 transition-transform"}
										/>
										<span className="min-w-0 flex-1 truncate">{group.label}</span>
										<Badge variant="secondary">{group.items.length}</Badge>
									</CollapsibleTrigger>
									<CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-all duration-200 data-[ending-style]:h-0 data-[starting-style]:h-0">
										{group.items.map((item) => (
											<MediaRow
												key={item.id}
												thumbnail={item.thumbnail}
												title={item.title}
												meta={
													<div className="flex min-w-0 flex-col gap-1">
														<div className="flex min-w-0 flex-wrap items-center gap-1.5">
															<Badge variant="outline">{describeSelection(item.selection, best)}</Badge>
															{item.size_bytes ? <Badge variant="secondary">{formatBytes(item.size_bytes)}</Badge> : null}
														</div>
													</div>
												}
												actions={
													<>
														<Button
															type="button"
															size="icon"
															variant="outline"
															aria-label={t("history.reveal")}
															disabled={!item.path}
															onClick={() => item.path && void revealPath(item.path)}>
															<FolderIcon />
														</Button>
														<DropdownMenu>
															<DropdownMenuTrigger
																render={
																	<Button
																		type="button"
															variant="outline"
																		size="icon-sm"
																		aria-label={t("history.more")}
																	/>
																}>
															<EllipsisVerticalIcon />
															</DropdownMenuTrigger>
															<DropdownMenuContent align="end" className="min-w-52">
																<DropdownMenuGroup>
																	<DropdownMenuItem
																		onClick={() => void navigator.clipboard.writeText(item.url)}>
																		<LinkIcon />
																		{t("history.copy")}
																	</DropdownMenuItem>
																	<DropdownMenuItem
																		variant="destructive"
																		onClick={() => void removeHistory(item.id)}>
																		<Trash2Icon />
																		{t("history.remove")}
																	</DropdownMenuItem>
																</DropdownMenuGroup>
															</DropdownMenuContent>
														</DropdownMenu>
													</>
												}
											/>
										))}
									</CollapsibleContent>
								</Collapsible>
							);
						})}
					</div>
				</ScrollArea>
			)}
			<AlertDialog open={askClear} onOpenChange={setAskClear}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("history.clearTitle")}</AlertDialogTitle>
						<AlertDialogDescription>{t("history.clearBody")}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("history.clearCancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								void clearHistory();
								setAskClear(false);
							}}>
							{t("history.clearConfirm")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</PageShell>
	);
}

function groupDays(items: HistoryItem[], t: (key: string) => string, language: string): DayGroup[] {
	const groups: DayGroup[] = [];
	const today = startOfDay(new Date());
	const formatter = new Intl.DateTimeFormat(language === "tr" ? "tr" : "en", {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
	for (const item of items) {
		const key = dayKey(item.finished_at);
		const last = groups[groups.length - 1];
		if (last?.key === key) {
			last.items.push(item);
			continue;
		}
		const date = new Date(item.finished_at * 1000);
		const diff = Math.round((today - startOfDay(date)) / 86_400_000);
		const label = diff === 0 ? t("history.today") : diff === 1 ? t("history.yesterday") : formatter.format(date);
		groups.push({ key, label, items: [item] });
	}
	return groups;
}
