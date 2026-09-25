import { expect, test, type Page } from "@playwright/test";
import { browseUrl, clipboardPermissions, escapeRe, hydrated, MOCK, readClipboard } from "./helpers";

const bar = (page: Page) => page.getByRole("toolbar", { name: "Selected items" });
const rowCheckbox = (page: Page, name: string) => page.getByRole("checkbox", { name: `Select ${name}`, exact: true });

// The folder's entry count from the "All" filter; a phone's virtualized list renders fewer rows than that.
async function entryCount(page: Page): Promise<number> {
  const text = await page.getByRole("radio", { name: /^All, \d+$/ }).innerText();
  return Number(text.match(/\d+/)?.[0]);
}

// Under `next dev`, the Next.js dev tools badge sits over the bottom-left corner and swallows
// clicks on the last visible row's checkbox. It doesn't exist in production; let clicks through.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal { pointer-events: none !important; }";
      document.head.append(style);
    });
  });
});

test.describe("selection", () => {
  test.use({ permissions: clipboardPermissions });

  test.beforeEach(async ({ page }) => {
    await page.goto(browseUrl("Factory/"));
    await hydrated(rowCheckbox(page, "README.md"));
  });

  test("checkboxes select items and the bar counts them", async ({ page }) => {
    await expect(bar(page)).toHaveCount(0);
    await rowCheckbox(page, "README.md").click();
    await rowCheckbox(page, "summary.pdf").click();
    await expect(bar(page)).toContainText("2 selected");
    await expect(page.getByRole("row", { selected: true })).toHaveCount(2);
    // Clicking a checkbox never opens the file.
    await expect(page).toHaveURL(/\/browse/);
  });

  test("Shift-click selects a range", async ({ page }) => {
    const names = await page.getByRole("row").filter({ has: page.getByRole("checkbox") }).allInnerTexts();
    expect(names.length).toBeGreaterThan(5);
    const rows = page.getByRole("row").filter({ has: page.getByRole("gridcell") });
    await rows.nth(1).getByRole("checkbox").click();
    await rows.nth(4).getByRole("checkbox").click({ modifiers: ["Shift"] });
    await expect(bar(page)).toContainText("4 selected");
  });

  test("select all, then Escape clears", async ({ page, isMobile }) => {
    test.skip(isMobile, "Phones have no column header, so no Select all checkbox.");
    const total = await entryCount(page);
    await page.getByRole("columnheader").getByRole("checkbox", { name: "Select all" }).click();
    await expect(bar(page)).toContainText(`${total} selected`);
    await page.getByRole("row", { selected: true }).first().focus();
    await page.keyboard.press("Escape");
    await expect(bar(page)).toHaveCount(0);
  });

  test("Space and Ctrl/Cmd+A work from the keyboard", async ({ page }) => {
    const rows = page.getByRole("row").filter({ has: page.getByRole("gridcell") });
    await rows.first().focus();
    await page.keyboard.press("Space");
    await expect(bar(page)).toContainText("1 selected");
    await page.keyboard.press("ControlOrMeta+a");
    await expect(bar(page)).toContainText(`${await entryCount(page)} selected`);
  });

  test("Copy S3 paths puts one s3:// URI per line on the clipboard", async ({ page }) => {
    await rowCheckbox(page, "README.md").click();
    await rowCheckbox(page, "episodes").click();
    await bar(page).getByRole("button", { name: "Copy S3 paths" }).click();
    await expect(page.getByText("Copied 2 S3 paths")).toBeVisible();
    const lines = (await readClipboard(page)).split("\n").sort();
    expect(lines).toEqual([`s3://${MOCK.bucket}/Factory/README.md`, `s3://${MOCK.bucket}/Factory/episodes/`]);
  });

  test("Copy S3 links copies working presigned links for files and skips folders", async ({ page, request }) => {
    await rowCheckbox(page, "README.md").click();
    await rowCheckbox(page, "summary.pdf").click();
    await rowCheckbox(page, "episodes").click();
    await bar(page).getByRole("button", { name: "Copy S3 links" }).click();
    await page.getByRole("dialog", { name: "Copy 2 links" }).getByRole("button", { name: "Copy 2 links" }).click();
    await expect(page.getByText("Copied 2 S3 links")).toBeVisible();
    await expect(page.getByText("1 folder skipped.")).toBeVisible();
    const links = (await readClipboard(page)).split("\n");
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toMatch(/^https?:\/\//);
      // A link works on its own, without the app's session.
      const res = await request.get(link, { headers: { cookie: "" } });
      expect(res.status(), link).toBe(200);
    }
  });

  test("the row menu offers a presigned S3 link", async ({ page }) => {
    await page.getByRole("row", { name: /README\.md/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Copy S3 link" }).click();
    await page.getByRole("dialog", { name: "Copy link" }).getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByText("Copied 1 S3 link")).toBeVisible();
    expect(await readClipboard(page)).toMatch(/README\.md/);
  });

  test("the row menu copies an AWS CLI command for a file", async ({ page }) => {
    await page.getByRole("row", { name: /README\.md/ }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Copy AWS CLI command" }).click();
    await expect(page.getByText("Copied AWS CLI command")).toBeVisible();
    expect(await readClipboard(page)).toBe(`aws s3 cp 's3://${MOCK.bucket}/Factory/README.md' .`);
  });

  test("the row menu copies a recursive AWS CLI command for a folder", async ({ page }) => {
    await page.getByRole("row").filter({ has: rowCheckbox(page, "episodes") }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "Copy AWS CLI command" }).click();
    await expect(page.getByText("Copied AWS CLI command")).toBeVisible();
    expect(await readClipboard(page)).toBe(`aws s3 cp --recursive 's3://${MOCK.bucket}/Factory/episodes/' './episodes/'`);
  });

  test("Copy AWS CLI commands puts one aws s3 cp line per item on the clipboard", async ({ page }) => {
    await rowCheckbox(page, "README.md").click();
    await rowCheckbox(page, "summary.pdf").click();
    await rowCheckbox(page, "episodes").click();
    await bar(page).getByRole("button", { name: "Copy AWS CLI commands" }).click();
    await expect(page.getByText("Copied 3 AWS CLI commands")).toBeVisible();
    const lines = (await readClipboard(page)).split("\n").sort();
    expect(lines).toEqual(
      [
        `aws s3 cp --recursive 's3://${MOCK.bucket}/Factory/episodes/' './episodes/'`,
        `aws s3 cp 's3://${MOCK.bucket}/Factory/README.md' .`,
        `aws s3 cp 's3://${MOCK.bucket}/Factory/summary.pdf' .`,
      ].sort(),
    );
  });

  test("grid tiles select too", async ({ page, isMobile }) => {
    await page.goto(browseUrl("Factory/") + "&view=grid");
    // A phone's two-column grid only renders the first few tiles.
    const name = isMobile ? "calibration.zip" : "README.md";
    const cell = page.getByRole("gridcell", { name: new RegExp(`^${escapeRe(name)}`) });
    await hydrated(cell);
    await hydrated(rowCheckbox(page, name));
    await cell.hover();
    await rowCheckbox(page, name).click();
    await expect(bar(page)).toContainText("1 selected");
    await expect(page.getByRole("gridcell", { selected: true })).toHaveCount(1);
  });
});

/** The mock-mode-only cookie that lowers the download limits (MOCK_LIMITS_COOKIE); fixture files are tiny. */
const LIMITS_COOKIE = "lens-mock-download-limits";
const downloadButton = (page: Page) => bar(page).getByRole("button", { name: "Download", exact: true });

test.describe("bulk download", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(browseUrl("Factory/"));
    await hydrated(rowCheckbox(page, "README.md"));
  });

  test("within the budget, Download starts one download per file and skips folders", async ({ page }) => {
    await rowCheckbox(page, "README.md").click();
    await rowCheckbox(page, "summary.pdf").click();
    await rowCheckbox(page, "episodes").click();
    // 204 B + 17,466 B.
    await expect(bar(page)).toContainText("17.6 kB of 1 GB");
    await expect(downloadButton(page)).toBeEnabled();
    await expect(downloadButton(page)).toHaveAccessibleDescription("17.6 kB of 1 GB");

    const names: string[] = [];
    page.on("download", (d) => names.push(d.suggestedFilename()));
    const first = page.waitForEvent("download");
    await downloadButton(page).click();
    await expect(page.getByText("Downloading 2 files · 17.6 kB")).toBeVisible();
    await expect(page.getByText("1 folder skipped.", { exact: false })).toBeVisible();
    expect(["README.md", "summary.pdf"]).toContain((await first).suggestedFilename());
    await expect.poll(() => [...names].sort()).toEqual(["README.md", "summary.pdf"]);
  });

  test("folders alone can't be downloaded, and the bar says why", async ({ page }) => {
    await rowCheckbox(page, "episodes").click();
    await expect(downloadButton(page)).toBeDisabled();
    await expect(bar(page).getByText("No files selected")).toBeVisible();
    await expect(downloadButton(page)).toHaveAccessibleDescription("Folders can’t be downloaded. Select files to download them.");
    // The full reason is also the tooltip.
    await downloadButton(page).hover();
    await expect(page.getByRole("tooltip")).toContainText("Folders can’t be downloaded");
    await expect(bar(page)).not.toContainText(" of 1 GB");
  });

  test.describe("with lowered limits", () => {
    test.beforeEach(async ({ context, page, baseURL }) => {
      await context.addCookies([{ name: LIMITS_COOKIE, value: "maxBytes=1000&maxFiles=2", url: baseURL! }]);
      await page.reload();
      await hydrated(rowCheckbox(page, "README.md"));
    });

    test("over the size budget, Download is disabled with the reason visible", async ({ page }) => {
      await rowCheckbox(page, "README.md").click();
      await expect(bar(page)).toContainText("204 B of 1 kB");
      await expect(downloadButton(page)).toBeEnabled();

      // Selecting past the budget is never blocked; only Download is.
      await rowCheckbox(page, "summary.pdf").click();
      await expect(bar(page)).toContainText("2 selected");
      await expect(bar(page)).toContainText("17.6 kB of 1 kB");
      await expect(downloadButton(page)).toBeDisabled();
      const reason = "Selection is 17.6 kB. Bulk download is limited to 1 kB — deselect files, download them one at a time, or copy AWS CLI commands.";
      await expect(bar(page).getByText(reason)).toBeVisible();
      await expect(downloadButton(page)).toHaveAccessibleDescription(reason);
      // The reason points at the CLI, which stays available over the limit.
      await expect(bar(page).getByRole("button", { name: "Copy AWS CLI commands" })).toBeEnabled();

      // A click does nothing (the button stays focusable so the reason can be reached).
      let downloads = 0;
      page.on("download", () => downloads++);
      await downloadButton(page).click({ force: true });
      await expect(page.getByText(/^Downloading/)).toHaveCount(0);
      expect(downloads).toBe(0);

      // Deselecting brings it back within the budget.
      await rowCheckbox(page, "summary.pdf").click();
      await expect(downloadButton(page)).toBeEnabled();
      await expect(bar(page).getByText(reason)).toHaveCount(0);
    });

    test("over the file count, Download is disabled with the reason visible", async ({ page }) => {
      await rowCheckbox(page, "README.md").click();
      await rowCheckbox(page, "capture.log").click();
      await rowCheckbox(page, "load_index.py").click();
      await expect(downloadButton(page)).toBeDisabled();
      await expect(bar(page).getByText(/Up to 2 files at once/)).toBeVisible();
    });
  });

  test("the bar fits a 390 px wide screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await rowCheckbox(page, "README.md").click();
    await rowCheckbox(page, "episodes").click();
    await expect(downloadButton(page)).toBeVisible();
    const overflow = await bar(page).evaluate((el) => ({
      bar: el.scrollWidth - el.clientWidth,
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    expect(overflow).toEqual({ bar: 0, page: 0 });
  });
});
