import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import { CircleHelpIcon, FileIcon, GlobeIcon, PaletteIcon, CookieIcon, DownloadIcon, GaugeIcon, MonitorIcon, SunIcon, MoonIcon, CheckIcon, CircleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldTitle } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
import { appVersion, checkYtdlpUpdate, importCookiesFile, setCookiesBrowser, setDownloadSpeedLimit, updateYtdlp, ytdlpInfo } from "@/lib/api";
import { toastError } from "@/lib/errors";
import type { AppUpdate, CookiesBrowser, Snapshot } from "@/lib/downly";

const languages: Language[] = ["en", "tr"];
const themes: ThemeChoice[] = ["system", "light", "dark"];
const themeIcons = { system: MonitorIcon, light: SunIcon, dark: MoonIcon, CheckIcon, CircleAlertIcon };

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
	const [appCheckFailed, setAppCheckFailed] = useState(false);
	const [ytdlpCheckFailed, setYtdlpCheckFailed] = useState(false);
	const [appBusy, setAppBusy] = useState(false);
	const [appUpdateInstalling, setAppUpdateInstalling] = useState(false);
	const [appUpdateProgress, setAppUpdateProgress] = useState<number | null>(null);
	const [ytdlpBusy, setYtdlpBusy] = useState(false);
	const [cookiesBusy, setCookiesBusy] = useState(false);
	const [cookieDialogOpen, setCookieDialogOpen] = useState(false);
	const [speedUnit, setSpeedUnit] = useState<"mbps" | "mbit">("mbps");
	const [speedInput, setSpeedInput] = useState("");
	const [speedError, setSpeedError] = useState(false);
	const speedLimitBytesPerSecond = snapshot.settings.download_speed_limit_bytes_per_second;
	const [speedLimitEnabled, setSpeedLimitEnabled] = useState(speedLimitBytesPerSecond != null);
	useEffect(() => {
		setSpeedLimitEnabled(speedLimitBytesPerSecond != null);
		if (speedLimitBytesPerSecond == null) setSpeedInput("");
		else setSpeedInput(String(Number((speedLimitBytesPerSecond / (speedUnit === "mbps" ? 1_000_000 : 125_000)).toFixed(3))));
	}, [speedLimitBytesPerSecond]);

	function changeSpeedUnit(unit: "mbps" | "mbit") {
		if (unit === speedUnit) return;
		const parsed = Number(speedInput.replace(",", "."));
		if (Number.isFinite(parsed) && parsed > 0) {
			const bytesPerSecond = parsed * (speedUnit === "mbps" ? 1_000_000 : 125_000);
			setSpeedInput(String(Number((bytesPerSecond / (unit === "mbps" ? 1_000_000 : 125_000)).toFixed(3))));
		}
		setSpeedUnit(unit);
	}

	async function saveSpeedLimit() {
		const parsed = Number(speedInput.trim().replace(",", "."));
		if (!speedInput.trim() || !Number.isFinite(parsed) || parsed <= 0) {
			setSpeedError(true);
			return;
		}
		const bytesPerSecond = Math.round(parsed * (speedUnit === "mbps" ? 1_000_000 : 125_000));
		if (!Number.isSafeInteger(bytesPerSecond) || bytesPerSecond < 1) {
			setSpeedError(true);
			return;
		}
		setSpeedError(false);
		try { await setDownloadSpeedLimit(bytesPerSecond); }
		catch (err) { toastError(err, t("settings.speedLimitFailed")); }
	}

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		void Promise.all([
			appVersion().catch(() => ""),
			ytdlpInfo().catch(() => null),
			check().then((update) => ({ update, failed: false }), () => ({ update: null, failed: true })),
			checkYtdlpUpdate().then((update) => ({ update, failed: false }), () => ({ update: null, failed: true })),
		]).then(([appVer, info, app, ytdlpCheck]) => {
			if (cancelled) {
				return;
			}
			setVersion(appVer);
			setYtdlp(info?.version ?? "");
			setAppUpdate(app.update);
			setYtdlpUpdate(ytdlpCheck.update);
			setAppCheckFailed(app.failed);
			setYtdlpCheckFailed(ytdlpCheck.failed);
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
			<header className="flex flex-col gap-1 pb-1">
				<h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("settings.title")}</h1>
				<p className="text-sm text-muted-foreground">{t("settings.sub")}</p>
			</header>
			<section aria-labelledby="preferences-heading">
				<h2 id="preferences-heading" className="mb-2 text-xs font-medium text-muted-foreground">{t("settings.preferences")}</h2>
				<div className="divide-y divide-border/60 rounded-xl border border-border/70 bg-card px-4">
					<Field orientation="horizontal" className="flex-col items-start justify-between gap-3 py-3 sm:flex-row sm:items-center">
						<FieldTitle id="language-label"><GlobeIcon className="size-4 text-muted-foreground" />{t("settings.language")}</FieldTitle>
						<ToggleGroup className="rounded-lg bg-muted/60 p-1" aria-labelledby="language-label" size="sm" spacing={1} value={[language]} onValueChange={(value) => {
							const next = value[0];
							if (next === "en" || next === "tr") chooseLanguage(next);
						}}>
							{languages.map((item) => <ToggleGroupItem key={item} value={item} className="aria-pressed:bg-background aria-pressed:shadow-xs">{t(`settings.languages.${item}`)}</ToggleGroupItem>)}
						</ToggleGroup>
					</Field>
					<Field orientation="horizontal" className="flex-col items-start justify-between gap-3 py-3 sm:flex-row sm:items-center">
						<FieldTitle id="theme-label"><PaletteIcon className="size-4 text-muted-foreground" />{t("settings.theme")}</FieldTitle>
						<ToggleGroup className="rounded-lg bg-muted/60 p-1" aria-labelledby="theme-label" size="sm" spacing={1} value={[theme]} onValueChange={(value) => {
							const next = value[0];
							if (next === "system" || next === "light" || next === "dark") chooseTheme(next);
						}}>
							{themes.map((item) => {
								const Icon = themeIcons[item];
								return <ToggleGroupItem key={item} value={item} className="gap-1.5 aria-pressed:bg-background aria-pressed:shadow-xs"><Icon className="size-3.5" aria-hidden="true" />{t(`settings.themes.${item}`)}</ToggleGroupItem>;
							})}
						</ToggleGroup>
					</Field>
				</div>
			</section>
			<section aria-labelledby="downloads-heading">
				<h2 id="downloads-heading" className="mb-2 text-xs font-medium text-muted-foreground">{t("settings.downloads")}</h2>
				<div className="divide-y divide-border/60 rounded-xl border border-border/70 bg-card px-4">
					<DownloadFolderField path={snapshot.settings.download_dir} />
					<Field className="py-3">
						<div className="flex items-center justify-between gap-4">
							<span id="speed-limit-label" className="flex min-w-0 items-center gap-2 text-sm font-medium">
								<GaugeIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
								{t("settings.speedLimit")}
							</span>
							<Checkbox className="size-5 after:inset-0" id="speed-limit-enabled" aria-labelledby="speed-limit-label" checked={speedLimitEnabled} onCheckedChange={(checked) => {
								setSpeedLimitEnabled(checked === true);
								if (checked === true) { setSpeedInput(""); setSpeedError(false); }
								else {
									setSpeedError(false);
									void setDownloadSpeedLimit(null).catch((err) => {
										setSpeedLimitEnabled(speedLimitBytesPerSecond != null);
										toastError(err, t("settings.speedLimitFailed"));
									});
								}
							}} />
						</div>
						<p className="pl-6 text-xs text-muted-foreground">{t("settings.speedLimitNote")}</p>
						{speedLimitEnabled ? <div className="flex w-full max-w-sm items-start gap-2 pl-6">
							<div className="flex-1">
								<Input className="!h-9" aria-label={t("settings.speedLimitValue")} placeholder={t(speedUnit === "mbps" ? "settings.speedLimitPlaceholderMb" : "settings.speedLimitPlaceholderMbps")} inputMode="decimal" value={speedInput} aria-invalid={speedError} onChange={(event) => { setSpeedInput(event.target.value); setSpeedError(false); }} onBlur={() => { if (speedInput.trim()) void saveSpeedLimit(); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveSpeedLimit(); } }} />
								{speedError ? <p className="mt-1 text-xs text-destructive">{t("settings.speedLimitInvalid")}</p> : null}
							</div>
							<Select items={[{ value: "mbps", label: "MB/s" }, { value: "mbit", label: "Mbps" }]} value={speedUnit} onValueChange={(value) => { if (value === "mbps" || value === "mbit") changeSpeedUnit(value); }}>
								<SelectTrigger aria-label={t("settings.speedLimitUnit")} className="!h-9 w-28"><SelectValue /></SelectTrigger>
								<SelectContent><SelectGroup><SelectItem value="mbps">MB/s</SelectItem><SelectItem value="mbit">Mbps</SelectItem></SelectGroup></SelectContent>
							</Select>
						</div> : null}
					</Field>
					<Field orientation="horizontal" className="flex-col items-start justify-between gap-3 py-3 sm:flex-row sm:items-center">
						<FieldTitle id="cookies-browser-label"><CookieIcon className="size-4 text-muted-foreground" />
							{t("settings.cookiesBrowser")}
							<Tooltip>
								<TooltipTrigger render={<button type="button" aria-label={t("settings.cookiesBrowserInfo")} className="rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />}>
									<CircleHelpIcon className="size-3.5" aria-hidden="true" />
								</TooltipTrigger>
								<TooltipContent>{t("settings.cookiesBrowserTooltip")}</TooltipContent>
							</Tooltip>
						</FieldTitle>
						<div className="w-full min-w-0 sm:w-96 sm:flex-none">
							<Select items={cookiesBrowserItems} value={snapshot.settings.cookies_browser} disabled={cookiesBusy} onValueChange={(value) => {
							if (value === "manual") setCookieDialogOpen(true);
							else if (value === "disabled" || value === "firefox") {
								setCookiesBusy(true);
								void setCookiesBrowser(value as CookiesBrowser).catch((err) => toastError(err, t("settings.cookiesBrowserFailed"))).finally(() => setCookiesBusy(false));
							}
							}}>
								<SelectTrigger aria-labelledby="cookies-browser-label" className="!h-9 !w-full">
									{cookiesBusy ? <Spinner data-icon="inline-start" /> : null}
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>{cookiesBrowsers.map((browser) => <SelectItem key={browser} value={browser}>{t(`settings.cookiesBrowsers.${browser}`)}</SelectItem>)}</SelectGroup>
								</SelectContent>
							</Select>
							{snapshot.settings.cookies_browser === "manual" ? <p className="text-xs text-muted-foreground">
								{t("settings.cookiesUpdated", { date: snapshot.settings.cookies_updated_at ? new Date(snapshot.settings.cookies_updated_at * 1000).toLocaleDateString() : "" })}
								<Button type="button" variant="link" size="sm" className="h-auto px-1" disabled={cookiesBusy} onClick={() => setCookieDialogOpen(true)}>{t("settings.cookiesReplace")}</Button>
							</p> : null}
						</div>
					</Field>
				</div>
			</section>
			<section aria-labelledby="updates-heading">
				<h2 id="updates-heading" className="mb-2 text-xs font-medium text-muted-foreground">{t("settings.updateTitle")}</h2>
				<div className="divide-y divide-border/60 rounded-xl border border-border/70 bg-card px-4">
					<div className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
						<div className="min-w-0">
							<div className="flex flex-wrap items-center gap-2">
								<DownloadIcon className="size-4 text-muted-foreground" aria-hidden="true" />
								<h3 className="text-sm font-medium">{t("settings.appVersion")}</h3>
								<Badge variant="outline">{version || "—"}</Badge>
							</div>
							<div role="status" className="mt-2 pl-6">
								<Badge variant={loading ? "secondary" : appCheckFailed ? "destructive" : appNewer ? "secondary" : "success"}>
									{loading ? <Spinner /> : appCheckFailed ? <CircleAlertIcon /> : appNewer ? <DownloadIcon /> : <CheckIcon />}
									{loading ? t("settings.updateChecking") : appCheckFailed ? t("settings.updateCheckFailed") : appNewer ? t("settings.updateFound", { version: appUpdate?.version }) : t("settings.updateNone")}
								</Badge>
							</div>
						</div>
						{appNewer ? <Button type="button" size="sm" className="sm:justify-self-end" disabled={appBusy || downloadRunning} onClick={() => void installAppUpdate()}>
							{appBusy ? <Spinner data-icon="inline-start" /> : null}
							{downloadRunning ? t("settings.updateWaitForDownloads") : appBusy ? appUpdateInstalling ? t("settings.updateInstalling") : appUpdateProgress == null ? t("settings.updateDownloading") : t("settings.updateProgress", { percent: appUpdateProgress }) : t("settings.updateAction")}
						</Button> : null}
					</div>
					<div className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
						<div className="min-w-0">
							<div className="flex flex-wrap items-center gap-2">
								<FileIcon className="size-4 text-muted-foreground" aria-hidden="true" />
								<h3 className="text-sm font-medium">{t("settings.ytdlp")}</h3>
								<Badge variant="outline">{ytdlp || t("settings.ytdlpUnknown")}</Badge>
							</div>
							<div role="status" className="mt-2 pl-6">
								<Badge variant={loading ? "secondary" : ytdlpCheckFailed ? "destructive" : ytdlpNewer ? "secondary" : "success"}>
									{loading ? <Spinner /> : ytdlpCheckFailed ? <CircleAlertIcon /> : ytdlpNewer ? <DownloadIcon /> : <CheckIcon />}
									{loading ? t("settings.updateChecking") : ytdlpCheckFailed ? t("settings.updateCheckFailed") : ytdlpNewer ? t("settings.ytdlpFound", { version: ytdlpUpdate?.version }) : t("settings.updateNone")}
								</Badge>
							</div>
						</div>
						{ytdlpNewer ? <Button type="button" size="sm" className="sm:justify-self-end" disabled={ytdlpBusy} onClick={() => {
							setYtdlpBusy(true);
							void updateYtdlp()
								.then(async (next) => {
									setYtdlp(next);
									const info = await ytdlpInfo().catch(() => null);
									if (info) setYtdlp(info.version);
									const result = await checkYtdlpUpdate().then((update) => ({ update, failed: false }), () => ({ update: null, failed: true }));
									setYtdlpUpdate(result.update);
									setYtdlpCheckFailed(result.failed);
									toast.add({ title: t("settings.ytdlpUpdated", { version: info?.version || next }), type: "success" });
								})
								.catch((err) => toastError(err, t("settings.ytdlpUpdateFailed")))
								.finally(() => setYtdlpBusy(false));
						}}>
							{ytdlpBusy ? <Spinner data-icon="inline-start" /> : null}
							{t("settings.updateAction")}
						</Button> : null}
					</div>
				</div>
			</section>
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
			<p className="text-right text-xs text-muted-foreground">
				made with <span className="text-red-500">❤️</span> laot
			</p>
		</PageShell>
	);
}
