import { expect, test, type Page } from "@playwright/test";
import { worksUntil } from "../src/lib/link-expiry";
import { browseUrl, clipboardPermissions, hydrated, readClipboard, viewUrl } from "./helpers";

const HOUR = 3600;
const dialog = (page: Page) => page.getByRole("dialog");
const lifetime = (page: Page, label: string) => dialog(page).getByRole("radio", { name: label });

async function shownUntil(page: Page) {
  const iso = await dialog(page).locator("time").getAttribute("datetime");
  return new Date(iso!);
}

async function expectUntilIn(page: Page, seconds: number) {
  await expect.poll(async () => ((await shownUntil(page)).getTime() - Date.now()) / 1000).toBeGreaterThan(seconds - 90);
  expect(((await shownUntil(page)).getTime() - Date.now()) / 1000).toBeLessThanOrEqual(seconds + 5);
  const until = worksUntil(await shownUntil(page));
  await expect(dialog(page)).toContainText(`Works until ${until.both}`);
}

// A mock link's `exp` is its expiry in Unix seconds, like X-Amz-Date + X-Amz-Expires on S3.
// What's on screen: innerText skips the spans hidden at this width.
const visibleText = (page: Page) =>
  page.getByRole("group", { name: "Share link" }).evaluate((el) => (el as HTMLElement).innerText.replace(/\s+/g, " ").trim());

const secondsLeft = (link: string) => Number(new URL(link).searchParams.get("exp")) - Date.now() / 1000;

// The Next.js dev tools badge covers the bottom-left corner under `next dev`; let clicks through.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal { pointer-events: none !important; }";
      document.head.append(style);
    });
  });
});

test.describe("copy link dialog", () => {
  test.use({ permissions: clipboardPermissions, viewport: { width: 1440, height: 900 } });

  async function openFromRowMenu(page: Page, name: RegExp) {
    await page.getByRole("row", { name }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Copy S3 link" }).click();
    await expect(dialog(page)).toBeVisible();
  }

  test.beforeEach(async ({ page }) => {
    await page.goto(browseUrl("Factory/"));
    await hydrated(page.getByRole("checkbox", { name: "Select README.md", exact: true }));
  });

  test("the row menu asks how long, shows the end time live, and copies a link for that long", async ({ page, request }) => {
    await openFromRowMenu(page, /README\.md/);
    await expect(dialog(page)).toContainText("README.md");
    await expect(lifetime(page, "1 hour")).toBeChecked();
    await expectUntilIn(page, HOUR);
    await expect(dialog(page)).toContainText(/UTC · .* IST/);
    await expect(dialog(page)).toContainText("Anyone with the link can open the file until then.");

    await lifetime(page, "24 hours").click();
    await expect(lifetime(page, "24 hours")).toBeChecked();
    await expect(lifetime(page, "1 hour")).not.toBeChecked();
    await expectUntilIn(page, 24 * HOUR);

    await dialog(page).getByRole("button", { name: "Copy link" }).click();
    await expect(dialog(page)).toBeHidden();
    await expect(page.getByText("Copied 1 S3 link")).toBeVisible();
    await expect(page.getByText(/^Works until .* UTC · .* IST\.$/)).toBeVisible();

    const link = await readClipboard(page);
    expect(link).toMatch(/README\.md/);
    expect(secondsLeft(link)).toBeGreaterThan(24 * HOUR - 120);
    expect(secondsLeft(link)).toBeLessThanOrEqual(24 * HOUR);
    const res = await request.get(link, { headers: { cookie: "" } });
    expect(res.status()).toBe(200);
  });

  test("remembers the last choice", async ({ page }) => {
    await openFromRowMenu(page, /README\.md/);
    await lifetime(page, "7 days").click();
    await dialog(page).getByRole("button", { name: "Copy link" }).click();
    await expect(dialog(page)).toBeHidden();
    expect(secondsLeft(await readClipboard(page))).toBeGreaterThan(7 * 24 * HOUR - 120);

    await page.reload();
    await hydrated(page.getByRole("checkbox", { name: "Select README.md", exact: true }));
    await openFromRowMenu(page, /summary\.pdf/);
    await expect(lifetime(page, "7 days")).toBeChecked();
    await expectUntilIn(page, 7 * 24 * HOUR);
  });

  test("Cancel and Escape copy nothing", async ({ page }) => {
    await page.evaluate(() => navigator.clipboard.writeText("untouched"));
    await openFromRowMenu(page, /README\.md/);
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    await expect(dialog(page)).toBeHidden();
    await openFromRowMenu(page, /README\.md/);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    expect(await readClipboard(page)).toBe("untouched");
    // The page still takes clicks once the dialog is gone.
    await page.getByRole("checkbox", { name: "Select README.md", exact: true }).click();
    await expect(page.getByRole("toolbar", { name: "Selected items" })).toContainText("1 selected");
  });

  test("Copy S3 links asks once for the whole selection", async ({ page }) => {
    for (const name of ["README.md", "summary.pdf", "episodes"]) {
      await page.getByRole("checkbox", { name: `Select ${name}`, exact: true }).click();
    }
    await page.getByRole("toolbar", { name: "Selected items" }).getByRole("button", { name: "Copy S3 links" }).click();
    await expect(dialog(page)).toContainText("2 files");
    await expect(dialog(page)).toContainText("1 folder skipped");
    await expect(dialog(page)).toContainText("Anyone with the links can open the files until then.");
    await lifetime(page, "6 hours").click();
    await expectUntilIn(page, 6 * HOUR);
    await dialog(page).getByRole("button", { name: "Copy 2 links" }).click();
    await expect(page.getByText("Copied 2 S3 links")).toBeVisible();
    const links = (await readClipboard(page)).split("\n");
    expect(links).toHaveLength(2);
    for (const link of links) expect(secondsLeft(link)).toBeGreaterThan(6 * HOUR - 120);
  });

  test("Copy Deccan Lens link copies straight away, without asking", async ({ page }) => {
    await page.getByRole("row", { name: /README\.md/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Copy Deccan Lens link" }).click();
    await expect(page.getByText(/Copied link/i)).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    expect(await readClipboard(page)).toMatch(/\/view\?key=Factory%2FREADME\.md$/);
  });
});

test.describe("file page share link", () => {
  test.use({ permissions: clipboardPermissions, viewport: { width: 1440, height: 900 } });

  test("Copy link signs a fresh link and then says until when it works", async ({ page }) => {
    await page.goto(viewUrl("Factory/README.md"));
    const share = page.getByRole("group", { name: "Share link" });
    const copy = share.getByRole("button", { name: "Copy link" });
    await hydrated(copy);
    await expect(share).toHaveText("Copy link");

    await copy.click();
    await expect(dialog(page)).toContainText("README.md");
    await lifetime(page, "6 hours").click();
    await expectUntilIn(page, 6 * HOUR);
    await dialog(page).getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByText("Link copied")).toBeVisible();

    const link = await readClipboard(page);
    expect(secondsLeft(link)).toBeGreaterThan(6 * HOUR - 120);
    expect(secondsLeft(link)).toBeLessThanOrEqual(6 * HOUR);
    await expect.poll(() => visibleText(page)).toMatch(/^(Copied|Copy link) Works until \d+ \w{3} \d{4}, \d\d:\d\d UTC · .* [AP]M IST$/);
    const exp = Number(new URL(link).searchParams.get("exp"));
    await expect.poll(() => visibleText(page)).toContain(worksUntil(new Date(exp * 1000)).both);

    const details = share.getByRole("button", { name: /Copied link works until/ });
    await details.click();
    await expect(page.getByRole("dialog").or(page.locator("[data-slot=popover-content]"))).toContainText("The link you copied works until");
  });

  test("phones show the compact time", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(viewUrl("Factory/README.md"));
    const share = page.getByRole("group", { name: "Share link" });
    const copy = share.getByRole("button", { name: "Copy link" });
    await hydrated(copy);
    await copy.click();
    await dialog(page).getByRole("button", { name: "Copy link" }).click();
    await expect(dialog(page)).toBeHidden();
    // "Copy link" is the icon button's screen-reader label.
    await expect.poll(() => visibleText(page)).toMatch(/^(Copied|Copy link) \d{1,2}:\d{2} [AP]M IST$/);
  });
});
