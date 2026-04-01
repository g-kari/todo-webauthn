import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // WebAuthn 仮想認証器はテスト間で干渉するため直列実行
  retries: 0,
  timeout: 30_000,
  use: {
    baseURL: "https://todo.0g0.xyz",
    // CDP 仮想認証器を使うには headless でも動作する
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: undefined },
    },
  ],
  reporter: [["list"], ["html", { open: "never" }]],
});
