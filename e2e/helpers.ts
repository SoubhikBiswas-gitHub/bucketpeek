import { expect, type Locator, type Page } from "@playwright/test";

/** Any credentials connect in mock mode; these just have to pass form validation. */
export const MOCK = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  bucket: "deccan-demo",
};

export const accessKeyInput = (page: Page) => page.getByRole("textbox", { name: /access key id/i });
// Password inputs have no ARIA role, so the secret is found by its label.
export const secretInput = (page: Page) => page.getByLabel(/^secret access key/i).and(page.locator("input"));
export const bucketInput = (page: Page) => page.getByRole("textbox", { name: /bucket/i });
export const connectButton = (page: Page) => page.getByRole("button", { name: /^connect$/i });

export async function fillConnectForm(page: Page, values: Partial<typeof MOCK> = MOCK) {
  if (values.accessKeyId !== undefined) await accessKeyInput(page).fill(values.accessKeyId);
  if (values.secretAccessKey !== undefined) await secretInput(page).fill(values.secretAccessKey);
  if (values.bucket !== undefined) await bucketInput(page).fill(values.bucket);
}

export async function connect(page: Page) {
  await page.goto("/setup");
  await fillConnectForm(page);
  await connectButton(page).click();
  await expect(page).toHaveURL(/\/browse/);
}

export const viewUrl = (key: string) => `/view?key=${encodeURIComponent(key)}`;
export const browseUrl = (prefix = "") => (prefix ? `/browse?prefix=${encodeURIComponent(prefix)}` : "/browse");

/** The preview region every renderer sits in ("Preview of <name>"). */
export function stage(page: Page, name: string): Locator {
  return page.getByRole("region", { name: `Preview of ${name}` });
}

/**
 * The link for a browse entry (folder or file), in list or grid view. Always the anchor, not its
 * row: a plain <a> works even before hydration, while a row's click handler needs React.
 */
export function entry(page: Page, name: string | RegExp): Locator {
  const n = typeof name === "string" ? new RegExp(`^${escapeRe(name)}$`) : name;
  return page.getByRole("link", { name: n }).first();
}

/**
 * Waits until React has hydrated an element, so a click on it isn't lost. Server-rendered HTML is
 * attached, visible and clickable before its handlers exist; React marks the nodes it owns.
 */
export async function hydrated(locator: Locator) {
  await expect
    .poll(() => locator.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps$"))), { timeout: 30_000 })
    .toBe(true);
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Clipboard permissions exist only in Chromium; Firefox and WebKit allow a click's write without them.
export const clipboardPermissions = async ({ browserName }: { browserName: string }, provide: (p: string[]) => Promise<void>) =>
  provide(browserName === "chromium" ? ["clipboard-read", "clipboard-write"] : []);

// WebKit only lets a page read the clipboard through a real paste, so paste into a scratch field.
export async function readClipboard(page: Page): Promise<string> {
  if (page.context().browser()?.browserType().name() !== "webkit") return page.evaluate(() => navigator.clipboard.readText());
  const field = await page.evaluateHandle(() => {
    const el = document.createElement("textarea");
    el.style.cssText = "position:fixed;top:0;left:0;z-index:2147483647";
    // An open modal traps focus, so the field has to live inside it to receive the paste.
    const modal = [...document.querySelectorAll('[role=dialog][aria-modal=true], [role=dialog][data-state=open]')].pop();
    return (modal ?? document.body).appendChild(el);
  });
  let text = "";
  // A closing menu hands focus back to its trigger and can take the paste; retry until it lands.
  await expect(async () => {
    await field.fill("");
    await page.keyboard.press("ControlOrMeta+v");
    text = await field.inputValue();
    expect(text).not.toBe("");
  }).toPass({ timeout: 5_000 });
  await field.evaluate((el) => el.remove());
  return text;
}
