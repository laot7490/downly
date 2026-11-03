import { useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
		<Field data-invalid={error ? true : undefined}>
			<FieldTitle>{t("settings.folder")}</FieldTitle>
			<div className="flex gap-2">
				<Input readOnly value={path} aria-invalid={error ? true : undefined} className="min-w-0 flex-1" />
				<Button type="button" variant="outline" disabled={busy} onClick={() => void browse()}>
					{busy ? <Spinner data-icon="inline-start" /> : <FolderOpenIcon data-icon="inline-start" />}
					{t("settings.browse")}
				</Button>
			</div>
			{error ? <p className="text-sm text-destructive">{error}</p> : null}
		</Field>
	);
}
