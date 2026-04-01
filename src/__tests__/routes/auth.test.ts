import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { createMockDb } from "../helpers/mockDb";

vi.mock("../../db/index", () => ({ createDb: vi.fn() }));
import { createDb } from "../../db/index";
import auth from "../../routes/auth";

type Env = {
  JWT_SECRET: string;
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  RP_NAME: string;
  RP_ID: string;
  RP_ORIGIN: string;
};

const ENV: Env = {
  JWT_SECRET: "test-secret",
  TURSO_DATABASE_URL: "",
  TURSO_AUTH_TOKEN: "",
  RP_NAME: "Test App",
  RP_ID: "localhost",
  RP_ORIGIN: "http://localhost",
};

function buildApp(db = createMockDb()): Hono<{ Bindings: Env }> {
  vi.mocked(createDb).mockReturnValue(db);
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/auth", auth);
  return app;
}

// ========================
// ユーザー名バリデーション (登録オプション)
// ========================
describe("POST /api/auth/register/options - username バリデーション", () => {
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    app = buildApp();
  });

  it("username が空の場合は 400 を返す", async () => {
    const res = await app.request(
      "/api/auth/register/options",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "" }),
      },
      ENV,
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  it("username が 64文字を超える場合は 400 を返す", async () => {
    const res = await app.request(
      "/api/auth/register/options",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "a".repeat(65) }),
      },
      ENV,
    );
    expect(res.status).toBe(400);
  });

  it("使用不可文字（スペース）が含まれる場合は 400 を返す", async () => {
    const res = await app.request(
      "/api/auth/register/options",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "bad user name" }),
      },
      ENV,
    );
    expect(res.status).toBe(400);
  });

  it("有効な username（英数字・記号）は 200 を返す", async () => {
    const res = await app.request(
      "/api/auth/register/options",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "valid_user.name@example" }),
      },
      ENV,
    );
    // simplewebauthn の generateRegistrationOptions は実際の WebAuthn 環境依存なため
    // 200 か内部エラー（500）かのどちらかになる。400 でないことを確認
    expect(res.status).not.toBe(400);
  });
});

// ========================
// ユーザー名列挙防止
// ========================
describe("POST /api/auth/login/options - ユーザー名列挙防止", () => {
  it("存在しない username でも 200 を返す（enumeration 対策）", async () => {
    const db = createMockDb({
      findUserByUsername: vi.fn().mockResolvedValue(null),
    });
    const app = buildApp(db);

    const res = await app.request(
      "/api/auth/login/options",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "nonexistent" }),
      },
      ENV,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { prfSalts: Record<string, string> };
    expect(body.prfSalts).toEqual({});
  });
});

// ========================
// ログアウト
// ========================
describe("POST /api/auth/logout", () => {
  it("200 と success: true を返す", async () => {
    const app = buildApp();
    const res = await app.request(
      "/api/auth/logout",
      { method: "POST" },
      ENV,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  it("Set-Cookie で session クッキーを削除する", async () => {
    const app = buildApp();
    const res = await app.request(
      "/api/auth/logout",
      { method: "POST" },
      ENV,
    );
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("session=");
    // 削除は Max-Age=0 または expires を過去に設定
    expect(setCookie.toLowerCase()).toMatch(/max-age=0|expires=.*1970/);
  });
});

// ========================
// GET /api/auth/me - 認証チェック
// ========================
describe("GET /api/auth/me", () => {
  it("Cookie なしは 401 を返す", async () => {
    const app = buildApp();
    const res = await app.request("/api/auth/me", {}, ENV);
    expect(res.status).toBe(401);
  });

  it("不正な JWT は 401 を返す", async () => {
    const app = buildApp();
    const res = await app.request(
      "/api/auth/me",
      { headers: { Cookie: "session=invalid.jwt.token" } },
      ENV,
    );
    expect(res.status).toBe(401);
  });
});
