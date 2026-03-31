# CLAUDE.md

このファイルは Claude Code がこのリポジトリで作業する際の指針です。

## プロジェクト概要

WebAuthn のパスキーと PRF（Pseudo-Random Function）拡張を利用した、個人用の暗号化 TODO アプリ。
サーバーはゼロナレッジ設計で、TODO コンテンツを一切読めない。
Cloudflare Workers にデプロイし、GitHub 連携による自動デプロイを使用する（GitHub Actions は使わない）。

## 技術スタック

| レイヤー | 技術 |
|---------|------|
| ランタイム | Cloudflare Workers |
| フレームワーク | Hono (TypeScript) |
| データベース | Turso (libSQL / SQLite 互換) |
| 認証 | @simplewebauthn/server v13+ (サーバー) |
| 認証 (クライアント) | @simplewebauthn/browser v13+ (npm) |
| 暗号化 | WebAuthn PRF → HKDF → AES-GCM-256 (クライアントサイドのみ) |
| リッチテキスト | Lexical (メモエディタ) |
| フロントエンド | TypeScript + Vite (ビルド出力 → `public/`) |
| ツールチェーン | vite-plus (Oxlint + Oxfmt 統合品質ツール) |
| 設定 | wrangler.jsonc |
| デプロイ | Cloudflare Workers Builds (GitHub 連携) ※GitHub Actions 不使用 |

## フロントエンド機能

`frontend/main.ts` がすべてのUI・暗号化・状態管理を担う。

| 機能 | 概要 |
|------|------|
| WebAuthn 登録・認証 | PRF 拡張必須。非対応認証器は登録不可 |
| TODO CRUD | 追加・完了切り替え・インライン編集・削除 |
| 暗号化 | AES-GCM-256。編集のたびに再暗号化してサーバーへ送信 |
| 楽観的UI更新 | `patchTodo` はキャッシュ即時更新→バックグラウンド同期。サーバー応答を待たない |
| リスト表示 | DnD 並び替え（drag-handle からのみ）・フィルター（すべて/未完了/完了済み） |
| カンバン表示 | 未着手/進行中/完了の3列。DnD でステータス変更 |
| テキスト検索 | 復号済みキャッシュをクライアントサイドで絞り込み（サーバー通信なし） |
| 優先度 | 高/中/低。クリックでサイクル |
| 期日 | 日付ピッカー。本日・翌日・期限超過を色分け表示 |
| Google Calendar | 期日付き TODO をワンクリックで GCal イベント作成ページへ |
| Lexical メモ | TODO ごとのリッチテキストノート。800ms debounce で自動保存 |
| ユーザー設定 | アクセントカラー・フォントサイズ・カンバン列名。localStorage に保存 |

### 状態管理の重要な制約

- `encryptionKey` (AES-GCM-256) はメモリのみ。ページリロードで消失
- `todosCache` = サーバーから取得した暗号化データ
- `decryptedCache` = 復号済みデータ（楽観的更新で直接変更する）
- `syncEncryptedCache(id, encrypted_data, iv)` で両キャッシュの暗号化フィールドを同期する

## ディレクトリ構成

```
WebAuthn/
├── CLAUDE.md               # このファイル
├── wrangler.jsonc           # Cloudflare Workers 設定
├── vite.config.ts           # Vite フロントエンドビルド設定
├── package.json
├── tsconfig.json            # サーバー (Workers) 用
├── worker-configuration.d.ts  # wrangler types で自動生成 (gitignore)
├── scripts/
│   └── migrate.mjs          # Turso スキーマ適用スクリプト（ビルド前に実行）
├── frontend/               # フロントエンドソース (Vite でビルド)
│   ├── index.html           # SPA HTML エントリポイント
│   ├── main.ts              # TypeScript メイン (WebAuthn + 暗号化 + UI)
│   ├── style.css            # スタイル
│   └── tsconfig.json        # フロントエンド用 TypeScript 設定
├── public/                  # Vite ビルド出力 ※gitignore・コミット不要
├── src/
│   ├── index.ts             # Hono エントリポイント・Bindings 型定義
│   ├── routes/
│   │   ├── auth.ts          # WebAuthn 登録・認証 API
│   │   └── todos.ts         # TODO CRUD API
│   ├── middleware/
│   │   └── auth.ts          # JWT セッション検証 (Web Crypto HMAC-SHA256)
│   └── db/
│       ├── index.ts         # createDb() ファクトリ（Turso ↔ D1 切り替え口）
│       ├── adapter.ts       # DbAdapter インターフェース定義
│       ├── types.ts         # DB 型定義 (User, Credential, Todo など)
│       ├── turso.ts         # Turso 実装
│       └── d1.ts            # D1 実装（切り替え用）
└── migrations/
    └── 0001_initial.sql     # スキーマ定義（Turso 用 migrate.mjs と内容を同期）
```

## 暗号化アーキテクチャ

```
[認証時]
パスキー認証 → WebAuthn PRF 拡張 (サーバー提供の salt 付き)
  → PRF 出力 (32 byte) → HKDF (SHA-256, info="webauthn-todo-encryption-v1")
  → AES-GCM-256 鍵 (メモリのみ、ページ離脱で消失)

[TODO 保存]
平文 JSON → AES-GCM-256 暗号化 (ランダム 12byte IV) → encrypted_data + iv → サーバー

[TODO 読取]
サーバーから encrypted_data + iv → AES-GCM-256 復号 → 平文 JSON
```

**重要事項**:
- 暗号鍵はクライアントのメモリ上のみに存在
- PRF 出力はサーバーに送信しない
- サーバーは TODO コンテンツを復号できない
- ページリロード後は「アンロック」ボタンでパスキー再認証が必要

## API エンドポイント

すべて `/api` プレフィックス。認証が必要なエンドポイントは JWT Cookie を検証する。

### 認証 (`/api/auth`)

| メソッド | パス | 認証 | 説明 |
|---------|------|------|------|
| POST | `/auth/register/options` | 不要 | 登録チャレンジ生成 |
| POST | `/auth/register/verify` | 不要 | 登録検証・ユーザー作成 |
| POST | `/auth/login/options` | 不要 | 認証チャレンジ生成・PRF ソルト返却 |
| POST | `/auth/login/verify` | 不要 | 認証検証・JWT Cookie 発行 |
| GET | `/auth/me` | 必要 | セッション確認・ユーザー名取得 |
| POST | `/auth/logout` | 不要 | JWT Cookie 削除 |

### TODO (`/api/todos`)

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/todos` | 自分の TODO 一覧取得（order_index 順） |
| POST | `/todos` | TODO 追加（encrypted_data + iv を受け取る） |
| PUT | `/todos/:id` | TODO 更新（encrypted_data + iv を受け取る） |
| DELETE | `/todos/:id` | TODO 削除 |
| PUT | `/todos/reorder` | 複数 TODO の並び順を一括更新 |
| POST | `/todos/bulk` | 複数 TODO の暗号化データを一括更新（パスキー追加時の再暗号化用） |

## 開発コマンド

```bash
# 依存関係インストール
npm install

# 型定義生成（wrangler.jsonc のバインディングから）
npm run cf-typegen

# ローカル開発サーバー起動（Workers + Turso 本番 DB）
npm run dev

# フロントエンドのみ開発サーバー（Vite HMR、/api は :8787 にプロキシ）
npm run dev:frontend

# フロントエンドビルド（frontend/ → public/）
npm run build:frontend

# Turso スキーマ適用（手動実行。build・deploy では自動実行される）
npm run migrate

# TypeScript 型チェック（サーバーサイド）
npm run type-check

# コード品質チェック一括（Oxlint + Oxfmt）
npm run check

# コード品質チェックのみ
npm run lint

# フォーマット
npm run format

# デプロイ（migrate → vite build → wrangler deploy）
# 通常は GitHub 連携で自動実行されるため手動実行は不要
npm run deploy
```

## 環境変数・シークレット

### wrangler.jsonc の vars（公開可）

| 変数 | 説明 | 例 |
|-----|------|-----|
| `RP_NAME` | WebAuthn RP 名 | "WebAuthn TODO" |
| `RP_ID` | WebAuthn RP ID（ドメイン） | "your-app.workers.dev" |
| `RP_ORIGIN` | WebAuthn 期待 Origin | "https://your-app.workers.dev" |
| `TURSO_DATABASE_URL` | Turso DB URL | "libsql://your-db.turso.io" |

### wrangler secret（秘密情報）

```bash
# JWT 署名鍵
npx wrangler secret put JWT_SECRET

# Turso 認証トークン
npx wrangler secret put TURSO_AUTH_TOKEN
```

## DB 切り替え方法（Turso ↔ D1）

`src/db/index.ts` の `createDb` 関数を変更するだけで切り替え可能：

```typescript
// Turso（現在）
return createTursoAdapter(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);

// D1 に切り替える場合
return createD1Adapter((env as unknown as { DB: D1Database }).DB);
```

D1 に切り替える場合は追加で：
1. `wrangler.jsonc` に `d1_databases` バインディングを追加
2. `src/index.ts` の `Bindings` 型に `DB: D1Database` を追加

新しい DB 操作を追加する場合は `adapter.ts` → `turso.ts` → `d1.ts` の3ファイルをセットで更新する。

## デプロイ手順

### 初回セットアップ

1. **シークレット設定**
   ```bash
   npx wrangler secret put JWT_SECRET
   npx wrangler secret put TURSO_AUTH_TOKEN
   ```

2. **本番用 RP_ID・RP_ORIGIN を wrangler.jsonc に設定**

3. **Turso スキーマ適用**（`npm run deploy` 実行時に自動実行されるが、初回は手動でも可）
   ```bash
   npm run migrate
   ```

### GitHub 連携デプロイ（GitHub Actions は使わない）

1. リポジトリを GitHub にプッシュ
2. Cloudflare ダッシュボード → Workers & Pages → Create → Import a Repository
3. GitHub リポジトリを選択
4. ビルド設定:
   - **Build command**: `npm ci && npm run build`（migrate + vite build が実行される）
   - **Production branch**: `master`（または `main`）
5. 接続後は `master` ブランチへのプッシュで自動デプロイ
   - `public/` はビルド時に生成されるため git には含まれない（.gitignore 済み）

## PRF 拡張の対応状況

| 認証器 | PRF サポート |
|--------|------------|
| 1Password | ✅ サポート |
| iCloud Keychain (iOS 18+) | ✅ サポート |
| Google Password Manager | ✅ サポート |
| YubiKey (FW 5.7+) | ✅ サポート |
| Windows Hello | 一部サポート |
| 古い FIDO2 デバイス | ❌ 非サポート |

PRF 非対応の認証器では登録・ログイン不可（個人用のため必須とする）。

## DB スキーマ

| テーブル | 概要 |
|---------|------|
| `users` | ユーザー情報 |
| `credentials` | WebAuthn クレデンシャル |
| `challenges` | 短命チャレンジ（5 分有効） |
| `prf_salts` | PRF 鍵導出用ソルト（クレデンシャルごと） |
| `todos` | 暗号化 TODO（encrypted_data + iv + order_index のみ） |

スキーマを変更する場合は `migrations/0001_initial.sql` と `scripts/migrate.mjs` 内の `SCHEMA` 定数を必ず同期すること。

## 注意事項

- PRF 拡張は HTTPS 環境でのみ動作（Workers はデフォルト HTTPS）
- ローカル開発は `localhost` で動作（ブラウザが HTTP を許可するため）
- `wrangler.jsonc` の `RP_ID` と `RP_ORIGIN` は本番ドメインに合わせて変更すること
- 複数パスキーを登録した場合、全 TODO の再暗号化が必要（`/api/todos/bulk` エンドポイント利用）
- `wrangler.jsonc` を変更したら `npm run cf-typegen` で型定義を再生成すること
