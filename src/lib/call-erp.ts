import type { Logger } from "pino";
import type { Env } from "../config/env.js";

export type ErpCallErrorKind = "timeout" | "network" | "http" | "parse" | "logical";

export class ErpCallError extends Error {
  constructor(
    public readonly kind: ErpCallErrorKind,
    message: string,
    public readonly options: {
      status?: number;
      responseText?: string;
      cause?: unknown;
    } = {}
  ) {
    super(message);
    this.name = "ErpCallError";
  }
}

function normalizeBaseUrl(base: string): string {
  return base.replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function unwrapFrappePayload(data: Record<string, unknown>): Record<string, unknown> {
  const msg = data.message;
  if (msg !== undefined && typeof msg === "object" && msg !== null && !Array.isArray(msg)) {
    return msg as Record<string, unknown>;
  }
  return data;
}

function extractErrorText(data: unknown): string {
  const r = asRecord(data);
  if (!r) {
    return "";
  }
  const parts: string[] = [];
  for (const k of ["error", "message", "exception", "exc", "_server_messages"] as const) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) {
      parts.push(v);
    }
  }
  return parts.join("\n");
}

/**
 * POST JSON to ERPNext; Bearer auth. Logs "Calling ERP HTTP endpoint" / "ERP response received".
 */
export async function callErp(
  env: Env,
  log: Logger,
  endpoint: string,
  payload: unknown
): Promise<Record<string, unknown>> {
  const base = normalizeBaseUrl(env.ERP_BASE_URL);
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = `${base}${path}`;

  log.info({ endpoint: path }, "Calling ERP HTTP endpoint");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.ERP_COMMAND_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.ERP_REMOTE_TOKEN}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : {};
    } catch (e) {
      throw new ErpCallError("parse", "ERP response was not valid JSON", {
        status: res.status,
        responseText: text.slice(0, 2000),
        cause: e,
      });
    }

    const top = asRecord(parsed) ?? {};
    log.info({ endpoint: path, status: res.status }, "ERP response received");

    if (!res.ok) {
      const errText = extractErrorText(parsed) || text.slice(0, 2000);
      throw new ErpCallError("http", errText || `HTTP ${res.status}`, {
        status: res.status,
        responseText: text.slice(0, 2000),
      });
    }

    const inner = unwrapFrappePayload(top);

    if (top.ok === false) {
      throw new ErpCallError(
        "logical",
        String(top.error ?? extractErrorText(parsed) ?? "ERP call failed"),
        { responseText: text.slice(0, 2000) }
      );
    }

    if (inner.ok === false) {
      throw new ErpCallError(
        "logical",
        String(inner.error ?? extractErrorText(inner) ?? "ERP call failed"),
        { responseText: text.slice(0, 2000) }
      );
    }

    return inner;
  } catch (e) {
    if (e instanceof ErpCallError) {
      throw e;
    }
    const err = e as Error & { name?: string };
    if (err.name === "AbortError" || err.message?.toLowerCase().includes("abort")) {
      throw new ErpCallError("timeout", "ERP HTTP request timed out", { cause: e });
    }
    throw new ErpCallError("network", err.message ?? String(e), { cause: e });
  } finally {
    clearTimeout(timer);
  }
}
