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
import { archiveSessionAll, checkYtdlpUpdate, updateYtdlp } from "@/lib/api";
import type { AppUpdate } from "@/lib/downly";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/toast";
import { toastError } from "@/lib/errors";

type PageId = "queue" | "history" | "settings";

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
				<TitleBar
					page={page}
					onNavigate={navigateTo}
					onClose={requestClose}
				/>
				<main className="min-h-0 flex-1 overflow-hidden">
					<ScrollArea className="h-full min-h-0">
						<div ref={pageContentRef} className="flex flex-col gap-4 px-6 py-6 sm:px-8 sm:py-7">
							<div className={page === "queue" ? "contents" : "hidden"}>
								<QueuePage snapshot={snapshot} />
							</div>
							{page === "history" ? <HistoryPage snapshot={snapshot} /> : null}
							{page === "settings" ? <SettingsPage snapshot={snapshot} /> : null}
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
