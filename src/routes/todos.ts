import { Hono } from "hono";
import type { Bindings } from "../index";
import { requireAuth } from "../middleware/auth";
import { createDb } from "../db/index";
import { generateId } from "../utils";

type Variables = {
  userId: string;
  credentialId: string;
};

const todos = new Hono<{ Bindings: Bindings; Variables: Variables }>();

todos.use("*", requireAuth());

todos.get("/", async (c) => {
  const db = createDb(c.env);
  return c.json(await db.findTodosByUserId(c.get("userId")));
});

const MAX_ENCRYPTED_LEN = 65536; // 64KB
const IV_LEN = 16; // btoa(12 bytes) = 16文字

todos.post("/", async (c) => {
  const { encrypted_data, iv } = await c.req.json<{ encrypted_data: string; iv: string }>();
  if (!encrypted_data || !iv) return c.json({ error: "暗号化データとIVは必須ですわ" }, 400);
  if (encrypted_data.length > MAX_ENCRYPTED_LEN || iv.length !== IV_LEN)
    return c.json({ error: "データサイズが不正ですわ" }, 400);

  const userId = c.get("userId");
  const db = createDb(c.env);
  const orderIndex = await db.getMaxOrderIndex(userId);
  const todo = await db.createTodo(generateId(), userId, encrypted_data, iv, orderIndex);
  return c.json(todo, 201);
});

const MAX_ID_LEN = 64;

todos.put("/reorder", async (c) => {
  const { ids } = await c.req.json<{ ids: string[] }>();
  if (!Array.isArray(ids) || ids.length > 10000)
    return c.json({ error: "IDの配列が必要ですわ" }, 400);
  if (ids.some((id) => typeof id !== "string" || id.length > MAX_ID_LEN))
    return c.json({ error: "IDが不正ですわ" }, 400);

  const db = createDb(c.env);
  await db.reorderTodos(ids, c.get("userId"));
  return c.json({ success: true });
});

todos.post("/bulk", async (c) => {
  const { todos: updates } = await c.req.json<{
    todos: { id: string; encrypted_data: string; iv: string }[];
  }>();
  if (!Array.isArray(updates) || updates.length > 10000)
    return c.json({ error: "TODOの配列が必要ですわ" }, 400);
  const invalid = updates.some(
    (u) =>
      typeof u.id !== "string" ||
      u.id.length > MAX_ID_LEN ||
      typeof u.encrypted_data !== "string" ||
      u.encrypted_data.length > MAX_ENCRYPTED_LEN ||
      typeof u.iv !== "string" ||
      u.iv.length !== IV_LEN,
  );
  if (invalid) return c.json({ error: "データが不正ですわ" }, 400);

  const db = createDb(c.env);
  await db.bulkUpdateTodos(updates, c.get("userId"));
  return c.json({ success: true, updated: updates.length });
});

todos.put("/:id", async (c) => {
  const { encrypted_data, iv } = await c.req.json<{ encrypted_data: string; iv: string }>();
  if (!encrypted_data || !iv) return c.json({ error: "暗号化データとIVは必須ですわ" }, 400);
  if (encrypted_data.length > MAX_ENCRYPTED_LEN || iv.length !== IV_LEN)
    return c.json({ error: "データサイズが不正ですわ" }, 400);

  const userId = c.get("userId");
  const todoId = c.req.param("id");
  const db = createDb(c.env);

  const existing = await db.findTodoById(todoId, userId);
  if (!existing) return c.json({ error: "TODOが見つかりませんわ" }, 404);

  await db.updateTodo(todoId, userId, encrypted_data, iv);
  return c.json({ success: true });
});

todos.delete("/:id", async (c) => {
  const db = createDb(c.env);
  const affected = await db.deleteTodo(c.req.param("id"), c.get("userId"));
  if (affected === 0) return c.json({ error: "TODOが見つかりませんわ" }, 404);
  return c.json({ success: true });
});

export default todos;
