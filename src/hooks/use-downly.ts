import { useEffect, useState } from "react";
import { getState, onState } from "@/lib/api";
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
		let unlisten: (() => void) | undefined;
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
			unlisten = fn;
		});
		return () => {
			active = false;
			unlisten?.();
		};
	}, []);

	return { snapshot, setSnapshot, ready };
}
