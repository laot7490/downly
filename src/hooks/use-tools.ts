import { useCallback, useEffect, useRef, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { manageTools, onToolsProgress } from "@/lib/api";
import type { ToolProgress, ToolsStatus } from "@/lib/downly";

export type ToolsController = {
	ready: boolean;
	status: ToolsStatus | null;
	progress: ToolProgress | null;
	installError: string | null;
	checkFailed: boolean;
	checking: boolean;
	updating: boolean;
	updateDialogOpen: boolean;
	dismissUpdateDialog: () => void;
	retryInstall: () => void;
	checkUpdates: () => Promise<void>;
	updateAll: () => Promise<void>;
};

export function useTools(): ToolsController {
	const [ready, setReady] = useState(false);
	const [status, setStatus] = useState<ToolsStatus | null>(null);
	const [progress, setProgress] = useState<ToolProgress | null>(null);
	const [installError, setInstallError] = useState<string | null>(null);
	const [checkFailed, setCheckFailed] = useState(false);
	const [checking, setChecking] = useState(false);
	const [updating, setUpdating] = useState(false);
	const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
	const active = useRef(true);
	const progressListener = useRef<UnlistenFn | null>(null);
	const handleProgress = useCallback((next: ToolProgress) => {
		if (active.current) setProgress(next);
	}, []);

	const checkUpdates = useCallback(async (showPrompt = false) => {
		setChecking(true);
		try {
			const next = await manageTools("check");
			if (active.current) {
				setStatus(next);
				setCheckFailed(false);
				if (showPrompt && next.update_available) setUpdateDialogOpen(true);
			}
		} catch (error) {
			if (active.current) setCheckFailed(true);
			throw error;
		} finally {
			if (active.current) setChecking(false);
		}
	}, []);

	const ensureInstalled = useCallback(async () => {
		setInstallError(null);
		try {
			const installed = await manageTools("ensure");
			if (!active.current) return;
			setStatus(installed);
			setReady(true);
			setProgress(null);
			await checkUpdates(true).catch(() => undefined);
		} catch (error) {
			if (active.current) setInstallError(error instanceof Error ? error.message : String(error));
		}
	}, [checkUpdates]);

	useEffect(() => {
		let cancelled = false;
		active.current = true;
		void (async () => {
			try {
				const stop = await onToolsProgress(handleProgress);
				if (cancelled) {
					stop();
					return;
				}
				progressListener.current = stop;
				await ensureInstalled();
			} catch (error) {
				if (!cancelled) setInstallError(error instanceof Error ? error.message : String(error));
			}
		})();
		return () => {
			cancelled = true;
			active.current = false;
			progressListener.current?.();
			progressListener.current = null;
		};
	}, [ensureInstalled, handleProgress]);

	const retryInstall = useCallback(async () => {
		setInstallError(null);
		setProgress((current) => current ?? { tool: "", phase: "checking", received: 0, total: null });
		try {
			if (!progressListener.current) progressListener.current = await onToolsProgress(handleProgress);
			await ensureInstalled();
		} catch (error) {
			if (active.current) setInstallError(error instanceof Error ? error.message : String(error));
		}
	}, [ensureInstalled, handleProgress]);

	const updateAll = useCallback(async () => {
		setUpdating(true);
		try {
			const next = await manageTools("update");
			if (active.current) {
				setStatus(next);
				setCheckFailed(false);
				setUpdateDialogOpen(false);
				setProgress(null);
			}
		} finally {
			if (active.current) setUpdating(false);
		}
	}, []);

	return {
		ready,
		status,
		progress,
		installError,
		checkFailed,
		checking,
		updating,
		updateDialogOpen,
		dismissUpdateDialog: () => setUpdateDialogOpen(false),
		retryInstall: () => void retryInstall(),
		checkUpdates: () => checkUpdates(true),
		updateAll,
	};
}
