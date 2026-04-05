import type { FrappeErrorCode, FrappeErrorResult } from "./types.js";

const SNIPPET_MAX = 512;

/** Truncate upstream text for safe operator-facing messages (no auth material). */
export function truncateSafeSnippet(text: string, max = SNIPPET_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

export function errResult(code: FrappeErrorCode, message: string): FrappeErrorResult {
  return { ok: false, error: { code, message } };
}

export function safeExcMessage(exc: unknown): string {
  if (typeof exc === "string" && exc.trim()) {
    return truncateSafeSnippet(exc);
  }
  return "Frappe returned an application error";
}
