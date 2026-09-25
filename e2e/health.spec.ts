import { expect, test, type Page } from "@playwright/test";
import { browseUrl, connectButton, entry, fillConnectForm, MOCK } from "./helpers";

// From a script walking fixtures/bucket like the check does (dotfiles skipped, kindOf): 17 files, 4,976,625 B,
// 5 folders; video 4 = 4,302,778 B, image 4 = 592,716 B, pdf 1 = 17,466 B, audio 1 = 35,517 B, 7 more kinds 1 each.
const FIXTURES = {
  files: "17 files",
  bytes: "4.9 MB",
  folders: "5 folders",
  kinds: [
    { kind: "video", count: "4", label: "Videos", size: "4.3 MB" },
    { kind: "image", count: "4", label: "Images", size: "592.7 kB" },
    { kind: "pdf", count: "1", label: "PDFs", size: "17.4 kB" },
    { kind: "audio", count: "1", label: "Audio", size: "35.5 kB" },
  ],
  kindCount: 11,
};

const overview = (page: Page) => page.getByRole("region", { name: "Bucket overview" });

async function expectFixtureCounts(page: Page) {
  const panel = overview(page);
  // The first visit starts the check (a POST); it finishes in a few seconds on the fixtures.
  await expect(panel.getByText(FIXTURES.files)).toBeVisible({ timeout: 30_000 });
  await expect(panel).toContainText(FIXTURES.bytes);
  const cards = panel.getByRole("list", { name: "Files by type" }).getByRole("listitem");
  await expect(cards).toHaveCount(FIXTURES.kindCount);
  for (const k of FIXTURES.kinds) {
    const card = cards.and(page.locator(`[data-kind="${k.kind}"]`));
    await expect(card).toContainText(new RegExp(`^${k.count}\\s*${k.label}`));
    await expect(card).toContainText(k.size);
  }
}

test.describe("bucket health", () => {
  test("the one-time video check reports on every video and is reachable from the bucket chip", async ({ page }) => {
    await page.goto("/health");
    await expect(page.getByRole("heading", { name: "Bucket health" })).toBeVisible();
    // The demo bucket's four videos all play: the check finishes with nothing to fix.
    await expect(page.getByText("Every video looks fine")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Videos checked")).toBeVisible();
    await expect(page.getByRole("button", { name: "Scan again" })).toBeVisible();

    await page.goto(browseUrl());
    await page.getByRole("button", { name: /Show connection details/ }).click();
    const details = page.getByRole("dialog", { name: "Connection details" });
    await expect(details.getByText("All fine")).toBeVisible();
    await details.getByRole("link", { name: "View report" }).click();
    await expect(page).toHaveURL(/\/health$/);
  });

  test("the health page opens with the bucket overview", async ({ page }) => {
    await page.goto("/health");
    await expectFixtureCounts(page);
    await expect(overview(page)).toContainText(FIXTURES.folders);
  });
});

test.describe("reports per access key", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("another access key starts its own check, with a POST, and reading the report starts nothing", async ({ page }) => {
    const accessKeyId = `AKIA${Date.now().toString(36).toUpperCase()}`.padEnd(20, "Z");
    await page.goto("/setup");
    await fillConnectForm(page, { ...MOCK, accessKeyId });
    const started = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/health");
    await connectButton(page).click();
    await expect(page).toHaveURL(/\/browse/);
    // A new key has no report of its own yet, so the overview asks for the first check.
    expect(new URL((await started).url()).search).toBe("");
    await expectFixtureCounts(page);

    const reads = await Promise.all([page.request.get("/api/health"), page.request.get("/api/health")]);
    for (const r of reads) expect((await r.json()).status).toBe("done");
  });

  test("Scan again asks for a new check", async ({ page }) => {
    await page.goto("/setup");
    await fillConnectForm(page);
    await connectButton(page).click();
    await expect(page).toHaveURL(/\/browse/);
    await page.goto("/health");
    await expect(page.getByText("Every video looks fine")).toBeVisible({ timeout: 30_000 });
    const rescan = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/api/health?rescan=1"));
    await page.getByRole("button", { name: "Scan again" }).click();
    await rescan;
    await expect(page.getByText("Every video looks fine")).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("bucket overview", () => {
  test("the bucket root counts every file in the bucket by type", async ({ page }) => {
    await page.goto(browseUrl());
    await expectFixtureCounts(page);
    const panel = overview(page);
    await expect(panel).toContainText(FIXTURES.folders);
    await expect(panel).toContainText(/counted .+ ago/);

    // The folded state is remembered across visits.
    const toggle = panel.getByRole("button", { name: "Bucket overview" });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(panel.getByRole("list", { name: "Files by type" })).toHaveCount(0);
    await page.reload();
    await expect(overview(page).getByRole("button", { name: "Bucket overview" })).toHaveAttribute("aria-expanded", "false");
    await overview(page).getByRole("button", { name: "Bucket overview" }).click();
    await expect(overview(page).getByRole("list", { name: "Files by type" })).toBeVisible();

    await panel.getByRole("link", { name: "Bucket health" }).click();
    await expect(page).toHaveURL(/\/health$/);
  });

  test("isn't shown inside a folder", async ({ page }) => {
    await page.goto(browseUrl("Factory/"));
    await expect(entry(page, "README.md")).toBeVisible();
    await expect(overview(page)).toHaveCount(0);
  });

  for (const vp of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "phone", width: 390, height: 844 },
  ]) {
    test(`fits the ${vp.name} layout without crowding out the list`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(browseUrl());
      const panel = overview(page);
      await expect(panel.getByText(FIXTURES.files)).toBeVisible({ timeout: 30_000 });
      await page.screenshot({ path: `e2e/.output/screenshots/overview-${vp.width}x${vp.height}.png` });

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);

      await expect(panel.getByRole("button", { name: "Bucket overview" })).toHaveAttribute("aria-expanded", vp.name === "phone" ? "false" : "true");

      const grid = page.getByRole("grid", { name: /^Contents of / });
      const row = grid.getByRole("row").filter({ has: page.getByRole("gridcell") }).first();
      await expect(row).toBeVisible();
      const rowBox = (await row.boundingBox())!;
      expect((vp.height - rowBox.y) / rowBox.height).toBeGreaterThanOrEqual(5);
    });
  }
});
