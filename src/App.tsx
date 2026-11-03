import { useEffect, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CheckIcon, ClockIcon, DownloadIcon, RefreshCwIcon, SettingsIcon } from "lucide-react";
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
} from "@/components/ui/sidebar";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { TitleBar } from "@/components/title-bar";
import { HistoryPage } from "@/pages/history-page";
import { QueuePage } from "@/pages/queue-page";
import { SettingsPage } from "@/pages/settings-page";
import { useDownly } from "@/hooks/use-downly";
import { archiveSessionAll, checkAppUpdate, checkYtdlpUpdate, updateYtdlp } from "@/lib/api";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { AppUpdate } from "@/lib/downly";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/toast";
import { toastError } from "@/lib/errors";

type PageId = "queue" | "history" | "settings";

const pages: { id: PageId; icon: typeof DownloadIcon }[] = [
	{ id: "queue", icon: DownloadIcon },
	{ id: "history", icon: ClockIcon },
	{ id: "settings", icon: SettingsIcon },
];

const sidebarStyle = { "--sidebar-width": "4.5rem" } as CSSProperties;

export default function App() {
	const { t } = useTranslation();
	const { snapshot } = useDownly();
	const [page, setPage] = useState<PageId>("queue");
	const [update, setUpdate] = useState<AppUpdate | null>(null);
	const [offers, setOffers] = useState<{ app: AppUpdate | null; ytdlp: AppUpdate | null } | null>(null);
	const [updatesOpen, setUpdatesOpen] = useState(false);
	const [askClose, setAskClose] = useState(false);

	const downloading = snapshot.queue.some((item) => item.status === "active") || snapshot.progress != null;
	const hasUpdates = Boolean(offers?.app || offers?.ytdlp);

	useEffect(() => {
		void Promise.all([checkAppUpdate().catch(() => null), checkYtdlpUpdate().catch(() => null)]).then(([app, ytdlp]) => {
			if (app?.newer) {
				setUpdate(app);
			}
			setOffers({
				app: app?.newer ? app : null,
				ytdlp: ytdlp?.newer ? ytdlp : null,
			});
		});
	}, []);

	useEffect(() => {
		const window = getCurrentWindow();
		let unlisten: (() => void) | undefined;
		void window
			.onCloseRequested((event) => {
				if (downloading) {
					event.preventDefault();
					setAskClose(true);
				}
			})
			.then((fn) => {
				unlisten = fn;
			});
		return () => {
			unlisten?.();
		};
	}, [downloading]);

	return (
		<Toaster>
			<div className="flex h-svh flex-col bg-background">
				<TitleBar />
				<SidebarProvider className="min-h-0 flex-1" style={sidebarStyle}>
					<Sidebar collapsible="none" className="border-r border-border">
						<SidebarContent className="pt-2">
							<SidebarGroup className="flex-1 px-2 flex flex-col justify-center">
								<SidebarGroupContent>
									<SidebarMenu className="items-center gap-3">
										{pages.map((item) => (
											<SidebarMenuItem key={item.id}>
												<SidebarMenuButton
													isActive={page === item.id}
													onClick={() => setPage(item.id)}
													className="size-12 justify-center p-0 [&_svg]:size-6"
													title={t(`nav.${item.id}`)}
													aria-label={t(`nav.${item.id}`)}>
													<item.icon />
													<span className="sr-only">{t(`nav.${item.id}`)}</span>
												</SidebarMenuButton>
											</SidebarMenuItem>
										))}
									</SidebarMenu>
								</SidebarGroupContent>
							</SidebarGroup>
							<SidebarGroup className="mt-auto px-2 pb-2">
								<SidebarGroupContent>
									<SidebarMenu className="items-center">
										<SidebarMenuItem>
											<SidebarMenuButton
												disabled={!hasUpdates}
												onClick={() => setUpdatesOpen(true)}
												className="size-12 justify-center p-0 text-primary [&_svg]:size-6"
												title={t(hasUpdates ? "settings.updateTitle" : "settings.upToDate")}
												aria-label={t(hasUpdates ? "settings.updateTitle" : "settings.upToDate")}>
												{hasUpdates ? <RefreshCwIcon /> : <CheckIcon />}
												<span className="sr-only">
													{t(hasUpdates ? "settings.updateTitle" : "settings.upToDate")}
												</span>
											</SidebarMenuButton>
										</SidebarMenuItem>
									</SidebarMenu>
								</SidebarGroupContent>
							</SidebarGroup>
						</SidebarContent>
					</Sidebar>
					<SidebarInset className="min-h-0 overflow-hidden">
						<ScrollArea className="h-full min-h-0">
							<div className="flex flex-col gap-4 p-4 pt-6">
								<div className={page === "queue" ? "contents" : "hidden"}>
									<QueuePage snapshot={snapshot} update={update} />
								</div>
								{page === "history" ? <HistoryPage snapshot={snapshot} /> : null}
								{page === "settings" ? <SettingsPage snapshot={snapshot} /> : null}
							</div>
						</ScrollArea>
					</SidebarInset>
				</SidebarProvider>
				<AlertDialog open={askClose} onOpenChange={setAskClose}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>{t("close.title")}</AlertDialogTitle>
							<AlertDialogDescription>{t("close.body")}</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>{t("close.stay")}</AlertDialogCancel>
							<AlertDialogAction
								onClick={() => {
									void archiveSessionAll()
										.catch((err) => {
											toastError(err, t("close.archiveFailed"));
										})
										.finally(() => {
											void getCurrentWindow().destroy();
										});
								}}>
								{t("close.quit")}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
				<Dialog
					open={updatesOpen}
					onOpenChange={(open) => {
						if (!open) {
							setUpdatesOpen(false);
						}
					}}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>{t("settings.updateTitle")}</DialogTitle>
						</DialogHeader>
						<div className="flex flex-col gap-3">
							{offers?.app ? (
								<div className="flex items-center justify-between gap-3">
									<p className="text-sm text-foreground">
										{t("settings.updateFound", { version: offers.app.version })}
									</p>
									<Button
										type="button"
										disabled={!offers.app.url}
										onClick={() => {
											if (offers.app?.url) {
												void openUrl(offers.app.url);
											}
										}}>
										{t("settings.updateApp")}
									</Button>
								</div>
							) : null}
							{offers?.ytdlp ? (
								<div className="flex items-center justify-between gap-3">
									<p className="text-sm text-foreground">
										{t("settings.ytdlpFound", { version: offers.ytdlp.version })}
									</p>
									<Button
										type="button"
										onClick={() => {
											void updateYtdlp().finally(() => {
												setOffers((current) => {
													if (!current) {
														return current;
													}
													return current.app ? { ...current, ytdlp: null } : null;
												});
											});
										}}>
										{t("settings.updateYtdlp")}
									</Button>
								</div>
							) : null}
						</div>
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => setUpdatesOpen(false)}>
								{t("settings.notNow")}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>
		</Toaster>
	);
}
