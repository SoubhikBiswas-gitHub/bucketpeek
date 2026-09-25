import { expect, test } from "@playwright/test";
import { accessKeyInput, bucketInput, connectButton, fillConnectForm, MOCK, secretInput } from "./helpers";

test.describe("setup (signed out)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("unauthenticated /browse redirects to /setup", async ({ page }) => {
    await page.goto("/browse");
    await expect(page).toHaveURL(/\/setup/);
    await expect(page.getByRole("heading", { name: /connect a bucket/i })).toBeVisible();
  });

  test("unauthenticated /view redirects to /setup", async ({ page }) => {
    await page.goto("/view?key=Factory%2FREADME.md");
    await expect(page).toHaveURL(/\/setup/);
  });

  test("empty submit shows a message for every required field", async ({ page }) => {
    await page.goto("/setup");
    await connectButton(page).click();
    await expect(page.getByText("Enter your access key ID.")).toBeVisible();
    await expect(page.getByText("Enter your secret access key.")).toBeVisible();
    await expect(page.getByText("Enter the bucket name.")).toBeVisible();
    await expect(page).toHaveURL(/\/setup/);
    await expect(accessKeyInput(page)).toHaveAttribute("aria-invalid", "true");
  });

  test("the form doesn't ask how long links last: that's chosen when copying", async ({ page }) => {
    await page.goto("/setup");
    await expect(bucketInput(page)).toBeVisible();
    await expect(page.getByText(/link expiry/i)).toHaveCount(0);
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await expect(page.locator('[name="linkExpiry"]')).toHaveCount(0);
  });

  test("bad access key format is rejected", async ({ page }) => {
    await page.goto("/setup");
    await fillConnectForm(page, { ...MOCK, accessKeyId: "AKIA-not-valid!" });
    await connectButton(page).click();
    await expect(page.getByText(/access key ids contain only letters and digits/i)).toBeVisible();
    await expect(page).toHaveURL(/\/setup/);
  });

  test("a pasted secret in the access key field is called out", async ({ page }) => {
    await page.goto("/setup");
    await fillConnectForm(page, { ...MOCK, accessKeyId: MOCK.secretAccessKey });
    await connectButton(page).click();
    await expect(page.getByText(/looks like a secret access key/i)).toBeVisible();
  });

  test("bad bucket name is rejected", async ({ page }) => {
    await page.goto("/setup");
    await fillConnectForm(page, { ...MOCK, bucket: "Bad_Bucket" });
    await connectButton(page).click();
    await expect(page.getByText(/lowercase letters, numbers, dots and hyphens/i)).toBeVisible();
  });

  test("s3:// URLs are accepted as a bucket and connect lands on /browse", async ({ page }) => {
    await page.goto("/setup");
    await accessKeyInput(page).fill(MOCK.accessKeyId);
    await secretInput(page).fill(MOCK.secretAccessKey);
    await bucketInput(page).fill("s3://deccan-demo/Factory/");
    await connectButton(page).click();
    await expect(page).toHaveURL(/\/browse/);
    await expect(page.getByRole("link", { name: /^Factory\b/ }).first()).toBeVisible();
  });
});
