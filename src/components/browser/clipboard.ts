"use client";

export async function writeClipboard(text: string) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  // Plain-http deployments have no async clipboard API.
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  const previous = document.activeElement as HTMLElement | null;
  document.body.appendChild(area);
  area.select();
  try {
    if (!document.execCommand("copy")) throw new Error("Copy rejected");
  } finally {
    area.remove();
    previous?.focus({ preventScroll: true });
  }
}

/**
 * Copies text that is still being fetched. Handing the clipboard a promise keeps the click's
 * permission (Safari drops it once an await has passed); browsers without that fall back to
 * writing when the text arrives. Rejects with the fetch's own error if the text can't be made.
 */
export async function writeClipboardLater(text: Promise<string>): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write && window.isSecureContext) {
    const blob = text.then((t) => new Blob([t], { type: "text/plain" }));
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      return;
    } catch {
      // Older browsers can't take a promise here. Below, a failed fetch rethrows its own error.
    }
  }
  await writeClipboard(await text);
}
