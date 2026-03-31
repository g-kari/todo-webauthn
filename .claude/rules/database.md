---
paths:
  - "src/db/**/*.ts"
  - "migrations/**/*.sql"
  - "scripts/migrate.mjs"
---

# データベース規約

## アダプターパターン

DB 操作は必ず `DbAdapter` インターフェース（`src/db/adapter.ts`）経由で行う。

```typescript
// ✅ 正しい
const db = createDb(c.env);
await db.findUserByUsername(username);

// ❌ 禁止（直接 Turso クライアントをルートで使う）
const client = createClient(...);
await client.execute(...);
```

## DB 切り替えルール

- `src/db/index.ts` の `createDb()` を変更するだけで Turso ↔ D1 を切り替えられる
- 新しい DB 操作を追加する場合は以下を必ずセットで更新する:
  1. `src/db/adapter.ts` にメソッド追加
  2. `src/db/turso.ts` に実装追加
  3. `src/db/d1.ts` に実装追加

## スキーマ変更ルール

- テーブル/カラムを追加・変更した場合は必ず以下を両方更新する:
  1. `migrations/0001_initial.sql`（`CREATE TABLE IF NOT EXISTS` で冪等に）
  2. `scripts/migrate.mjs` 内の `SCHEMA` 定数（内容を同期する）
- スキーマ変更後は `src/db/types.ts` の型定義も更新する

## クエリ規約

- Turso: `client.batch([...], 'write')` でトランザクション的な複数更新を行う
- D1: `db.batch([stmt1, stmt2])` で複数更新を行う
- 読み取りクエリは `firstRow<T>()` / `toRows<T>()` ヘルパーを使う
