/**
 * Join a Frappe/ERPNext base URL with an absolute path without duplicating slashes
 * or mis-resolving when the base includes a path prefix.
 */
export function joinFrappeBaseUrl(baseUrl: string, absolutePath: string): string {
  const trimmedBase = baseUrl.trim().replace(/\/+$/, "");
  const path = absolutePath.startsWith("/") ? absolutePath : `/${absolutePath}`;
  return new URL(path, `${trimmedBase}/`).href;
}
