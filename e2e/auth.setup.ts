import { test as setup } from "@playwright/test";
import { connect } from "./helpers";

/** Connects once and saves the session cookie for every other spec. */
setup("connect to the mock bucket", async ({ page }) => {
  await connect(page);
  await page.context().storageState({ path: "e2e/.auth/connected.json" });
});
