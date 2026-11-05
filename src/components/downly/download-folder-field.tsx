import { useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderIcon, FolderOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldTitle } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { setDownloadDir } from "@/lib/api";
import { formatError } from "@/lib/errors";

type Props = {
	path: string;
};

export function DownloadFolderField({ path }: Props) {
	const { t } = useTranslation();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function browse() {
		const picked = await open({
			directory: true,
			multiple: false,
			defaultPath: path || undefined,
			title: t("settings.folder"),
		});
		if (typeof picked !== "string" || picked.length === 0) {
			return;
		}
		setBusy(true);
		setError(null);
		try {
			await setDownloadDir(picked);
		} catch (err) {
			setError(formatError(err, t("settings.folderFailed")));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Field orientation="horizontal" data-invalid={error ? true : undefined} className="flex-col items-start justify-between gap-3 py-3 sm:flex-row sm:items-center">
			<FieldTitle id="download-folder-label" className="shrink-0"><FolderIcon className="size-4 text-muted-foreground" />{t("settings.folder")}</FieldTitle>
			<div className="w-full min-w-0 sm:w-96 sm:shrink-0">
				<Button type="button" variant="outline" className="h-9 w-full justify-between gap-3" aria-label={`${t("settings.browse")}: ${path}`} title={path} disabled={busy} onClick={() => void browse()}>
					<span className="min-w-0 truncate">{path || t("settings.browse")}</span>
					{busy ? <Spinner data-icon="inline-end" /> : <FolderOpenIcon data-icon="inline-end" />}
				</Button>
				{error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
			</div>
		</Field>
	);
}
