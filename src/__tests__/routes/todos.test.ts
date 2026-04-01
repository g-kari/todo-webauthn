import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { createJwt } from "../../middleware/auth";
import { createMockDb } from "../helpers/mockDb";

// createDb をモック（todos.ts の import 先を差し替え）
vi.mock("../../db/index", () => ({ createDb: vi.fn() }));
import { createDb } from "../../db/index";
import todos from "../../routes/todos";

const JWT_SECRET = "test-secret";
const USER_ID = "user-aaa";
const CRED_ID = "cred-bbb";
const VALID_IV = "AAAAAAAAAAAAAAAA"; // 16文字
const VALID_ENC = "dGVzdA=="; // "test" base64

type Env = { JWT_SECRET: string; TURSO_DATABASE_URL: string; TURSO_AUTH_TOKEN: string };

function buildApp(db = createMockDb()): Hono<{ Bindings: Env }> {
  vi.mocked(createDb).mockReturnValue(db);
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/todos", todos);
  return app;
}

async function makeEnv(): Promise<Env> {
  return { JWT_SECRET, TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "" };
}

async function authCookie(): Promise<string> {
  const token = await createJwt({ userId: USER_ID, credentialId: CRED_ID }, JWT_SECRET);
  return `session=${token}`;
}

describe("GET /api/todos", () => {
  let app: Hono<{ Bindings: Env }>;
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    app = buildApp(db);
  });

  it("認証なしは 401 を返す", async () => {
    const res = await app.request("/api/todos", {}, await makeEnv());
    expect(res.status).toBe(401);
  });

  it("認証済みで空配列を返す", async () => {
    const res = await app.request(
      "/api/todos",
      { headers: { Cookie: await authCookie() } },
      await makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it("DB から返ったTODO一覧をそのまま返す", async () => {
    const fakeTodo = {
      id: "t1", user_id: USER_ID, encrypted_data: "enc", iv: "iv-iv-iv-iv-iv--",
      order_index: 0, created_at: "2024-01-01", updated_at: "2024-01-01",
    };
    vi.mocked(db.findTodosByUserId).mockResolvedValue([fakeTodo]);

    const res = await app.request(
      "/api/todos",
      { headers: { Cookie: await authCookie() } },
      await makeEnv(),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(body).toHaveLength(1);
  });
});

describe("POST /api/todos", () => {
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    app = buildApp();
  });

  it("encrypted_data と iv がない場合は 400", async () => {
    const res = await app.request(
      "/api/todos",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: await authCookie() },
        body: JSON.stringify({}),
      },
      await makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("iv が 16文字でない場合は 400", async () => {
    const res = await app.request(
      "/api/todos",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: await authCookie() },
        body: JSON.stringify({ encrypted_data: VALID_ENC, iv: "short" }),
      },
      await makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("encrypted_data が 64KB を超える場合は 400", async () => {
    const res = await app.request(
      "/api/todos",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: await authCookie() },
        body: JSON.stringify({ encrypted_data: "a".repeat(65537), iv: VALID_IV }),
      },
      await makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("正常なリクエストは 201 と作成済みTODOを返す", async () => {
    const res = await app.request(
      "/api/todos",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: await authCookie() },
        body: JSON.stringify({ encrypted_data: VALID_ENC, iv: VALID_IV }),
      },
      await makeEnv(),
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { encrypted_data: string; iv: string };
    expect(body.encrypted_data).toBe(VALID_ENC);
    expect(body.iv).toBe(VALID_IV);
  });
});

describe("PUT /api/todos/:id", () => {
  let app: Hono<{ Bindings: Env }>;
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    app = buildApp(db);
  });

  it("存在しないTODOは 404 を返す", async () => {
    vi.mocked(db.findTodoById).mockResolvedValue(null);
    const res = await app.request(
      "/api/todos/nonexistent",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: await authCookie() },
        body: JSON.stringify({ encrypted_data: VALID_ENC, iv: VALID_IV }),
      },
      await makeEnv(),
    );
    expect(res.status).toBe(404);
  });

  it("iv が不正な場合は 400 を返す", async () => {
    const res = await app.request(
      "/api/todos/t1",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: await authCookie() },
        body: JSON.stringify({ encrypted_data: VALID_ENC, iv: "bad" }),
      },
      await makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("存在するTODOは正常更新され 200 を返す", async () => {
    const existing = {
      id: "t1", user_id: USER_ID, encrypted_data: "old", iv: VALID_IV,
      order_index: 0, created_at: "2024-01-01", updated_at: "2024-01-01",
    };
    vi.mocked(db.findTodoById).mockResolvedValue(existing);

    const res = await app.request(
      "/api/todos/t1",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: await authCookie() },
        body: JSON.stringify({ encrypted_data: VALID_ENC, iv: VALID_IV }),
      },
      await makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });
});

describe("DELETE /api/todos/:id", () => {
  let app: Hono<{ Bindings: Env }>;
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    app = buildApp(db);
  });

  it("存在しないTODOは 404 を返す", async () => {
    vi.mocked(db.deleteTodo).mockResolvedValue(0);
    const res = await app.request(
      "/api/todos/notexist",
      { method: "DELETE", headers: { Cookie: await authCookie() } },
      await makeEnv(),
    );
    expect(res.status).toBe(404);
  });

  it("正常削除は 200 と success を返す", async () => {
    vi.mocked(db.deleteTodo).mockResolvedValue(1);
    const res = await app.request(
      "/api/todos/t1",
      { method: "DELETE", headers: { Cookie: await authCookie() } },
      await makeEnv(),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });
});

describe("PUT /api/todos/reorder", () => {
  let app: Hono<{ Bindings: Env }>;

  beforeEach(() => {
    app = buildApp();
  });

  it("配列でない場合は 400 を返す", async () => {
    const res = await app.request(
      "/api/todos/reorder",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: await authCookie() },
        body: JSON.stringify({ ids: "not-an-array" }),
      },
      await makeEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("正常な配列は 200 を返す", async () => {
    const res = await app.request(
      "/api/todos/reorder",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: await authCookie() },
        body: JSON.stringify({ ids: ["t1", "t2"] }),
      },
      await makeEnv(),
    );
    expect(res.status).toBe(200);
  });
});
