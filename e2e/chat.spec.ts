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

const setupMocks = async (page: import("@playwright/test").Page) => {
  const wsMock = await setupInstantWsMock(page, data);
  const apiMock = await setupBackendApiMock(page, data);
  await setupGcsMock(page);
  await page.addInitScript((d: { credentials: { publicSignKey: string; privateSignKey: string; privateEncryptKey: string }; conversationId: string }) => {
    (window as any).__TEST_CREDENTIALS__ = d.credentials;
    (window as any).__TEST_CONVERSATION_ID__ = d.conversationId;
  }, {
    credentials: {
      publicSignKey: data.alice.publicSignKey,
      privateSignKey: data.alice.privateSignKey,
      privateEncryptKey: data.alice.privateEncryptKey,
    },
    conversationId: data.conversationId,
  });
  return { wsMock, apiMock };
};

const waitForChat = async (page: import("@playwright/test").Page) => {
  await expect(page.locator(tid("chat-container"))).toBeVisible({ timeout: 15_000 });
};

test.describe("Chat (full encryption pipeline)", () => {
  test("chat-container renders with data-testid", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await waitForChat(page);
  });

  test("decrypted messages render via data-testid='message'", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await waitForChat(page);
    for (const msg of data.messages) {
      await expect(page.getByText(msg.text)).toBeVisible({ timeout: 15_000 });
    }
    expect(await page.locator(tid("message")).count()).toBeGreaterThanOrEqual(data.messages.length);
  });

  test("message-text elements contain decrypted content", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await waitForChat(page);
    const firstText = page.locator(tid("message-text")).first();
    await expect(firstText).toBeVisible({ timeout: 15_000 });
    await expect(firstText).not.toBeEmpty();
  });

  test("send message flow fires encrypted HTTP POST", async ({ page }) => {
    const { apiMock } = await setupMocks(page);
    await page.goto("/");
    await waitForChat(page);
    const input = page.locator(tid("message-input"));
    await input.fill("Outbound test message");
    await input.press("Enter");
    await expect(page.getByText("Outbound test message")).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(2000);
    expect(apiMock.sentMessages.length).toBeGreaterThan(0);
    expect(apiMock.sentMessages[0].conversation).toBe(data.conversationId);
  });

  test("title-text shows conversation title", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await expect(page.locator(tid("title-text"))).toContainText("Test Conversation", { timeout: 15_000 });
  });

  test("empty conversation shows no messages", async ({ page }) => {
    const emptyData = { ...data, messages: [] };
    await setupInstantWsMock(page, emptyData);
    await setupBackendApiMock(page, emptyData);
    await setupGcsMock(page);
    await page.addInitScript((d: any) => {
      (window as any).__TEST_CREDENTIALS__ = d.credentials;
      (window as any).__TEST_CONVERSATION_ID__ = d.conversationId;
    }, {
      credentials: {
        publicSignKey: data.alice.publicSignKey,
        privateSignKey: data.alice.privateSignKey,
        privateEncryptKey: data.alice.privateEncryptKey,
      },
      conversationId: data.conversationId,
    });
    await page.goto("/");
    await expect(page.locator(tid("message-input"))).toBeVisible({ timeout: 15_000 });
    expect(await page.locator(tid("message")).count()).toBe(0);
  });

  test("real-time message arrival via pushNewMessage", async ({ page }) => {
    const { wsMock } = await setupMocks(page);
    await page.goto("/");
    await waitForChat(page);
    const { generateTestData: gen } = await import("./mocks/test-data.ts");
    const fresh = await gen();
    wsMock.pushNewMessage({
      id: crypto.randomUUID(),
      payload: fresh.messages[0].payload,
      timestamp: Date.now(),
      senderPublicSignKey: data.bob.publicSignKey,
    });
    await expect(page.getByText(fresh.messages[0].text)).toBeVisible({ timeout: 10_000 });
  });

  test("own vs other messages have different x alignment", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await waitForChat(page);
    const aliceMsg = page.getByText(data.messages[0].text);
    const bobMsg = page.getByText(data.messages[1].text);
    await expect(aliceMsg).toBeVisible();
    await expect(bobMsg).toBeVisible();
    const aliceBox = await aliceMsg.boundingBox();
    const bobBox = await bobMsg.boundingBox();
    expect(aliceBox!.x).not.toBe(bobBox!.x);
  });

  test("multiple sends are all captured by mock", async ({ page }) => {
    const { apiMock } = await setupMocks(page);
    await page.goto("/");
    await waitForChat(page);
    const input = page.locator(tid("message-input"));
    for (const t of ["msg-one", "msg-two"]) {
      await input.fill(t);
      await input.press("Enter");
      await expect(page.getByText(t)).toBeVisible({ timeout: 5_000 });
    }
    await page.waitForTimeout(3000);
    expect(apiMock.sentMessages.length).toBeGreaterThanOrEqual(2);
  });

  test("message order is preserved after decryption", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await waitForChat(page);
    await expect(page.getByText(data.messages[4].text)).toBeVisible({ timeout: 15_000 });
    const positions = await Promise.all(
      data.messages.map(async (m) => (await page.getByText(m.text).boundingBox())?.y ?? 0),
    );
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  test("author-name renders for other participant", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await waitForChat(page);
    await expect(page.locator(tid("author-name")).first()).toContainText("Bob");
  });

  test("message-input clears after sending", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await waitForChat(page);
    const input = page.locator(tid("message-input"));
    await input.fill("clear-check");
    await input.press("Enter");
    await expect(page.getByText("clear-check")).toBeVisible();
    await expect(input).toHaveValue("");
  });

  test("encrypted payload in HTTP body is not plaintext", async ({ page }) => {
    const { apiMock } = await setupMocks(page);
    await page.goto("/");
    await waitForChat(page);
    const input = page.locator(tid("message-input"));
    await input.fill("secret-payload-test");
    await input.press("Enter");
    await expect(page.getByText("secret-payload-test")).toBeVisible();
    await page.waitForTimeout(2000);
    const sent = apiMock.sentMessages[0]?.encryptedMessage ?? "";
    expect(sent).not.toContain("secret-payload-test");
    expect(sent.length).toBeGreaterThan(0);
  });

  test("message-list container exists with data-testid", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await waitForChat(page);
    await expect(page.locator(tid("message-list"))).toBeVisible();
  });

  test("send-button exists with data-testid", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await waitForChat(page);
    await expect(page.locator(tid("send-button"))).toBeVisible();
  });

  test("title-bar shows for non-hideTitle config", async ({ page }) => {
    await setupMocks(page);
    await page.goto("/");
    await waitForChat(page);
    await expect(page.locator(tid("title-bar"))).toBeVisible();
  });
});
