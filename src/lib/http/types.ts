/**
 * Typical Frappe `/api/method/...` JSON envelope (success and error shapes vary by version).
 */
export type FrappeMethodJson = {
  message?: unknown;
  data?: unknown;
  exc?: string;
  exception?: string;
  exc_type?: string;
  _server_messages?: string;
  [key: string]: unknown;
};

export type PingResult = {
  ok: boolean;
  /** Parsed `message` when present (e.g. "pong"). */
  message?: unknown;
};
