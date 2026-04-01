/**
 * Turso スキーマ適用スクリプト
 * デプロイ前のビルドコマンドから実行される
 *
 * 必要な環境変数:
 *   TURSO_DATABASE_URL  - libsql://xxx.turso.io
 *   TURSO_AUTH_TOKEN    - Turso 認証トークン
 */

import { createClient } from "@libsql/client/http";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("❌ TURSO_DATABASE_URL と TURSO_AUTH_TOKEN が必要ですわ");
  process.exit(1);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  device_type TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0,
  prf_capable INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  user_id TEXT,
  type TEXT NOT NULL CHECK(type IN ('registration', 'authentication')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prf_salts (
  credential_id TEXT NOT NULL REFERENCES credentials(id),
  salt TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'encryption',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (credential_id, purpose)
);

CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  encrypted_data TEXT NOT NULL,
  iv TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_credentials_user_id ON credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_todos_user_id_order ON todos(user_id, order_index);
CREATE INDEX IF NOT EXISTS idx_challenges_expires ON challenges(expires_at);
`;

const statements = SCHEMA.split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
  .map((sql) => ({ sql, args: [] }));

console.log(`🔄 Turso マイグレーション実行中... (${url})`);

const client = createClient({ url, authToken });
await client.batch(statements, "write");

console.log("✅ マイグレーション完了ですわ");
