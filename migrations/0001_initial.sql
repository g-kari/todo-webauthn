-- ユーザーテーブル
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- WebAuthnクレデンシャルテーブル（1ユーザー複数パスキー対応）
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT, -- JSON配列 例: '["internal","hybrid"]'
  device_type TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0,
  prf_capable INTEGER NOT NULL DEFAULT 0, -- PRF拡張対応フラグ
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- チャレンジテーブル（登録・認証セレモニー用の短命データ）
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  user_id TEXT, -- 認証時はNULL可
  type TEXT NOT NULL CHECK(type IN ('registration', 'authentication')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

-- PRFソルトテーブル（クレデンシャルごとのAES鍵導出用ソルト）
CREATE TABLE IF NOT EXISTS prf_salts (
  credential_id TEXT NOT NULL REFERENCES credentials(id),
  salt TEXT NOT NULL, -- Base64URL encoded 32バイトランダム値
  purpose TEXT NOT NULL DEFAULT 'encryption',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (credential_id, purpose)
);

-- TODOテーブル（サーバーはゼロナレッジ・暗号文のみ保持）
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  encrypted_data TEXT NOT NULL, -- Base64エンコードされたAES-GCM暗号文
  iv TEXT NOT NULL,             -- Base64エンコードされた96ビットIV
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_credentials_user_id ON credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_todos_user_id_order ON todos(user_id, order_index);
CREATE INDEX IF NOT EXISTS idx_challenges_expires ON challenges(expires_at);
