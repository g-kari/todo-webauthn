---
paths:
  - "src/**/*.ts"
  - "frontend/**/*.ts"
---

# セキュリティ規約

## 絶対に守ること

- **PRF 出力をサーバーに送らない**: `frontend/main.ts` の認証フローで `prfOutput` はローカルの鍵導出のみに使用する
- **シークレットを wrangler.jsonc に書かない**: `TURSO_AUTH_TOKEN`・`JWT_SECRET` は `wrangler secret put` で設定する
- **innerHTML は必ず escapeHtml を通す**: XSS 対策として `frontend/main.ts` の `escapeHtml()` を使う

## SQL インジェクション対策

- クエリはすべてパラメータバインディングを使う
  ```typescript
  // ✅ 正しい
  client.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] });
  // ❌ 禁止
  client.execute(`SELECT * FROM users WHERE id = '${id}'`);
  ```

## 認証・セッション

- Cookie は `httpOnly: true`, `sameSite: 'Strict'` を必ず設定する
- `secure` フラグは `RP_ORIGIN.startsWith('https')` で自動判定する（ローカルは HTTP でも動作）
- JWT の有効期限は 7 日（個人用途のため）

## 暗号化

- AES-GCM の IV は毎回 `crypto.getRandomValues(new Uint8Array(12))` で生成する（使い回し禁止）
- HKDF の `info` パラメータは `"webauthn-todo-encryption-v1"` を固定で使用する（バージョン変更時は鍵が変わることに注意）
