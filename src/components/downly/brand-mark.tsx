import { useEffect, useState } from "react";
import { cn } from "cn";
import markOnDark from "@/assets/brand/icon_white_transparent.png?url";
import markOnLight from "@/assets/brand/icon_black_transparent.png?url";
import { readTheme, resolvedTheme, useTheme } from "@/theme";

type Props = {
	className?: string;
};

export function BrandMark({ className }: Props) {
	const { theme } = useTheme();
	const [dark, setDark] = useState(() => resolvedTheme(readTheme()) === "dark");

	useEffect(() => {
		const sync = () => setDark(resolvedTheme(theme) === "dark");
		sync();
		if (theme !== "system") {
			return;
		}
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		media.addEventListener("change", sync);
		return () => media.removeEventListener("change", sync);
	}, [theme]);

	return <img src={dark ? markOnDark : markOnLight} alt="" className={cn("size-5", className)} />;
}
