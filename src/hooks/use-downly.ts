import { useEffect, useState } from "react";
import { getState, onState, onTransferProgress } from "@/lib/api";
import type { Snapshot } from "@/lib/downly";

const empty: Snapshot = {
	queue: [],
	session: [],
	history: [],
settings: { download_dir: "", cookies_browser: "disabled", cookies_updated_at: null, download_speed_limit_bytes_per_second: null },
	progress: null,
};

export function useDownly() {
	const [snapshot, setSnapshot] = useState<Snapshot>(empty);
	const [ready, setReady] = useState(false);

	useEffect(() => {
		let active = true;
		const unlisten: Array<() => void> = [];
		getState()
			.then((next) => {
				if (active) {
					setSnapshot(next);
					setReady(true);
				}
			})
			.catch(() => {
				if (active) {
					setReady(true);
				}
			});
		onState((next) => {
			if (active) {
				setSnapshot(next);
			}
		}).then((fn) => {
			if (active) unlisten.push(fn);
			else fn();
		});
		onTransferProgress((transfer) => {
			if (!active) return;
			setSnapshot((current) => {
				if (current.progress?.id !== transfer.id) return current;
				return {
					...current,
					progress: { ...current.progress, percent: transfer.percent, speed: null, eta: null, phase: "transfer" },
				};
			});
		}).then((fn) => {
			if (active) unlisten.push(fn);
			else fn();
		});
		return () => {
			active = false;
			unlisten.forEach((fn) => fn());
		};
	}, []);

	return { snapshot, setSnapshot, ready };
}
