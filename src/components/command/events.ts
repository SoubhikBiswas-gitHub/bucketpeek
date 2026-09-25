export const OPEN_COMMAND_EVENT = "lens:open-command";
export const OPEN_SHORTCUTS_EVENT = "lens:open-shortcuts";

// A path query such as "Factory/" opens in path mode. A no-op before the menu has mounted.
export function openCommandMenu(query?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    query === undefined ? new Event(OPEN_COMMAND_EVENT) : new CustomEvent(OPEN_COMMAND_EVENT, { detail: { query } }),
  );
}

export function openShortcutsDialog(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT));
}

const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "week",
  "time",
]);

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type) && !el.readOnly;
  return el.closest("[contenteditable=''], [contenteditable='true'], [role='textbox']") !== null;
}

// ⌘K may open the menu from single-line inputs (the file search box), but not from multi-line
// editors, where the chord could mean something to the editor.
export function blocksCommandChord(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el instanceof HTMLTextAreaElement;
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = data?.platform || navigator.platform || navigator.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform);
}
