import { expect, test, type Locator, type Page } from "@playwright/test";
import { clipboardPermissions, hydrated, MOCK, readClipboard, stage, viewUrl } from "./helpers";

async function open(page: Page, key: string) {
  await page.goto(viewUrl(key));
  const name = key.slice(key.lastIndexOf("/") + 1);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  return stage(page, name);
}

test.describe("viewer renders every fixture type", () => {
  test("mp4 gets a video element with a playable source", async ({ page }) => {
    // Playwright's Chromium has no H.264/AAC decoders, so check the source rather than decoding.
    const s = await open(page, "Factory/episode_0001_pick_and_place.mp4");
    const video = s.locator("video");
    await expect(video).toHaveCount(1);
    let src = "";
    // The player attaches its source after hydration, which can be slow on a cold server.
    await expect
      .poll(async () => (src = await video.evaluate((v: HTMLVideoElement) => v.currentSrc || v.src || v.querySelector("source")?.src || "")), {
        timeout: 30_000,
      })
      .not.toBe("");
    const res = await page.request.get(src, { headers: { Range: "bytes=0-1023" } });
    expect([200, 206]).toContain(res.status());
    expect(res.headers()["content-type"]).toMatch(/video\/mp4/);
  });

  test("webm plays in a video element", async ({ page }) => {
    const s = await open(page, "Factory/episode_0003_forklift_route_b.webm");
    const video = s.locator("video");
    await expect(video).toHaveCount(1);
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(1);
  });

  test("avi offers conversion or plays converted", async ({ page }) => {
    const s = await open(page, "Factory/episode_0002_conveyor_sort.avi");
    await expect(
      s.locator("video").or(s.getByRole("button", { name: /convert|play/i })).or(s.getByText(/convert/i)).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("png renders as an image", async ({ page }) => {
    const s = await open(page, "Factory/frame_0001.png");
    const img = s.getByRole("img", { name: /frame_0001\.png/ });
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1920);
  });

  test("jpg renders as an image", async ({ page }) => {
    const s = await open(page, "Construction/crane_view.jpg");
    await expect(s.getByRole("img", { name: /crane_view\.jpg/ })).toBeVisible();
  });

  test("mp3 shows an audio player", async ({ page }) => {
    const s = await open(page, "Factory/operator_notes.mp3");
    await expect(s.getByRole("button", { name: /play/i }).first()).toBeVisible();
  });

  test("pdf is embedded, or offered to open where the browser has no PDF viewer", async ({ page }) => {
    const s = await open(page, "Factory/summary.pdf");
    const embedded = s.locator("iframe, embed, object").first();
    const openLink = s.getByRole("link", { name: /open pdf/i });
    await expect(embedded.or(openLink).first()).toBeAttached();
    // Headless Chromium has no PDF plugin, so the fallback link is what renders there.
    if (await openLink.count()) {
      const res = await page.request.get((await openLink.getAttribute("href"))!);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toMatch(/application\/pdf/);
    }
  });

  test("markdown renders headings and tables", async ({ page }) => {
    const s = await open(page, "Factory/README.md");
    await expect(s.getByRole("heading", { name: "Factory episodes" })).toBeVisible();
    await expect(s.getByRole("table")).toBeVisible();
    await expect(s.getByRole("cell", { name: "Packing" })).toBeVisible();
    await expect(s.getByText('print("hello")').first()).toBeVisible();
  });

  test("json is shown structured", async ({ page }) => {
    const s = await open(page, "Factory/episodes_index.json");
    await expect(s.getByText(/episodes/).first()).toBeVisible();
    await expect(s.getByText(/packing/).first()).toBeVisible();
  });

  test("csv renders as a table", async ({ page }) => {
    const s = await open(page, "Factory/raw_episodes_index.csv");
    await expect(s.getByRole("columnheader", { name: "episode_id" })).toBeVisible();
    await expect(s.getByRole("columnheader", { name: "quality" })).toBeVisible();
    await expect.poll(() => s.getByRole("row").count()).toBeGreaterThan(10);
  });

  test("python is syntax highlighted", async ({ page }) => {
    const s = await open(page, "Factory/load_index.py");
    await expect(s.getByText(/Load an index file/).first()).toBeVisible();
    // Highlighted means tokens are drawn in several different colours.
    const colours = () =>
      s.evaluate((root) => {
        const seen = new Set<string>();
        for (const el of root.querySelectorAll("*")) {
          const own = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
          if (own) seen.add(getComputedStyle(el).color);
        }
        return seen.size;
      });
    await expect.poll(colours).toBeGreaterThanOrEqual(3);
  });

  test("log shows its lines", async ({ page }) => {
    const s = await open(page, "Factory/capture.log");
    await expect(s.getByText(/ERROR camera 3 lost sync/)).toBeVisible();
    await expect(s.getByText(/WARN\s+camera 2 dropped 3 frames/)).toBeVisible();
  });

  for (const key of ["Factory/calibration.zip", "Factory/sensor_dump.bin"]) {
    test(`${key.split("/")[1]} has no preview but can be downloaded`, async ({ page }) => {
      const s = await open(page, key);
      await expect(s.getByText(/no preview/i).first()).toBeVisible();
      await expect(page.getByRole("link", { name: /download/i }).first()).toBeVisible();
    });
  }
});

test.describe("viewer navigation and errors", () => {
  test("next and previous move between files in the folder", async ({ page }) => {
    await page.goto(viewUrl("Factory/episode_0001_pick_and_place.mp4"));
    const nav = page.getByRole("navigation", { name: /files in this folder|file navigation/i });

    const next = nav.getByRole("link", { name: /^next file:/i });
    const nextName = ((await next.getAttribute("aria-label")) ?? "").replace(/^next file:\s*/i, "");
    expect(nextName).not.toBe("");
    await next.click();
    await expect(page).toHaveURL(new RegExp(`key=Factory%2F${encodeURIComponent(nextName).replace(/\./g, "\\.")}`));
    await expect(page.getByRole("heading", { name: nextName })).toBeVisible();

    await nav.getByRole("link", { name: /^previous file:/i }).click();
    await expect(page).toHaveURL(/key=Factory%2Fepisode_0001_pick_and_place\.mp4/);
  });

  test("leaving a converted video while hls.js is still loading raises no page error", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.stack ?? e.message));
    // Hold the hls.js chunk so the player is gone before the library arrives.
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const hlsChunk = /\/_next\/static\/.*hls_js/;
    await page.route(hlsChunk, async (route) => {
      await held;
      await route.continue();
    });
    await page.addInitScript(() =>
      document.addEventListener("hls-lib-load-start", () => document.documentElement.setAttribute("data-hls-loading", ""), true),
    );

    await page.goto(viewUrl("Factory/episode_0002_conveyor_sort.avi"));
    await expect(page.locator("html[data-hls-loading]")).toBeAttached({ timeout: 45_000 });
    const next = page.getByRole("navigation", { name: /files in this folder|file navigation/i }).getByRole("link", { name: /^next file:/i });
    await hydrated(next);
    await next.click();
    await expect(page).not.toHaveURL(/conveyor_sort/);

    const delivered = page.waitForEvent("requestfinished", (r) => hlsChunk.test(r.url()));
    release();
    await delivered;
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(errors).toEqual([]);
  });

  test("arrow keys navigate too", async ({ page }) => {
    await page.goto(viewUrl("Factory/README.md"));
    await expect(page.getByRole("heading", { name: "README.md" })).toBeVisible();
    // Keys pressed before hydration do nothing, so retry until the handler is live.
    await expect(async () => {
      await page.keyboard.press("ArrowRight");
      await expect(page).not.toHaveURL(/README\.md/, { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await expect(async () => {
      await page.keyboard.press("ArrowLeft");
      await expect(page).toHaveURL(/README\.md/, { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
  });

  test("a missing key shows File not found", async ({ page }) => {
    await page.goto(viewUrl("Factory/does_not_exist.mp4"));
    await expect(page.getByRole("heading", { name: "File not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: /back to folder/i })).toBeVisible();
  });

  test("download link responds with the file as an attachment", async ({ page, isMobile }) => {
    await page.goto(viewUrl("Factory/README.md"));
    let link = page.getByRole("link", { name: /download/i }).first();
    if (isMobile) {
      // Phones fold every file action into one menu.
      const menu = page.getByRole("button", { name: "File actions" });
      await hydrated(menu);
      await menu.click();
      link = page.getByRole("menuitem", { name: /download/i });
    }
    const href = await link.getAttribute("href");
    expect(href).toBeTruthy();
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"] ?? "").toMatch(/attachment/);
    expect(await res.text()).toContain("# Factory episodes");
  });
});

test.describe("viewer AWS CLI command", () => {
  test.use({ permissions: clipboardPermissions });
  const command = `aws s3 cp 's3://${MOCK.bucket}/Factory/README.md' .`;

  test("the file actions copy an aws s3 cp command", async ({ page }) => {
    await open(page, "Factory/README.md");
    const button = page.getByRole("group", { name: "File actions" }).getByRole("button", { name: "Copy AWS CLI command" });
    await hydrated(button);
    await button.click();
    await expect(page.getByText("Copied AWS CLI command")).toBeVisible();
    expect(await readClipboard(page)).toBe(command);
  });

  test("the phone menu offers it too", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "Factory/README.md");
    const menu = page.getByRole("button", { name: "File actions" });
    await hydrated(menu);
    await menu.click();
    await page.getByRole("menuitem", { name: "Copy AWS CLI command" }).click();
    await expect(page.getByText("Copied AWS CLI command")).toBeVisible();
    expect(await readClipboard(page)).toBe(command);
  });
});

test.describe("file details sheet", () => {
  test.use({ permissions: clipboardPermissions });

  async function openDetails(page: Page, key: string) {
    await page.goto(viewUrl(key));
    const phone = (page.viewportSize()?.width ?? 1280) < 640;
    // Phones reach it through the actions menu; wider screens have a button.
    const trigger = page.getByRole("button", { name: phone ? "File actions" : "File details" }).last();
    await hydrated(trigger);
    await trigger.click();
    if (phone) await page.getByRole("menuitem", { name: "File details" }).click();
    const sheet = page.getByRole("dialog", { name: "File details" });
    await expect(sheet).toBeVisible();
    return sheet;
  }

  // Elements sticking out of the sheet, and anything that scrolls sideways: should be none.
  const overflow = (sheet: Locator) =>
    sheet.evaluate((root) => {
      const box = root.getBoundingClientRect();
      // Screen-reader-only text is clipped to 1px on purpose.
      const all = [root, ...root.querySelectorAll<HTMLElement>("*")].filter((el) => !el.closest(".sr-only"));
      const wide = all
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 1 && (r.right > box.right + 0.5 || r.left < box.left - 0.5);
        })
        .map((el) => el.outerHTML.slice(0, 120));
      const scrolls = all
        .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible")
        .map((el) => `scrolls: ${el.outerHTML.slice(0, 120)}`);
      return [...wide, ...scrolls];
    });

  test("an mp4 shows its video facts, each one copyable", async ({ page }) => {
    // From `ffprobe -show_format -show_streams fixtures/bucket/Factory/episode_0001_pick_and_place.mp4`
    // (scripts/make-fixtures.sh): h264 High@3.1 (avc1.64001f), 1280x720 at 30/1, 8.000000 s; aac LC 48 kHz mono.
    const sheet = await openDetails(page, "Factory/episode_0001_pick_and_place.mp4");
    const video = sheet.getByRole("region", { name: "Video" });
    await expect(video.getByText("h264", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(video.getByText("(High, level 3.1)")).toBeVisible();
    await expect(video.getByText("1280 × 720", { exact: true })).toBeVisible();
    await expect(video.getByText("0:00:08", { exact: true })).toBeVisible();
    await expect(video.getByText("30 fps", { exact: true })).toBeVisible();
    await expect(video.getByText("aac", { exact: true })).toBeVisible();
    await expect(video.getByText("48 kHz", { exact: true })).toBeVisible();

    await video.getByRole("button", { name: "Copy video stream resolution" }).click();
    await expect.poll(() => readClipboard(page)).toBe("1280x720");
    await video.getByRole("button", { name: "Copy video stream codec string" }).click();
    await expect.poll(() => readClipboard(page)).toBe("avc1.64001f");

    // Local files have no S3 extras; the health line shows either way.
    await expect(sheet.getByRole("region", { name: "S3 object" }).getByText(/no S3 object metadata/)).toBeVisible();
    await expect(sheet.getByRole("region", { name: "Health" }).getByText("Bucket check", { exact: true })).toBeVisible();
  });

  test("a document has no Video section", async ({ page }) => {
    const sheet = await openDetails(page, "Factory/README.md");
    await expect(sheet.getByRole("region", { name: "S3 object" }).getByText(/no S3 object metadata/)).toBeVisible();
    await expect(sheet.getByRole("region", { name: "Video" })).toHaveCount(0);
    await expect(sheet.getByRole("region", { name: "Health" })).toHaveCount(0);
  });

  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`fits ${size.width}x${size.height} without sideways overflow`, async ({ page }) => {
      await page.setViewportSize(size);
      const sheet = await openDetails(page, "Factory/episode_0001_pick_and_place.mp4");
      await expect(sheet.getByRole("region", { name: "Video" }).getByText("h264", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(sheet.getByRole("region", { name: "Health" }).getByText("Bucket check", { exact: true })).toBeVisible();
      // Measure after the slide-in has finished.
      await expect.poll(() => sheet.evaluate((el) => el.getAnimations().length)).toBe(0);
      expect(await overflow(sheet)).toEqual([]);
      const shot = (part: string) => page.screenshot({ path: `e2e/.output/screenshots/file-details-${size.width}x${size.height}-${part}.png` });
      await shot("top");

      // Video facts run past any screen, so the body scrolls to reach them.
      const body = sheet.getByTestId("file-details-body");
      expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      await sheet.getByRole("heading", { name: "Video", exact: true }).evaluate((el) => el.scrollIntoView({ block: "start" }));
      await shot("video");
      await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await expect(sheet.getByRole("region", { name: "Health" })).toBeInViewport();
      await shot("end");
    });
  }
});
