import type { ReactNode } from "react";
import { BrandMark } from "@/components/downly/brand-mark";

type Props = {
	thumbnail: string | null;
	title: string;
	meta?: ReactNode;
	actions?: ReactNode;
};

export function MediaRow({ thumbnail, title, meta, actions }: Props) {
	return (
		<div className="flex items-center gap-3 border-b border-border py-3">
			{thumbnail ? (
				<img src={thumbnail} alt="" className="size-12 rounded-md object-cover" />
			) : (
				<div className="flex size-12 items-center justify-center rounded-md bg-muted">
					<BrandMark className="size-5 opacity-50" />
				</div>
			)}
			<div className="flex min-w-0 flex-1 flex-col gap-1.5">
				<p className="truncate text-sm font-medium text-foreground">{title}</p>
				{meta}
			</div>
			{actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
		</div>
	);
}
