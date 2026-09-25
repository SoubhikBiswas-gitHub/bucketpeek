import { expect, test } from "@playwright/test";
import { connect } from "./helpers";

// Uses its own session so disconnecting doesn't sign out the other specs.
test.use({ storageState: { cookies: [], origins: [] } });

test("disconnect returns to /setup and signs out", async ({ page }) => {
  await connect(page);

  // Disconnect lives in the top bar menu or on the connection settings page.
  let disconnect = page.getByRole("button", { name: /^disconnect$/i }).first();
  if (!(await disconnect.isVisible())) {
    await page.goto("/setup");
    disconnect = page.getByRole("button", { name: /^disconnect$/i }).first();
  }
  await disconnect.click();

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /^disconnect$/i }).click();

  await expect(page).toHaveURL(/\/setup/);
  await expect(page.getByRole("heading", { name: /connect a bucket/i })).toBeVisible();

  await page.goto("/browse");
  await expect(page).toHaveURL(/\/setup/);
});
