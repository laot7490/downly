import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldTitle } from "@/components/ui/field";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { DownloadFolderField } from "@/components/downly/download-folder-field";
import { PageShell } from "@/components/downly/page-shell";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import { chooseLanguage, type Language } from "@/i18n";
import { useTheme, type ThemeChoice } from "@/theme";
import { appVersion, checkAppUpdate, checkYtdlpUpdate, updateYtdlp, ytdlpInfo } from "@/lib/api";
import { toastError } from "@/lib/errors";
import type { AppUpdate, Snapshot } from "@/lib/downly";

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
	const [appUpdate, setAppUpdate] = useState<AppUpdate | null>(null);
	const [ytdlpUpdate, setYtdlpUpdate] = useState<AppUpdate | null>(null);
	const [loading, setLoading] = useState(true);
	const [appBusy, setAppBusy] = useState(false);
	const [ytdlpBusy, setYtdlpBusy] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		void Promise.all([
			appVersion().catch(() => ""),
			ytdlpInfo().catch(() => null),
			checkAppUpdate().catch(() => null),
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

	const appNewer = Boolean(appUpdate?.newer);
	const ytdlpNewer = Boolean(ytdlpUpdate?.newer);

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
			</FieldGroup>
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
							disabled={loading || appBusy || !appNewer || !appUpdate?.url}
							onClick={() => {
								if (!appUpdate?.url) {
									return;
								}
								setAppBusy(true);
								void openUrl(appUpdate.url)
									.catch((err) => {
										toastError(err, t("settings.updateFailed"));
									})
									.finally(() => setAppBusy(false));
							}}>
							{loading || appBusy ? (
								<Spinner data-icon="inline-start" />
							) : appNewer ? null : (
								<CheckIcon data-icon="inline-start" />
							)}
							{appNewer ? t("settings.updateAction") : t("settings.upToDate")}
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
