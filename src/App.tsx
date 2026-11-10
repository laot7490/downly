import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
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
import { archiveSessionAll } from "@/lib/api";
import { useTools } from "@/hooks/use-tools";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Toaster } from "@/components/ui/toast";
import { toastError } from "@/lib/errors";

type PageId = "queue" | "history" | "settings";

export default function App() {
	const { t } = useTranslation();
	const { snapshot, ready } = useDownly();
	const tools = useTools();
	const [page, setPage] = useState<PageId>("queue");
	const [appOffer, setAppOffer] = useState<Update | null>(null);
	const [updatesOpen, setUpdatesOpen] = useState(false);
	const [appUpdateBusy, setAppUpdateBusy] = useState(false);
	const [appUpdateStage, setAppUpdateStage] = useState<"downloading" | "installing" | null>(null);
	const [appUpdateProgress, setAppUpdateProgress] = useState<number | null>(null);
	const [askClose, setAskClose] = useState(false);
	const [staleCookiesOpen, setStaleCookiesOpen] = useState(false);
	const pageContentRef = useRef<HTMLDivElement>(null);

	const downloading = snapshot.queue.some((item) => item.status === "active") || snapshot.progress != null;
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
		if (!tools.ready) return;
		if (downloading) {
			setAskClose(true);
			return;
		}
		void getCurrentWindow().close();
	};

	useEffect(() => {
		if (!tools.ready) return;
		void check().then((update) => {
			setAppOffer(update);
			if (update) setUpdatesOpen(true);
		}).catch(() => undefined);
	}, [tools.ready]);

	useEffect(() => {
		if (tools.updateDialogOpen) setUpdatesOpen(true);
	}, [tools.updateDialogOpen]);

	async function installAppUpdate() {
		const update = appOffer;
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
				if (!tools.ready) {
					event.preventDefault();
					return;
				}
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
	}, [downloading, tools.ready]);

	return (
		<Toaster>
			<div className="flex h-svh flex-col bg-background">
				<TitleBar
					page={page}
					onNavigate={navigateTo}
					onClose={requestClose}
				/>
				<Dialog open={!tools.ready && (tools.progress != null || tools.installError != null)} onOpenChange={() => {}}>
					<DialogContent showCloseButton={false}>
						<DialogHeader>
							<DialogTitle>{t("tools.installTitle")}</DialogTitle>
							<DialogDescription>{t("tools.installBody")}</DialogDescription>
						</DialogHeader>
						<div className="flex flex-col gap-3">
							<p className="text-sm font-medium">
								{tools.installError ? t("tools.installFailed") : tools.progress?.tool ? t(`tools.${tools.progress.phase}`, { tool: t(`tools.names.${tools.progress.tool}`, tools.progress.tool) }) : t("tools.checking")}
							</p>
							{!tools.installError ? <Progress value={tools.progress?.total ? Math.min(100, Math.round((tools.progress.received / tools.progress.total) * 100)) : null} /> : null}
							{tools.installError ? <p role="alert" className="break-words text-sm text-destructive">{tools.installError}</p> : null}
						</div>
						{tools.installError ? <DialogFooter>
							<Button type="button" variant="outline" onClick={() => void getCurrentWindow().destroy()}>{t("tools.quit")}</Button>
							<Button type="button" onClick={tools.retryInstall}>{t("tools.retry")}</Button>
						</DialogFooter> : null}
					</DialogContent>
				</Dialog>
				<main className="min-h-0 flex-1 overflow-hidden">
					<ScrollArea className="h-full min-h-0">
						<div ref={pageContentRef} className="flex flex-col gap-4 px-6 py-6 sm:px-8 sm:py-7">
							<div className={page === "queue" ? "contents" : "hidden"}>
								<QueuePage snapshot={snapshot} />
							</div>
							{page === "history" ? <HistoryPage snapshot={snapshot} /> : null}
							{page === "settings" ? <SettingsPage snapshot={snapshot} tools={tools} /> : null}
						</div>
					</ScrollArea>
				</main>
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
							tools.dismissUpdateDialog();
						}
					}}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>{t("settings.updateTitle")}</DialogTitle>
						</DialogHeader>
						<div className="flex flex-col gap-3">
							{appOffer ? (
								<div className="flex items-center justify-between gap-3">
									<p className="text-sm text-foreground">
										{appUpdateBusy
											? appUpdateStage === "installing"
												? t("settings.updateInstalling")
												: appUpdateProgress == null
													? t("settings.updateDownloading")
													: t("settings.updateProgress", { percent: appUpdateProgress })
										: t("settings.updateFound", { version: appOffer.version })}
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
							{tools.status?.update_available ? (
								<div className="flex items-center justify-between gap-3">
									<div className="min-w-0">
										<p className="text-sm font-medium text-foreground">{t("settings.thirdPartyTools")}</p>
										{tools.updating ? <p className="mt-1 text-sm text-muted-foreground">{tools.progress?.tool ? t(`tools.${tools.progress.phase}`, { tool: t(`tools.names.${tools.progress.tool}`, tools.progress.tool) }) : t("tools.updating")}</p> : <p className="mt-1 text-sm text-muted-foreground">{t("tools.updateAvailable")}</p>}
									</div>
									<Button type="button" disabled={downloading || tools.updating} onClick={() => {
										void tools.updateAll().then(() => {
											if (!appOffer) setUpdatesOpen(false);
										}).catch((error: unknown) => toastError(error, t("settings.updateFailed")));
									}}>
										{tools.updating ? <Spinner data-icon="inline-start" /> : null}
										{downloading ? t("settings.updateWaitForDownloads") : tools.updating ? t("settings.updateInProgress") : t("settings.updateAction")}
									</Button>
								</div>
							) : null}
						</div>
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => {
								setUpdatesOpen(false);
								tools.dismissUpdateDialog();
							}}>
								{t("settings.notNow")}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>
		</Toaster>
	);
}
