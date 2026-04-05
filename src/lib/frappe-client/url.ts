/**
 * Join a Frappe/ERPNext base URL with an absolute path without duplicating slashes
 * or mis-resolving when the base includes a path prefix.
 */
export function joinFrappeBaseUrl(baseUrl: string, absolutePath: string): string {
  const trimmedBase = baseUrl.trim().replace(/\/+$/, "");
  const path = absolutePath.startsWith("/") ? absolutePath : `/${absolutePath}`;
  return new URL(path, `${trimmedBase}/`).href;
}

/**
 * Build `/api/method/{method}` with a safe path segment for the dotted Frappe method name.
 */
export function buildFrappeMethodUrl(baseUrl: string, method: string): string {
  const trimmed = method.trim();
  if (!trimmed) {
    throw new Error("Frappe method name must be non-empty");
  }
  const segment = encodeURIComponent(trimmed);
  return joinFrappeBaseUrl(baseUrl, `/api/method/${segment}`);
}
