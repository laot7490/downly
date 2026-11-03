import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import { CheckIcon, CircleHelpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldTitle } from "@/components/ui/field";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { DownloadFolderField } from "@/components/downly/download-folder-field";
import { PageShell } from "@/components/downly/page-shell";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Spinner } from "@/components/ui/spinner";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/components/ui/toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { chooseLanguage, type Language } from "@/i18n";
import { useTheme, type ThemeChoice } from "@/theme";
import { appVersion, checkYtdlpUpdate, importCookiesFile, setCookiesBrowser, updateYtdlp, ytdlpInfo } from "@/lib/api";
import { toastError } from "@/lib/errors";
import type { AppUpdate, CookiesBrowser, Snapshot } from "@/lib/downly";

const languages: Language[] = ["en", "tr"];
const themes: ThemeChoice[] = ["system", "light", "dark"];

type Props = {
	snapshot: Snapshot;
};

export function SettingsPage({ snapshot }: Props) {
	const { t, i18n } = useTranslation();
	const { theme, chooseTheme } = useTheme();
	const language: Language = i18n.resolvedLanguage === "tr" ? "tr" : "en";
	const [version, setVersion] = useState("");
	const [ytdlp, setYtdlp] = useState("");
	const [appUpdate, setAppUpdate] = useState<Update | null>(null);
	const [ytdlpUpdate, setYtdlpUpdate] = useState<AppUpdate | null>(null);
	const [loading, setLoading] = useState(true);
	const [appBusy, setAppBusy] = useState(false);
	const [appUpdateInstalling, setAppUpdateInstalling] = useState(false);
	const [appUpdateProgress, setAppUpdateProgress] = useState<number | null>(null);
	const [ytdlpBusy, setYtdlpBusy] = useState(false);
	const [cookiesBusy, setCookiesBusy] = useState(false);
	const [cookieDialogOpen, setCookieDialogOpen] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		void Promise.all([
			appVersion().catch(() => ""),
			ytdlpInfo().catch(() => null),
			check().catch(() => null),
			checkYtdlpUpdate().catch(() => null),
		]).then(([appVer, info, app, ytdlpCheck]) => {
			if (cancelled) {
				return;
			}
			setVersion(appVer);
			setYtdlp(info?.version ?? "");
			setAppUpdate(app);
			setYtdlpUpdate(ytdlpCheck);
			setLoading(false);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const appNewer = Boolean(appUpdate);
	const ytdlpNewer = Boolean(ytdlpUpdate?.newer);
	const downloadRunning = snapshot.queue.some((item) => item.status === "active") || snapshot.progress != null;
	const cookiesBrowsers = ["disabled", "firefox", "manual"] as const;
	const cookiesBrowserItems = cookiesBrowsers.map((browser) => ({
		value: browser,
		label: t(`settings.cookiesBrowsers.${browser}`),
	}));

	async function chooseCookiesFile() {
		const picked = await open({
			multiple: false,
			filters: [{ name: "Netscape cookies.txt", extensions: ["txt"] }],
			title: t("settings.cookiesManualTitle"),
		});
		if (typeof picked !== "string") {
			return;
		}
		setCookiesBusy(true);
		try {
			await importCookiesFile(picked);
			setCookieDialogOpen(false);
		} catch (err) {
			toastError(err, t("settings.cookiesBrowserFailed"));
		} finally {
			setCookiesBusy(false);
		}
	}

	async function installAppUpdate() {
		if (!appUpdate) {
			return;
		}
		setAppBusy(true);
		setAppUpdateInstalling(false);
		setAppUpdateProgress(null);
		let downloaded = 0;
		let contentLength: number | undefined;
		try {
			await appUpdate.downloadAndInstall((event) => {
				if (event.event === "Started") {
					contentLength = event.data.contentLength;
				} else if (event.event === "Progress") {
					downloaded += event.data.chunkLength;
					if (contentLength) {
						setAppUpdateProgress(Math.min(100, Math.round((downloaded / contentLength) * 100)));
					}
				} else if (event.event === "Finished") {
					setAppUpdateInstalling(true);
				}
			});
			await relaunch();
		} catch (err) {
			toastError(err, t("settings.updateFailed"));
			setAppBusy(false);
			setAppUpdateInstalling(false);
		}
	}

	return (
		<PageShell>
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("settings.title")}</h1>
				<p className="text-sm text-muted-foreground">{t("settings.sub")}</p>
			</div>
			<FieldGroup>
				<Field>
					<FieldTitle id="language-label">{t("settings.language")}</FieldTitle>
					<ToggleGroup
						aria-labelledby="language-label"
						variant="outline"
						spacing={2}
						value={[language]}
						onValueChange={(value) => {
							const next = value[0];
							if (next === "en" || next === "tr") {
								chooseLanguage(next);
							}
						}}>
						{languages.map((item) => (
							<ToggleGroupItem key={item} value={item}>
								{t(`settings.languages.${item}`)}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</Field>
				<Field>
					<FieldTitle id="theme-label">{t("settings.theme")}</FieldTitle>
					<ToggleGroup
						aria-labelledby="theme-label"
						variant="outline"
						spacing={2}
						value={[theme]}
						onValueChange={(value) => {
							const next = value[0];
							if (next === "system" || next === "light" || next === "dark") {
								chooseTheme(next);
							}
						}}>
						{themes.map((item) => (
							<ToggleGroupItem key={item} value={item}>
								{t(`settings.themes.${item}`)}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</Field>
				<DownloadFolderField path={snapshot.settings.download_dir} />
				<Field>
					<FieldTitle id="cookies-browser-label">
						{t("settings.cookiesBrowser")}
						<Tooltip>
							<TooltipTrigger render={<button type="button" aria-label={t("settings.cookiesBrowserInfo")} className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full" />}>
								<CircleHelpIcon className="size-3.5" aria-hidden="true" />
							</TooltipTrigger>
							<TooltipContent>{t("settings.cookiesBrowserTooltip")}</TooltipContent>
						</Tooltip>
					</FieldTitle>
					<Select
						items={cookiesBrowserItems}
						value={snapshot.settings.cookies_browser}
						disabled={cookiesBusy}
						onValueChange={(value) => {
							if (value === "manual") {
								setCookieDialogOpen(true);
							} else if (value === "disabled" || value === "firefox") {
								setCookiesBusy(true);
								void setCookiesBrowser(value as CookiesBrowser)
									.catch((err) => toastError(err, t("settings.cookiesBrowserFailed")))
									.finally(() => setCookiesBusy(false));
							}
						}}>
						<SelectTrigger aria-labelledby="cookies-browser-label" className="w-full sm:w-64">
							{cookiesBusy ? <Spinner data-icon="inline-start" /> : null}
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{cookiesBrowsers.map((browser) => (
									<SelectItem key={browser} value={browser}>{t(`settings.cookiesBrowsers.${browser}`)}</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
					{snapshot.settings.cookies_browser === "manual" ? (
						<p className="text-xs text-muted-foreground">
							{t("settings.cookiesUpdated", { date: snapshot.settings.cookies_updated_at ? new Date(snapshot.settings.cookies_updated_at * 1000).toLocaleDateString() : "" })}
							<Button type="button" variant="link" size="sm" className="h-auto px-1" disabled={cookiesBusy} onClick={() => setCookieDialogOpen(true)}>{t("settings.cookiesReplace")}</Button>
						</p>
					) : null}
				</Field>
			</FieldGroup>
			<Dialog open={cookieDialogOpen} onOpenChange={setCookieDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("settings.cookiesManualTitle")}</DialogTitle>
						<DialogDescription>{t("settings.cookiesManualBody")}</DialogDescription>
					</DialogHeader>
					<a className="text-sm text-primary underline underline-offset-4" href="https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc" onClick={(event) => { event.preventDefault(); void openUrl("https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc"); }}>{t("settings.cookiesExtension")}</a>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => setCookieDialogOpen(false)}>{t("settings.notNow")}</Button>
						<Button type="button" disabled={cookiesBusy} onClick={() => void chooseCookiesFile()}>{t("settings.cookiesChooseFile")}</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<div className="grid items-start gap-4 sm:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>{t("settings.appVersion")}</CardTitle>
						<CardDescription>{version || "—"}</CardDescription>
					</CardHeader>
					<CardFooter>
						<Button
							type="button"
							variant="outline"
							disabled={loading || appBusy || !appNewer || downloadRunning}
							onClick={() => void installAppUpdate()}>
							{loading || appBusy ? (
								<Spinner data-icon="inline-start" />
							) : appNewer ? null : (
								<CheckIcon data-icon="inline-start" />
							)}
							{downloadRunning
								? t("settings.updateWaitForDownloads")
								: appBusy
								? appUpdateInstalling
									? t("settings.updateInstalling")
									: appUpdateProgress == null
										? t("settings.updateDownloading")
										: t("settings.updateProgress", { percent: appUpdateProgress })
								: appNewer
									? t("settings.updateAction")
									: t("settings.upToDate")}
						</Button>
					</CardFooter>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>{t("settings.ytdlp")}</CardTitle>
					<CardDescription>{ytdlp || t("settings.ytdlpUnknown")}</CardDescription>
					</CardHeader>
					<CardFooter>
						<Button
							type="button"
							variant="outline"
							disabled={loading || ytdlpBusy || !ytdlpNewer}
							onClick={() => {
								setYtdlpBusy(true);
								void updateYtdlp()
									.then(async (next) => {
										setYtdlp(next);
										const info = await ytdlpInfo().catch(() => null);
										if (info) {
											setYtdlp(info.version);
										}
										const check = await checkYtdlpUpdate().catch(() => null);
										setYtdlpUpdate(check);
										toast.add({
											title: t("settings.ytdlpUpdated", { version: info?.version || next }),
											type: "success",
										});
									})
									.catch((err) => {
										toastError(err, t("settings.ytdlpUpdateFailed"));
									})
									.finally(() => setYtdlpBusy(false));
							}}>
							{loading || ytdlpBusy ? (
								<Spinner data-icon="inline-start" />
							) : ytdlpNewer ? null : (
								<CheckIcon data-icon="inline-start" />
							)}
							{ytdlpNewer ? t("settings.updateAction") : t("settings.upToDate")}
						</Button>
					</CardFooter>
				</Card>
			</div>
			<p className="pt-4 text-center text-sm text-muted-foreground">
				made with <span className="text-red-500">❤️</span> laot
			</p>
		</PageShell>
	);
}
