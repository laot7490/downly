import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MinusIcon, SquareIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/downly/brand-mark";

export function TitleBar({ onClose }: { onClose: () => void }) {
	const { t } = useTranslation();
	const window = getCurrentWindow();

	return (
		<header className="flex h-9 shrink-0 items-stretch border-b border-border bg-background">
			<div data-tauri-drag-region className="flex min-w-0 flex-1 items-center px-3">
				<BrandMark className="size-4" />
				<span className="ml-2 text-sm font-semibold tracking-tight">Downly</span>
			</div>
			<div className="flex h-full">
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="size-9 rounded-none"
					aria-label={t("chrome.minimize")}
					onClick={() => void window.minimize()}>
					<MinusIcon />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="size-9 rounded-none"
					aria-label={t("chrome.maximize")}
					onClick={() => void window.toggleMaximize()}>
					<SquareIcon className="size-3" />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="size-9 rounded-none hover:bg-destructive/15 hover:text-destructive"
					aria-label={t("chrome.close")}
					onClick={onClose}>
					<XIcon />
				</Button>
			</div>
		</header>
	);
}
