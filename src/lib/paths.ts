// Keys and prefixes always travel as query params so any S3 key works.

export function browseHref(prefix = ""): string {
  return prefix ? `/browse?prefix=${encodeURIComponent(prefix)}` : "/browse";
}

export function viewHref(key: string): string {
  return `/view?key=${encodeURIComponent(key)}`;
}

// Redirects to a short-lived presigned URL (usable as <img src>).
export function openHref(key: string): string {
  return `/api/files/open?key=${encodeURIComponent(key)}`;
}

// `version` only busts the browser cache when the file changes.
export function thumbHref(key: string, version: string): string {
  return `/api/thumb?key=${encodeURIComponent(key)}&v=${encodeURIComponent(version)}`;
}

export function downloadHref(key: string): string {
  return `/api/files/download?key=${encodeURIComponent(key)}`;
}

// Normalizes user input to "" or "a/b/".
export function normalizePrefix(prefix: string | null | undefined): string {
  const parts = (prefix ?? "").split("/").filter(Boolean);
  return parts.length ? parts.join("/") + "/" : "";
}

export interface Crumb {
  name: string;
  prefix: string;
}

export function crumbsOf(prefix: string): Crumb[] {
  const parts = prefix.split("/").filter(Boolean);
  return parts.map((name, i) => ({ name, prefix: parts.slice(0, i + 1).join("/") + "/" }));
}

export function parentOf(prefix: string): string {
  const parts = prefix.split("/").filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join("/") + "/" : "";
}

export function folderOf(key: string): string {
  const i = key.lastIndexOf("/");
  return i >= 0 ? key.slice(0, i + 1) : "";
}
