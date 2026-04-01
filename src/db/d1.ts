import type { DbAdapter } from "./adapter";
import type {
  User,
  Credential,
  CredentialWithSalt,
  Challenge,
  Todo,
  CreateCredentialData,
  CreateChallengeData,
  TodoUpdate,
} from "./types";

function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(0);
}

export function createD1Adapter(db: D1Database): DbAdapter {
  return {
    // ===== ユーザー =====

    async findUserByUsername(username) {
      return db
        .prepare("SELECT id, username, created_at FROM users WHERE username = ?")
        .bind(username)
        .first<User>();
    },

    async findUserById(id) {
      const user = await db
        .prepare("SELECT id, username, created_at FROM users WHERE id = ?")
        .bind(id)
        .first<User>();
      if (!user) return null;
      const countRow = await db
        .prepare("SELECT COUNT(*) as count FROM credentials WHERE user_id = ?")
        .bind(id)
        .first<{ count: number }>();
      return { ...user, credentialCount: countRow?.count ?? 0 };
    },

    async createUserIfNotExists(id, username) {
      await db
        .prepare("INSERT INTO users (id, username) VALUES (?, ?) ON CONFLICT(username) DO NOTHING")
        .bind(id, username)
        .run();
    },

    // ===== クレデンシャル =====

    async findCredentialsByUserId(userId) {
      const result = await db
        .prepare(
          "SELECT id, user_id, public_key, counter, transports, device_type, backed_up, prf_capable, created_at FROM credentials WHERE user_id = ?",
        )
        .bind(userId)
        .all<Omit<Credential, "public_key"> & { public_key: unknown }>();
      return result.results.map((r) => ({ ...r, public_key: toUint8Array(r.public_key) }));
    },

    async findCredentialsWithSaltByUserId(userId) {
      const result = await db
        .prepare(
          "SELECT c.id, c.user_id, c.public_key, c.counter, c.transports, c.device_type, c.backed_up, c.prf_capable, c.created_at, ps.salt FROM credentials c LEFT JOIN prf_salts ps ON c.id = ps.credential_id AND ps.purpose = 'encryption' WHERE c.user_id = ?",
        )
        .bind(userId)
        .all<Omit<CredentialWithSalt, "public_key"> & { public_key: unknown }>();
      return result.results.map((r) => ({ ...r, public_key: toUint8Array(r.public_key) }));
    },

    async findCredentialById(id) {
      const row = await db
        .prepare(
          "SELECT id, user_id, public_key, counter, transports, device_type, backed_up, prf_capable, created_at FROM credentials WHERE id = ?",
        )
        .bind(id)
        .first<Omit<Credential, "public_key"> & { public_key: unknown }>();
      if (!row) return null;
      return { ...row, public_key: toUint8Array(row.public_key) };
    },

    async createCredential(data: CreateCredentialData) {
      await db
        .prepare(
          "INSERT INTO credentials (id, user_id, public_key, counter, transports, device_type, backed_up, prf_capable) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          data.id,
          data.userId,
          data.publicKey,
          data.counter,
          data.transports,
          data.deviceType,
          data.backedUp ? 1 : 0,
          data.prfCapable ? 1 : 0,
        )
        .run();
    },

    async updateCredentialCounter(id, counter) {
      await db.prepare("UPDATE credentials SET counter = ? WHERE id = ?").bind(counter, id).run();
    },

    // ===== チャレンジ =====

    async cleanupExpiredChallenges() {
      await db.prepare("DELETE FROM challenges WHERE expires_at < datetime('now')").run();
    },

    async createChallenge(data: CreateChallengeData) {
      await db
        .prepare(
          "INSERT INTO challenges (id, challenge, user_id, type, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+5 minutes'))",
        )
        .bind(data.id, data.challenge, data.userId, data.type)
        .run();
    },

    async findLatestChallenge(userId, type) {
      // 登録・認証どちらもユーザーに紐付けてチャレンジを取得する（並行ログイン時の混線防止）
      return db
        .prepare(
          "SELECT challenge FROM challenges WHERE user_id = ? AND type = ? AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1",
        )
        .bind(userId, type)
        .first<Challenge>();
    },

    async deleteRegistrationChallenges(userId) {
      await db
        .prepare("DELETE FROM challenges WHERE user_id = ? AND type = 'registration'")
        .bind(userId)
        .run();
    },

    async deleteAuthChallengeByValue(challenge) {
      await db
        .prepare("DELETE FROM challenges WHERE challenge = ? AND type = 'authentication'")
        .bind(challenge)
        .run();
    },

    // ===== PRFソルト =====

    async createPrfSalt(credentialId, salt) {
      await db
        .prepare("INSERT INTO prf_salts (credential_id, salt, purpose) VALUES (?, ?, 'encryption')")
        .bind(credentialId, salt)
        .run();
    },

    // ===== TODO =====

    async findTodosByUserId(userId) {
      const result = await db
        .prepare(
          "SELECT id, encrypted_data, iv, order_index, created_at, updated_at FROM todos WHERE user_id = ? ORDER BY order_index ASC, created_at ASC",
        )
        .bind(userId)
        .all<Todo>();
      return result.results;
    },

    async findTodoById(id, userId) {
      return db
        .prepare("SELECT id FROM todos WHERE id = ? AND user_id = ?")
        .bind(id, userId)
        .first<Todo>();
    },

    async getMaxOrderIndex(userId) {
      const row = await db
        .prepare("SELECT MAX(order_index) as max_order FROM todos WHERE user_id = ?")
        .bind(userId)
        .first<{ max_order: number | null }>();
      return (row?.max_order ?? -1) + 1;
    },

    async createTodo(id, userId, encryptedData, iv, orderIndex) {
      await db
        .prepare(
          "INSERT INTO todos (id, user_id, encrypted_data, iv, order_index) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id, userId, encryptedData, iv, orderIndex)
        .run();
      return db
        .prepare(
          "SELECT id, encrypted_data, iv, order_index, created_at, updated_at FROM todos WHERE id = ?",
        )
        .bind(id)
        .first<Todo>();
    },

    async updateTodo(id, userId, encryptedData, iv) {
      await db
        .prepare(
          "UPDATE todos SET encrypted_data = ?, iv = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        )
        .bind(encryptedData, iv, id, userId)
        .run();
    },

    async deleteTodo(id, userId) {
      const result = await db
        .prepare("DELETE FROM todos WHERE id = ? AND user_id = ?")
        .bind(id, userId)
        .run();
      return result.meta.changes;
    },

    async reorderTodos(ids, userId) {
      const stmts = ids.map((id, index) =>
        db
          .prepare("UPDATE todos SET order_index = ? WHERE id = ? AND user_id = ?")
          .bind(index, id, userId),
      );
      await db.batch(stmts);
    },

    async bulkUpdateTodos(updates: TodoUpdate[], userId) {
      const stmts = updates.map((todo) =>
        db
          .prepare(
            "UPDATE todos SET encrypted_data = ?, iv = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
          )
          .bind(todo.encrypted_data, todo.iv, todo.id, userId),
      );
      await db.batch(stmts);
    },
  };
}
