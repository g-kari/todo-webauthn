import { createClient } from '@libsql/client/http';
import type { DbAdapter } from './adapter';
import type {
  User,
  Credential,
  CredentialWithSalt,
  Challenge,
  Todo,
  CreateCredentialData,
  CreateChallengeData,
  TodoUpdate,
} from './types';

function toRows<T>(result: { rows: unknown[] }): T[] {
  return result.rows as unknown as T[];
}

function firstRow<T>(result: { rows: unknown[] }): T | null {
  return (result.rows[0] as T) ?? null;
}

/** BLOB を Uint8Array に正規化（libSQL はさまざまな型で返す） */
function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value && typeof value === 'object') {
    return new Uint8Array(Object.values(value as Record<string, number>));
  }
  return new Uint8Array(0);
}

export function createTursoAdapter(url: string, authToken: string): DbAdapter {
  const client = createClient({ url, authToken });

  return {
    // ===== ユーザー =====

    async findUserByUsername(username) {
      return firstRow<User>(
        await client.execute({ sql: 'SELECT id, username, created_at FROM users WHERE username = ?', args: [username] })
      );
    },

    async findUserById(id) {
      const user = firstRow<User>(
        await client.execute({ sql: 'SELECT id, username, created_at FROM users WHERE id = ?', args: [id] })
      );
      if (!user) return null;
      const countRow = firstRow<{ count: number }>(
        await client.execute({ sql: 'SELECT COUNT(*) as count FROM credentials WHERE user_id = ?', args: [id] })
      );
      return { ...user, credentialCount: countRow?.count ?? 0 };
    },

    async createUserIfNotExists(id, username) {
      await client.execute({
        sql: 'INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)',
        args: [id, username],
      });
    },

    // ===== クレデンシャル =====

    async findCredentialsByUserId(userId) {
      const rows = toRows<Omit<Credential, 'public_key'> & { public_key: unknown }>(
        await client.execute({
          sql: 'SELECT id, user_id, public_key, counter, transports, device_type, backed_up, prf_capable, created_at FROM credentials WHERE user_id = ?',
          args: [userId],
        })
      );
      return rows.map((r) => ({ ...r, public_key: toUint8Array(r.public_key) }));
    },

    async findCredentialsWithSaltByUserId(userId) {
      const rows = toRows<Omit<CredentialWithSalt, 'public_key'> & { public_key: unknown }>(
        await client.execute({
          sql: "SELECT c.id, c.user_id, c.public_key, c.counter, c.transports, c.device_type, c.backed_up, c.prf_capable, c.created_at, ps.salt FROM credentials c LEFT JOIN prf_salts ps ON c.id = ps.credential_id AND ps.purpose = 'encryption' WHERE c.user_id = ?",
          args: [userId],
        })
      );
      return rows.map((r) => ({ ...r, public_key: toUint8Array(r.public_key) }));
    },

    async findCredentialById(id) {
      const row = firstRow<Omit<Credential, 'public_key'> & { public_key: unknown }>(
        await client.execute({
          sql: 'SELECT id, user_id, public_key, counter, transports, device_type, backed_up, prf_capable, created_at FROM credentials WHERE id = ?',
          args: [id],
        })
      );
      if (!row) return null;
      return { ...row, public_key: toUint8Array(row.public_key) };
    },

    async createCredential(data: CreateCredentialData) {
      await client.execute({
        sql: 'INSERT INTO credentials (id, user_id, public_key, counter, transports, device_type, backed_up, prf_capable) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        args: [
          data.id,
          data.userId,
          data.publicKey,
          data.counter,
          data.transports,
          data.deviceType,
          data.backedUp ? 1 : 0,
          data.prfCapable ? 1 : 0,
        ],
      });
    },

    async updateCredentialCounter(id, counter) {
      await client.execute({
        sql: 'UPDATE credentials SET counter = ? WHERE id = ?',
        args: [counter, id],
      });
    },

    // ===== チャレンジ =====

    async cleanupExpiredChallenges() {
      await client.execute("DELETE FROM challenges WHERE expires_at < datetime('now')");
    },

    async createChallenge(data: CreateChallengeData) {
      await client.execute({
        sql: "INSERT INTO challenges (id, challenge, user_id, type, expires_at) VALUES (?, ?, ?, ?, datetime('now', '+5 minutes'))",
        args: [data.id, data.challenge, data.userId, data.type],
      });
    },

    async findLatestChallenge(userId, type) {
      const sql =
        type === 'registration'
          ? "SELECT challenge FROM challenges WHERE user_id = ? AND type = 'registration' AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1"
          : "SELECT challenge FROM challenges WHERE type = 'authentication' AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1";
      const args = type === 'registration' ? [userId] : [];
      return firstRow<Challenge>(await client.execute({ sql, args }));
    },

    async deleteRegistrationChallenges(userId) {
      await client.execute({
        sql: "DELETE FROM challenges WHERE user_id = ? AND type = 'registration'",
        args: [userId],
      });
    },

    async deleteUsedAuthChallenge() {
      await client.execute(
        "DELETE FROM challenges WHERE type = 'authentication' AND expires_at < datetime('now', '+6 minutes')"
      );
    },

    // ===== PRFソルト =====

    async createPrfSalt(credentialId, salt) {
      await client.execute({
        sql: "INSERT INTO prf_salts (credential_id, salt, purpose) VALUES (?, ?, 'encryption')",
        args: [credentialId, salt],
      });
    },

    // ===== TODO =====

    async findTodosByUserId(userId) {
      return toRows<Todo>(
        await client.execute({
          sql: 'SELECT id, encrypted_data, iv, order_index, created_at, updated_at FROM todos WHERE user_id = ? ORDER BY order_index ASC, created_at ASC',
          args: [userId],
        })
      );
    },

    async findTodoById(id, userId) {
      return firstRow<Todo>(
        await client.execute({
          sql: 'SELECT id FROM todos WHERE id = ? AND user_id = ?',
          args: [id, userId],
        })
      );
    },

    async getMaxOrderIndex(userId) {
      const row = firstRow<{ max_order: number | null }>(
        await client.execute({
          sql: 'SELECT MAX(order_index) as max_order FROM todos WHERE user_id = ?',
          args: [userId],
        })
      );
      return (row?.max_order ?? -1) + 1;
    },

    async createTodo(id, userId, encryptedData, iv, orderIndex) {
      await client.execute({
        sql: 'INSERT INTO todos (id, user_id, encrypted_data, iv, order_index) VALUES (?, ?, ?, ?, ?)',
        args: [id, userId, encryptedData, iv, orderIndex],
      });
      return firstRow<Todo>(
        await client.execute({
          sql: 'SELECT id, encrypted_data, iv, order_index, created_at, updated_at FROM todos WHERE id = ?',
          args: [id],
        })
      );
    },

    async updateTodo(id, userId, encryptedData, iv) {
      await client.execute({
        sql: "UPDATE todos SET encrypted_data = ?, iv = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        args: [encryptedData, iv, id, userId],
      });
    },

    async deleteTodo(id, userId) {
      const result = await client.execute({
        sql: 'DELETE FROM todos WHERE id = ? AND user_id = ?',
        args: [id, userId],
      });
      return result.rowsAffected;
    },

    async reorderTodos(ids, userId) {
      await client.batch(
        ids.map((id, index) => ({
          sql: 'UPDATE todos SET order_index = ? WHERE id = ? AND user_id = ?',
          args: [index, id, userId],
        })),
        'write'
      );
    },

    async bulkUpdateTodos(updates: TodoUpdate[], userId) {
      await client.batch(
        updates.map((todo) => ({
          sql: "UPDATE todos SET encrypted_data = ?, iv = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
          args: [todo.encrypted_data, todo.iv, todo.id, userId],
        })),
        'write'
      );
    },
  };
}
