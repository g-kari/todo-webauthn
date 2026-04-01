import { test, expect } from "@playwright/test";

/**
 * 未認証状態のスモークテスト
 * フロー: LP セクション → CTA クリック → 認証カード
 */
test.describe("未認証状態 - UI スモークテスト", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
  });

  test("ページタイトルが正しく表示される", async ({ page }) => {
    await expect(page).toHaveTitle(/WebAuthn/i);
  });

  test("LP セクションが最初に表示される", async ({ page }) => {
    await expect(page.locator("#lp-section")).toBeVisible();
    await expect(page.locator("#auth-section")).not.toBeVisible();
    await expect(page.locator("#todo-section")).not.toBeVisible();
  });

  test("LP の CTA ボタンをクリックすると認証カードが表示される", async ({ page }) => {
    // onclick="showAuthFromLP()" のボタン
    const ctaBtn = page.locator('[onclick="showAuthFromLP()"]').first();
    await ctaBtn.click();

    await expect(page.locator("#auth-section")).toBeVisible();
    await expect(page.locator("#lp-section")).not.toBeVisible();
  });

  test("認証カードにログイン・登録タブがある", async ({ page }) => {
    await page.locator('[onclick="showAuthFromLP()"]').first().click();

    await expect(page.locator("#tab-login")).toBeVisible();
    await expect(page.locator("#tab-register")).toBeVisible();
  });

  test("ユーザー名入力欄とパスキーボタンが認証カードに存在する", async ({ page }) => {
    await page.locator('[onclick="showAuthFromLP()"]').first().click();

    // ログインタブ（デフォルト）
    await expect(page.locator("#login-username")).toBeVisible();
    await expect(page.locator('[onclick="loginHandler()"]')).toBeVisible();

    // 登録タブへ切り替え
    await page.locator("#tab-register").click();
    await expect(page.locator("#reg-username")).toBeVisible();
    await expect(page.locator("#register-btn")).toBeVisible();
  });

  test("戻るボタンで LP に戻れる", async ({ page }) => {
    await page.locator('[onclick="showAuthFromLP()"]').first().click();
    await expect(page.locator("#auth-section")).toBeVisible();

    await page.locator('[onclick="showLP()"]').click();
    await expect(page.locator("#lp-section")).toBeVisible();
    await expect(page.locator("#auth-section")).not.toBeVisible();
  });
});
