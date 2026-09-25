// Falls back to a hidden textarea on insecure origins or when the Clipboard API is blocked.
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or document not focused. Try the legacy path below.
    }
  }

  try {
    // Keep the textarea inside an open dialog so its focus trap doesn't fight the selection.
    const host = document.activeElement?.closest('[role="dialog"]') ?? document.body;
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.setAttribute("aria-hidden", "true");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "0";
    area.style.opacity = "0";
    area.style.pointerEvents = "none";
    const previous = document.activeElement as HTMLElement | null;
    host.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    previous?.focus?.({ preventScroll: true });
    return ok;
  } catch {
    return false;
  }
}
