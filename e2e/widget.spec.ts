import { expect, test } from "@playwright/test";
import { generateTestData, type TestData } from "./mocks/test-data.ts";
import { setupInstantWsMock } from "./mocks/instant-ws.ts";
import { setupBackendApiMock } from "./mocks/backend-api.ts";
import { setupGcsMock } from "./mocks/gcs.ts";

const tid = (id: string) => `[data-testid="${id}"]`;
let data: TestData;

test.beforeAll(async () => {
  data = await generateTestData();
});

const setupMocks = async (page: import("@playwright/test").Page, extra: Record<string, unknown> = {}) => {
  await setupInstantWsMock(page, data);
  await setupBackendApiMock(page, data);
  await setupGcsMock(page);
  await page.addInitScript((params: Record<string, unknown>) => {
    (window as any).__WIDGET_PARAMS__ = params;
  }, { participants: [data.bob.publicSignKey], initialMessage: "Hi from widget!", ...extra });
};

test.describe("Widget", () => {
  test("start button renders with data-testid", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/widget-harness.html");
    await expect(page.locator(tid("widget-start-button"))).toBeVisible({ timeout: 10_000 });
  });

  test("click opens name dialog for unauthenticated user", async ({ page }) => {
    await setupMocks(page);
    await page.addInitScript(() => localStorage.removeItem("aliceAndBotCredentials"));
    await page.goto("/widget-harness.html");
    await page.locator(tid("widget-start-button")).click({ timeout: 10_000 });
    await expect(page.locator(tid("name-dialog-title"))).toBeVisible({ timeout: 5_000 });
  });

  test("name dialog submits and stores credentials", async ({ page }) => {
    await setupMocks(page);
    await page.addInitScript(() => localStorage.removeItem("aliceAndBotCredentials"));
    await page.goto("/widget-harness.html");
    await page.locator(tid("widget-start-button")).click({ timeout: 10_000 });
    await expect(page.locator(tid("name-dialog-title"))).toBeVisible({ timeout: 5_000 });
    await page.getByPlaceholder("Your name").fill("WidgetTestUser");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForTimeout(3000);
    const stored = await page.evaluate(() => localStorage.getItem("aliceAndBotCredentials"));
    expect(stored).not.toBeNull();
  });

  test("cancel button closes name dialog", async ({ page }) => {
    await setupMocks(page);
    await page.addInitScript(() => localStorage.removeItem("aliceAndBotCredentials"));
    await page.goto("/widget-harness.html");
    await page.locator(tid("widget-start-button")).click({ timeout: 10_000 });
    await expect(page.locator(tid("name-dialog-title"))).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator(tid("name-dialog-title"))).not.toBeVisible();
  });

  test("empty name shows error toast", async ({ page }) => {
    await setupMocks(page);
    await page.addInitScript(() => localStorage.removeItem("aliceAndBotCredentials"));
    await page.goto("/widget-harness.html");
    await page.locator(tid("widget-start-button")).click({ timeout: 10_000 });
    await expect(page.locator(tid("name-dialog-title"))).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText(/enter your name/i)).toBeVisible({ timeout: 3_000 });
  });

  test("escape closes name dialog", async ({ page }) => {
    await setupMocks(page);
    await page.addInitScript(() => localStorage.removeItem("aliceAndBotCredentials"));
    await page.goto("/widget-harness.html");
    await page.locator(tid("widget-start-button")).click({ timeout: 10_000 });
    await expect(page.locator(tid("name-dialog-title"))).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Escape");
    await expect(page.locator(tid("name-dialog-title"))).not.toBeVisible();
  });

  test("shadow DOM host element is attached", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/widget-harness.html");
    await expect(page.locator(tid("widget-start-button"))).toBeVisible({ timeout: 10_000 });
    const hasShadow = await page.evaluate(() => {
      const root = document.getElementById("alice-and-bot-widget-root");
      if (!root) return false;
      return Array.from(root.children).some((el: any) => !!el.shadowRoot);
    });
    expect(hasShadow).toBe(true);
  });

  test("startOpen auto-opens with defaultName", async ({ page }) => {
    await setupMocks(page, { startOpen: true, defaultName: "AutoUser" });
    await page.goto("/widget-harness.html");
    await expect(page.locator(tid("widget-close-button"))).toBeVisible({ timeout: 10_000 });
  });

  test("close button hides chat panel and shows start button", async ({ page }) => {
    await setupMocks(page, { startOpen: true, defaultName: "AutoUser" });
    await page.goto("/widget-harness.html");
    await expect(page.locator(tid("widget-close-button"))).toBeVisible({ timeout: 10_000 });
    await page.locator(tid("widget-close-button")).click();
    await expect(page.locator(tid("widget-start-button"))).toBeVisible({ timeout: 5_000 });
  });

  test("escape closes open chat panel", async ({ page }) => {
    await setupMocks(page, { startOpen: true, defaultName: "AutoUser" });
    await page.goto("/widget-harness.html");
    await expect(page.locator(tid("widget-close-button"))).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");
    await expect(page.locator(tid("widget-start-button"))).toBeVisible({ timeout: 5_000 });
  });

  test("custom buttonText renders", async ({ page }) => {
    await setupMocks(page, { buttonText: "Talk to us!" });
    await page.goto("/widget-harness.html");
    await expect(page.locator(tid("widget-start-button"))).toContainText("Talk to us!", { timeout: 10_000 });
  });

  test("host page h1 is not affected by widget", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/widget-harness.html");
    await expect(page.locator("h1")).toContainText("Widget Test Page");
  });

  test("mobile viewport fills screen when open", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await setupMocks(page, { startOpen: true, defaultName: "MobileUser" });
    await page.goto("/widget-harness.html");
    await expect(page.locator(tid("widget-close-button"))).toBeVisible({ timeout: 10_000 });
    const host = page.locator("#alice-and-bot-widget-root > div[dir='ltr']");
    const box = await host.boundingBox();
    if (box) {
      expect(box.width).toBeGreaterThanOrEqual(370);
      expect(box.height).toBeGreaterThanOrEqual(600);
    }
  });

  test("re-open after close works", async ({ page }) => {
    await setupMocks(page, { startOpen: true, defaultName: "AutoUser" });
    await page.goto("/widget-harness.html");
    await expect(page.locator(tid("widget-close-button"))).toBeVisible({ timeout: 10_000 });
    await page.locator(tid("widget-close-button")).click();
    await expect(page.locator(tid("widget-start-button"))).toBeVisible({ timeout: 5_000 });
    await page.locator(tid("widget-start-button")).click();
    await expect(page.locator(tid("widget-close-button"))).toBeVisible({ timeout: 5_000 });
  });

  test("name dialog overlay click closes dialog", async ({ page }) => {
    await setupMocks(page);
    await page.addInitScript(() => localStorage.removeItem("aliceAndBotCredentials"));
    await page.goto("/widget-harness.html");
    await page.locator(tid("widget-start-button")).click({ timeout: 10_000 });
    await expect(page.locator(tid("name-dialog-title"))).toBeVisible({ timeout: 5_000 });
    await page.mouse.click(10, 10);
    await expect(page.locator(tid("name-dialog-title"))).not.toBeVisible();
  });

  test("name input via Enter key submits", async ({ page }) => {
    await setupMocks(page);
    await page.addInitScript(() => localStorage.removeItem("aliceAndBotCredentials"));
    await page.goto("/widget-harness.html");
    await page.locator(tid("widget-start-button")).click({ timeout: 10_000 });
    await expect(page.locator(tid("name-dialog-title"))).toBeVisible({ timeout: 5_000 });
    await page.getByPlaceholder("Your name").fill("EnterUser");
    await page.getByPlaceholder("Your name").press("Enter");
    await page.waitForTimeout(3000);
    const stored = await page.evaluate(() => localStorage.getItem("aliceAndBotCredentials"));
    expect(stored).not.toBeNull();
  });
});
