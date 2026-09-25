import { expect, test } from "@playwright/test";
import { browseUrl, entry, hydrated } from "./helpers";

test.describe("browse", () => {
  test("root lists the top-level folders", async ({ page }) => {
    await page.goto("/browse");
    for (const name of ["Construction", "Factory", "empty_folder"]) {
      await expect(entry(page, name)).toBeVisible();
    }
  });

  test("opening Factory/ lists its folders and files", async ({ page }) => {
    await page.goto("/browse");
    await entry(page, "Factory").click();
    await expect(page).toHaveURL(/prefix=Factory%2F/);
    for (const name of ["annotated", "episodes", "README.md", "episode_0001_pick_and_place.mp4", "summary.pdf"]) {
      await expect(entry(page, name)).toBeVisible();
    }
    // Breadcrumbs lead back to the root.
    await expect(page.getByRole("navigation", { name: /folder path|breadcrumb/i })).toContainText("Factory");
  });

  test("an empty folder says so", async ({ page }) => {
    await page.goto(browseUrl("empty_folder/"));
    await expect(page.getByText(/empty|no files/i).first()).toBeVisible();
    await expect(page.getByText(".keep")).toHaveCount(0);
  });

  test("search filter narrows the listing", async ({ page }) => {
    await page.goto(browseUrl("Factory/"));
    await expect(entry(page, "README.md")).toBeVisible();

    const search = page
      .getByRole("searchbox")
      .or(page.getByRole("textbox", { name: /filter|search/i }))
      .or(page.getByPlaceholder(/filter|search/i))
      .first();
    // Typing before hydration commits is ignored (and React then dedupes the same value), so clear
    // and retype until the debounced ?q= proves React has the query.
    await expect(async () => {
      await search.fill("");
      await search.fill("episode_000");
      await expect(page).toHaveURL(/[?&]q=episode_000/, { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    await expect(entry(page, "episode_0001_pick_and_place.mp4")).toBeVisible();
    await expect(entry(page, "episode_0003_forklift_route_b.webm")).toBeVisible();
    await expect(entry(page, "README.md")).toBeHidden();
    await expect(entry(page, "summary.pdf")).toBeHidden();

    await search.fill("");
    await expect(entry(page, "README.md")).toBeVisible();
  });

  test("opening a file from the list goes to its viewer", async ({ page }) => {
    await page.goto(browseUrl("Factory/"));
    // A click before hydration is lost (rows open files from a client-side handler).
    await hydrated(entry(page, "README.md"));
    await entry(page, "README.md").click();
    await expect(page).toHaveURL(/\/view\?key=Factory%2FREADME\.md/);
    await expect(page.getByRole("heading", { name: "README.md" })).toBeVisible();
  });
});
