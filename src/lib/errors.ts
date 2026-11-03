import { toast } from "@/components/ui/toast";

export type CookieErrorKind = "database_locked" | "decryption" | "authentication";

export function classifyCookieError(err: unknown): CookieErrorKind | null {
	let details = "";
	try {
		details = typeof err === "string" ? err : JSON.stringify(err);
	} catch {
		details = String(err);
	}
	const message = `${formatError(err, "")} ${details}`.toLowerCase();
	if (/failed to decrypt with dpapi|app.bound encryption|app.bound encrypted/.test(message)) {
		return "decryption";
	}
	if (/could not copy.{0,160}(cookie|database)|(?:cookie|database).{0,160}(permission denied|access is denied|database is locked)|permissionerror.{0,160}(cookie|database)|permission denied.{0,160}cookies?/s.test(message)) {
		return "database_locked";
	}
	if (/sign in to confirm|login required|log in to confirm|cookies? (?:are )?(?:no longer )?valid|authentication required|confirm you.re not a bot/.test(message)) {
		return "authentication";
	}
	return null;
}

export function hasCookieWarning(err: unknown): boolean {
	let details = "";
	try {
		details = typeof err === "string" ? err : JSON.stringify(err);
	} catch {
		details = String(err);
	}
	return /cookies?|cookie jar|--cookies(?:-from-browser)?/i.test(`${formatError(err, "")} ${details}`);
}

export function formatError(err: unknown, fallback: string): string {
	if (err == null) {
		return fallback;
	}
	if (typeof err === "string") {
		return clean(err) || fallback;
	}
	if (err instanceof Error) {
		return clean(err.message) || fallback;
	}
	if (typeof err === "object") {
		const record = err as Record<string, unknown>;
		for (const key of ["message", "error", "data", "payload", "cause", "stack"]) {
			const value = record[key];
			if (typeof value === "string" && clean(value)) {
				return clean(value);
			}
		}
		const stringValue = clean(String(err));
		if (stringValue && stringValue !== "[object Object]") {
			return stringValue;
		}
		try {
			const json = JSON.stringify(err);
			if (json && json !== "null" && json !== "{}") {
				return json;
			}
		} catch {
			// ignore
		}
	}
	return fallback;
}

export function toastError(err: unknown, fallback: string) {
	toast.add({ title: formatError(err, fallback), type: "error" });
}

function clean(value: string): string {
	const trimmed = value.trim();
	if (!trimmed || trimmed === "null" || trimmed === "undefined" || trimmed === "[object Object]") {
		return "";
	}
	return trimmed;
}
