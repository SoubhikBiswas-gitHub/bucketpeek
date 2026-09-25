import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { browseUrl, hydrated, stage, viewUrl } from "./helpers";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function expectNoViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(WCAG)
    // The Next.js dev tools badge only exists under `next dev`.
    .exclude("nextjs-portal")
    .analyze();
  const found = results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")) }));
  expect(found).toEqual([]);
}

const rowCheckbox = (page: Page, name: string) => page.getByRole("checkbox", { name: `Select ${name}`, exact: true });

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

test.describe("axe", () => {
  test("folder listing", async ({ page }) => {
    await page.goto(browseUrl("Factory/"));
    await hydrated(rowCheckbox(page, "README.md"));
    await expectNoViolations(page);
  });

  test("selection bar with two items selected", async ({ page }) => {
    await page.goto(browseUrl("Factory/"));
    await hydrated(rowCheckbox(page, "README.md"));
    await rowCheckbox(page, "README.md").click();
    await rowCheckbox(page, "summary.pdf").click();
    const bar = page.getByRole("toolbar", { name: "Selected items" });
    await expect(bar).toContainText("2 selected");
    // Two Tab stops that do the same thing get distinct names.
    await expect(bar.getByRole("checkbox", { name: "Select all", exact: true })).toBeVisible();
    await expect(bar.getByRole("button", { name: /^Select all \d+ items$/ })).toBeVisible();
    await expectNoViolations(page);
  });

  test("Markdown file", async ({ page }) => {
    await page.goto(viewUrl("Factory/README.md"));
    await expect(stage(page, "README.md")).toBeVisible();
    await hydrated(page.getByRole("button", { name: "File details" }));
    await expectNoViolations(page);
  });

  test("video file", async ({ page }) => {
    await page.goto(viewUrl("Factory/episode_0001_pick_and_place.mp4"));
    await expect(page.locator("[data-media-player]")).toBeVisible();
    await hydrated(page.getByRole("button", { name: "File details" }));
    await expectNoViolations(page);
  });

  test("File details sheet", async ({ page }) => {
    await page.goto(viewUrl("Factory/episode_0001_pick_and_place.mp4"));
    const open = page.getByRole("button", { name: "File details" });
    await hydrated(open);
    await open.click();
    const sheet = page.getByRole("dialog", { name: "File details" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("status", { name: /^Loading/ })).toHaveCount(0);
    await expect(sheet.getByRole("heading", { name: "Video", exact: true })).toBeVisible();
    await expectNoViolations(page);
  });

  test("command palette, after moving and then typing", async ({ page }) => {
    await page.goto(browseUrl("Factory/"));
    const trigger = page.getByRole("button", { name: "Search files and folders" }).first();
    const input = page.getByRole("dialog").getByRole("combobox");
    // The menu listens for the trigger's event only once its own Suspense boundary has hydrated.
    await expect(async () => {
      await trigger.click();
      await expect(input).toBeFocused({ timeout: 1_000 });
    }).toPass();
    await expect(page.getByRole("option").first()).toBeVisible();
    await expectNoViolations(page);

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.type("readme");
    await expect(page.getByRole("option", { name: /README\.md/ }).first()).toBeVisible();
    await expect(page.getByRole("option")).not.toHaveCount(0);
    // The active item was filtered out; the input must point at the one now selected.
    const active = page.getByRole("option", { selected: true });
    await expect(input).toHaveAttribute("aria-activedescendant", (await active.getAttribute("id"))!);
    await expectNoViolations(page);

    await input.fill("zzzz");
    await expect(page.getByText("No matches for “zzzz”")).toBeVisible();
    await expectNoViolations(page);
  });

  test("bucket health", async ({ page }) => {
    await page.goto("/health");
    await expect(page.getByRole("region", { name: "Bucket overview" }).getByText("17 files")).toBeVisible({ timeout: 30_000 });
    await expectNoViolations(page);
  });
});

// Tabs from the top of the page to the first element matching `selector` and reports the outline
// drawn for it, on `ringOn` (the element itself, or its parent).
async function tabToRing(page: Page, selector: string, ringOn: "self" | "parent" = "self") {
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  // Safari's Tab skips buttons and checkboxes unless the user opts in; Option-Tab reaches them.
  const tab = page.context().browser()?.browserType().name() === "webkit" ? "Alt+Tab" : "Tab";
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press(tab);
    const ring = await page.evaluate(
      ([sel, on]) => {
        const el = document.activeElement;
        if (!el?.matches(sel)) return null;
        const s = getComputedStyle(on === "parent" ? el.parentElement! : el);
        return { focusVisible: el.matches(":focus-visible"), style: s.outlineStyle, width: s.outlineWidth };
      },
      [selector, ringOn] as const,
    );
    if (ring) return ring;
  }
  return null;
}

test.describe("keyboard", () => {
  test("a checkbox shows a focus ring when reached with Tab", async ({ page }) => {
    await page.goto(browseUrl("Factory/"));
    await hydrated(rowCheckbox(page, "README.md"));
    expect(await tabToRing(page, "[data-slot=checkbox]")).toEqual({ focusVisible: true, style: "solid", width: "2px" });
  });

  test("the video player shows a focus ring when reached with Tab", async ({ page }) => {
    await page.goto(viewUrl("Factory/episode_0001_pick_and_place.mp4"));
    await expect(page.locator("[data-media-player][data-can-play]")).toBeVisible();
    await hydrated(page.getByRole("button", { name: "File details" }));
    expect(await tabToRing(page, "[data-media-player]", "parent")).toEqual({ focusVisible: true, style: "solid", width: "2px" });
  });

  test("on a phone, closing File details returns focus to the File actions button", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(viewUrl("Factory/README.md"));
    const menu = page.getByRole("button", { name: "File actions" });
    await hydrated(menu);
    await menu.click();
    await page.getByRole("menuitem", { name: "File details" }).click();
    const sheet = page.getByRole("dialog", { name: "File details" });
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(menu).toBeFocused();
  });
});
