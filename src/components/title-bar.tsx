import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ClockIcon, DownloadIcon, MinusIcon, SettingsIcon, SquareIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/downly/brand-mark";

type PageId = "queue" | "history" | "settings";

type Props = {
	page: PageId;
	onNavigate: (page: PageId) => void;
	onClose: () => void;
};

const pages: { id: PageId; icon: typeof DownloadIcon }[] = [
	{ id: "queue", icon: DownloadIcon },
	{ id: "history", icon: ClockIcon },
	{ id: "settings", icon: SettingsIcon },
];

export function TitleBar({ page, onNavigate, onClose }: Props) {
	const { t } = useTranslation();
	const window = getCurrentWindow();

	return (
		<header className="relative grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-border bg-background px-3">
			<div data-tauri-drag-region className="flex h-full min-w-0 items-center gap-2 px-2">
				<BrandMark className="size-5" />
				<span className="text-sm font-semibold tracking-tight">Downly</span>
			</div>
			<nav aria-label={t("nav.primary")} className="flex h-full items-center gap-4">
				{pages.map((item, index) => {
					const active = page === item.id;
					return (
						<Fragment key={item.id}>
							{index > 0 ? <span aria-hidden="true" className="h-4 w-px bg-border" /> : null}
						<Button
							type="button"
							variant="ghost"
							aria-current={active ? "page" : undefined}
							aria-label={t(`nav.${item.id}`)}
							onClick={() => onNavigate(item.id)}
							className={`relative h-full gap-2 rounded-none bg-transparent px-2 text-sm transition-colors duration-200 ease-out hover:!bg-transparent aria-expanded:!bg-transparent active:translate-y-0 after:absolute after:-bottom-px after:left-0 after:z-10 after:h-0.5 after:w-full ${active ? "text-foreground after:bg-white" : "text-muted-foreground hover:text-foreground"}`}>
							<item.icon className="size-4" strokeWidth={1.7} />
							<span>{t(`nav.${item.id}`)}</span>
						</Button>
						</Fragment>
					);
				})}
			</nav>
			<div className="flex h-full items-center justify-end">
				<div className="flex h-full items-center">
					<Button type="button" variant="ghost" size="icon" className="size-10 rounded-lg" aria-label={t("chrome.minimize")} onClick={() => void window.minimize()}>
						<MinusIcon />
					</Button>
					<Button type="button" variant="ghost" size="icon" className="size-10 rounded-lg" aria-label={t("chrome.maximize")} onClick={() => void window.toggleMaximize()}>
						<SquareIcon className="size-3.5" />
					</Button>
					<Button type="button" variant="ghost" size="icon" className="size-10 rounded-lg hover:bg-destructive/15 hover:text-destructive" aria-label={t("chrome.close")} onClick={onClose}>
						<XIcon />
					</Button>
				</div>
			</div>
		</header>
	);
}
