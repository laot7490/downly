import type { ReactNode } from "react";

type Props = {
	children: ReactNode;
};

export function PageShell({ children }: Props) {
	return <section className="mx-auto flex w-full max-w-3xl flex-col gap-4">{children}</section>;
}
