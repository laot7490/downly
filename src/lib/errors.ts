import { toast } from "@/components/ui/toast";

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
