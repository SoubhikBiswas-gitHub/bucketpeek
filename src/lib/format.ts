import prettyBytes from "pretty-bytes";
import { format, formatDistanceToNow } from "date-fns";

export function formatBytes(n: number): string {
  return prettyBytes(n, { maximumFractionDigits: 1 });
}

export function formatDate(iso: string | null): string {
  return iso ? format(new Date(iso), "MMM d, yyyy") : "";
}

export function formatDateTime(iso: string | null): string {
  return iso ? format(new Date(iso), "MMM d, yyyy, h:mm a") : "";
}

export function formatRelative(iso: string | null): string {
  return iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : "";
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

export const EXPIRY_OPTIONS = [
  { seconds: 3600, label: "1 hour" },
  { seconds: 21600, label: "6 hours" },
  { seconds: 86400, label: "24 hours" },
  { seconds: 604800, label: "7 days" },
] as const;

export function expiryLabel(seconds: number): string {
  return EXPIRY_OPTIONS.find((o) => o.seconds === seconds)?.label ?? `${Math.round(seconds / 60)} minutes`;
}
