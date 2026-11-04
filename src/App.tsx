import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { BadgeCheckIcon, ClockIcon, DownloadIcon, RefreshCwIcon, SettingsIcon } from "lucide-react";
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
import { archiveSessionAll, checkYtdlpUpdate, updateYtdlp } from "@/lib/api";
import type { AppUpdate } from "@/lib/downly";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/toast";
import { toastError } from "@/lib/errors";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type PageId = "queue" | "history" | "settings";

const pages: { id: PageId; icon: typeof DownloadIcon }[] = [
	{ id: "queue", icon: DownloadIcon },
	{ id: "history", icon: ClockIcon },
	{ id: "settings", icon: SettingsIcon },
];

const sidebarStyle = { "--sidebar-width": "4.5rem" } as CSSProperties;

export default function App() {
	const { t } = useTranslation();
	const { snapshot, ready } = useDownly();
	const [page, setPage] = useState<PageId>("queue");
	const [offers, setOffers] = useState<{ app: Update | null; ytdlp: AppUpdate | null } | null>(null);
	const [updatesOpen, setUpdatesOpen] = useState(false);
	const [appUpdateBusy, setAppUpdateBusy] = useState(false);
	const [appUpdateStage, setAppUpdateStage] = useState<"downloading" | "installing" | null>(null);
	const [appUpdateProgress, setAppUpdateProgress] = useState<number | null>(null);
	const [askClose, setAskClose] = useState(false);
	const [staleCookiesOpen, setStaleCookiesOpen] = useState(false);
	const pageContentRef = useRef<HTMLDivElement>(null);

	const downloading = snapshot.queue.some((item) => item.status === "active") || snapshot.progress != null;
	const hasUpdates = Boolean(offers?.app || offers?.ytdlp);
	useEffect(() => {
		const content = pageContentRef.current;
		if (!content || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const animation = content.animate(
			[{ opacity: 0.82, transform: "translateY(4px)" }, { opacity: 1, transform: "translateY(0)" }],
			{ duration: 180, easing: "ease-out" },
		);
		return () => animation.cancel();
	}, [page]);
	function navigateTo(nextPage: PageId) {
		setPage(nextPage);
	}
	const requestClose = () => {
		if (downloading) {
			setAskClose(true);
			return;
		}
		void getCurrentWindow().close();
	};

	useEffect(() => {
		void Promise.all([check().catch(() => null), checkYtdlpUpdate().catch(() => null)]).then(([app, ytdlp]) => {
			const nextOffers = {
				app,
				ytdlp: ytdlp?.newer ? ytdlp : null,
			};
			setOffers(nextOffers);
			if (nextOffers.app || nextOffers.ytdlp) {
				setUpdatesOpen(true);
			}
		});
	}, []);

	async function installAppUpdate() {
		const update = offers?.app;
		if (!update) {
			return;
		}
		setAppUpdateBusy(true);
		setAppUpdateStage("downloading");
		setAppUpdateProgress(null);
		let downloaded = 0;
		let contentLength: number | undefined;
		try {
			await update.downloadAndInstall((event) => {
				if (event.event === "Started") {
					contentLength = event.data.contentLength;
				} else if (event.event === "Progress") {
					downloaded += event.data.chunkLength;
					if (contentLength) {
						setAppUpdateProgress(Math.min(100, Math.round((downloaded / contentLength) * 100)));
					}
				} else if (event.event === "Finished") {
					setAppUpdateStage("installing");
				}
			});
			await relaunch();
		} catch (err) {
			toastError(err, t("settings.updateFailed"));
			setAppUpdateBusy(false);
			setAppUpdateStage(null);
		}
	}

	useEffect(() => {
		const updatedAt = snapshot.settings.cookies_updated_at;
		if (ready && snapshot.settings.cookies_browser === "manual" && updatedAt != null && Date.now() / 1000 - updatedAt >= 7 * 24 * 60 * 60) {
			setStaleCookiesOpen(true);
		}
	}, [ready, snapshot.settings.cookies_browser, snapshot.settings.cookies_updated_at]);

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
				<TitleBar onClose={requestClose} />
				<SidebarProvider className="min-h-0 flex-1" style={sidebarStyle}>
					<Sidebar collapsible="none" className="border-r border-border">
						<SidebarContent className="pt-2">
							<SidebarGroup className="flex-1 px-2 flex flex-col justify-center">
								<SidebarGroupContent>
									<SidebarMenu className="items-center gap-3">
										{pages.map((item) => (
											<SidebarMenuItem key={item.id}>
												<Tooltip>
													<TooltipTrigger
														render={
															<SidebarMenuButton
																isActive={page === item.id}
																onClick={() => navigateTo(item.id)}
																className="size-12 justify-center p-0 transition-[transform,background-color,color] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] active:scale-[0.98] [&_svg]:size-6 [&_svg]:stroke-[1.4] [&_svg]:transition-colors [&_svg]:duration-200"
																aria-label={t(`nav.${item.id}`)}>
																<item.icon />
																<span className="sr-only">{t(`nav.${item.id}`)}</span>
															</SidebarMenuButton>
														}
													/>
													<TooltipContent side="right" sideOffset={10}>{t(`nav.${item.id}`)}</TooltipContent>
												</Tooltip>
											</SidebarMenuItem>
										))}
									</SidebarMenu>
								</SidebarGroupContent>
							</SidebarGroup>
							<SidebarGroup className="mt-auto px-2 pb-2">
								<SidebarGroupContent>
									<SidebarMenu className="items-center">
										<SidebarMenuItem>
											<Tooltip>
											<TooltipTrigger
												render={
													<SidebarMenuButton
														disabled={!hasUpdates}
														onClick={() => { if (hasUpdates) setUpdatesOpen(true); }}
														className={`size-12 justify-center p-0 transition-[transform,background-color,color] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] active:scale-[0.98] [&_svg]:stroke-[1.4] [&_svg]:transition-colors [&_svg]:duration-200 ${hasUpdates ? "text-primary [&_svg]:size-6" : "text-muted-foreground [&_svg]:size-4"}`}
														title={t(hasUpdates ? "settings.updateTitle" : "settings.upToDate")}
														aria-label={t(hasUpdates ? "settings.updateTitle" : "settings.upToDate")}>
												{hasUpdates ? <RefreshCwIcon /> : <BadgeCheckIcon />}
												<span className="sr-only">
													{t(hasUpdates ? "settings.updateTitle" : "settings.upToDate")}
												</span>
													</SidebarMenuButton>
												}
											/>
											<TooltipContent>{t(hasUpdates ? "settings.updateTitle" : "settings.upToDate")}</TooltipContent>
											</Tooltip>
										</SidebarMenuItem>
									</SidebarMenu>
								</SidebarGroupContent>
							</SidebarGroup>
						</SidebarContent>
					</Sidebar>
					<SidebarInset className="min-h-0 overflow-hidden">
						<ScrollArea className="h-full min-h-0">
							<div ref={pageContentRef} className="flex flex-col gap-4 p-4 pt-6">
								<div className={page === "queue" ? "contents" : "hidden"}>
									<QueuePage snapshot={snapshot} />
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
				<AlertDialog open={staleCookiesOpen} onOpenChange={setStaleCookiesOpen}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>{t("settings.cookiesStaleTitle")}</AlertDialogTitle>
							<AlertDialogDescription>{t("settings.cookiesStaleBody")}</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>{t("settings.notNow")}</AlertDialogCancel>
							<AlertDialogAction onClick={() => { setStaleCookiesOpen(false); setPage("settings"); }}>{t("settings.cookiesOpenSettings")}</AlertDialogAction>
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
										{appUpdateBusy
											? appUpdateStage === "installing"
												? t("settings.updateInstalling")
												: appUpdateProgress == null
													? t("settings.updateDownloading")
													: t("settings.updateProgress", { percent: appUpdateProgress })
										: t("settings.updateFound", { version: offers.app.version })}
									</p>
									<Button
										type="button"
										disabled={appUpdateBusy || downloading}
										onClick={() => void installAppUpdate()}>
										{downloading
											? t("settings.updateWaitForDownloads")
											: appUpdateBusy
												? t("settings.updateInProgress")
												: t("settings.updateApp")}
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
