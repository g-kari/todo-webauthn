import { test, expect, type CDPSession } from "@playwright/test";

/**
 * CDP 仮想認証器を使った WebAuthn 登録・認証の E2E テスト
 * Chrome 122+ の hasPrf フラグで PRF 拡張をシミュレートする
 */

async function setupVirtualAuthenticator(cdp: CDPSession): Promise<string> {
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const result = (await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1", // PRF は CTAP2.1 以降
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true, // PRF 拡張を有効化
    },
  })) as { authenticatorId: string };
  return result.authenticatorId;
}

/** LP → 認証カード → タブ選択 → ユーザー名入力 */
async function goToAuthCard(
  page: Parameters<Parameters<typeof test>[1]>[0],
  tab: "login" | "register",
  username: string,
): Promise<void> {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.locator('[onclick="showAuthFromLP()"]').first().click();
  await expect(page.locator("#auth-section")).toBeVisible();

  if (tab === "register") {
    await page.locator("#tab-register").click();
    await page.locator("#reg-username").fill(username);
  } else {
    await page.locator("#login-username").fill(username);
  }
}

/** 登録してからログインし、todo-section が表示されるまで待つ */
async function registerAndLogin(
  page: Parameters<Parameters<typeof test>[1]>[0],
  username: string,
): Promise<void> {
  // 登録（alert/confirm は承認。削除 confirm もここで処理）
  await goToAuthCard(page, "register", username);
  page.on("dialog", (d) => d.accept());
  await page.locator("#register-btn").click();

  // 登録結果を待つ: 成功(login-form 表示)またはエラー(register-message.error 表示)
  const isVisible = (id: string) =>
    `document.getElementById('${id}') && getComputedStyle(document.getElementById('${id}')).display !== 'none'`;

  await page.waitForFunction(
    `(${isVisible("login-form")}) || (${isVisible("register-message")})`,
    { timeout: 8_000 },
  );

  // PRF 非対応エラーが出ていたらスキップ
  const prfErrEl = page.locator("#register-message.error");
  if (await prfErrEl.isVisible().catch(() => false)) {
    const msg = await prfErrEl.textContent().catch(() => "");
    test.skip(true, `PRF 非対応: ${msg}`);
    return;
  }

  // ログインタブへ切り替わった確認
  await expect(page.locator("#login-form")).toBeVisible({ timeout: 3_000 });

  // ログイン
  await page.locator("#login-username").fill(username);
  await page.locator("#login-btn").click();

  // todo-section か unlock-section のどちらかが visible になるまで待つ
  await page.waitForFunction(
    `(${isVisible("todo-section")}) || (${isVisible("unlock-section")})`,
    { timeout: 15_000 },
  );

  // unlock が必要な場合はアンロック
  if (await page.locator("#unlock-section").isVisible()) {
    await page.locator('[onclick="unlockHandler()"]').click();
    await page.waitForFunction(isVisible("todo-section"), { timeout: 15_000 });
  }
}

function uniqueUsername(): string {
  return `pw-${Date.now()}`;
}

// ========================
// WebAuthn 登録・ログインフロー
// ========================
test.describe("WebAuthn 登録・ログイン E2E フロー", () => {
  test("パスキー登録 → ログイン → TODO追加 → 完了 → 削除 → ログアウト", async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await setupVirtualAuthenticator(cdp);

    const username = uniqueUsername();
    await registerAndLogin(page, username);

    // todo-section が表示されているはず
    await expect(page.locator("#todo-section")).toBeVisible();

    // TODO 追加（add ボタンは ID なし → btn-add クラスで選択）
    await page.locator("#new-todo-input").fill("E2E テスト TODO");
    await page.locator(".btn-add").click();

    const todoTitle = page.locator(".todo-title", { hasText: "E2E テスト TODO" });
    await expect(todoTitle).toBeVisible({ timeout: 10_000 });

    // 完了チェック
    await page.locator(".todo-checkbox").first().click();
    await expect(page.locator(".todo-item.completed")).toBeVisible({ timeout: 5_000 });

    // 削除（btn-danger が削除ボタン。confirm は registerAndLogin で登録済みハンドラが処理）
    await page.locator(".btn-danger").first().click();
    await expect(todoTitle).not.toBeVisible({ timeout: 5_000 });

    // ログアウト
    await page.locator("#logout-btn").click();
    await expect(page.locator("#lp-section")).toBeVisible({ timeout: 5_000 });
  });

  test("登録後リロードすると unlock セクションが表示される", async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await setupVirtualAuthenticator(cdp);

    const username = uniqueUsername();
    await registerAndLogin(page, username);

    await expect(page.locator("#todo-section")).toBeVisible();

    // リロード → セッション Cookie は残るが暗号鍵は消える
    await page.reload();
    await page.waitForLoadState("networkidle");

    // unlock-section が表示されるはず
    await expect(page.locator("#unlock-section")).toBeVisible({ timeout: 5_000 });
  });
});

// ========================
// バリデーション（UI レベル）
// ========================
test.describe("フォームバリデーション（UI）", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator('[onclick="showAuthFromLP()"]').first().click();
    await expect(page.locator("#auth-section")).toBeVisible();
  });

  test("空のユーザー名で登録しようとするとエラーメッセージが表示される", async ({ page }) => {
    await page.locator("#tab-register").click();
    // ユーザー名未入力でクリック
    await page.locator("#register-btn").click();

    // #register-message にエラーが表示される
    await expect(page.locator("#register-message")).toBeVisible({ timeout: 3000 });
    await expect(page.locator("#register-message")).toHaveClass(/error/);
  });

  test("ログインタブでユーザー名なしでもエラーが表示される", async ({ page }) => {
    await page.locator("#login-btn").click();

    await expect(page.locator("#login-message")).toBeVisible({ timeout: 3000 });
    await expect(page.locator("#login-message")).toHaveClass(/error/);
  });
});
