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
| フロントエンド | TypeScript + Vite (ビルド出力 → `public/`) |
| ツールチェーン | vite-plus (Oxlint + Oxfmt 統合品質ツール) |
| 設定 | wrangler.jsonc |
| デプロイ | Cloudflare Workers Builds (GitHub 連携) ※GitHub Actions 不使用 |

## ディレクトリ構成

```
WebAuthn/
├── CLAUDE.md               # このファイル
├── wrangler.jsonc           # Cloudflare Workers 設定
├── vite.config.ts           # Vite フロントエンドビルド設定
├── package.json
├── tsconfig.json            # サーバー (Workers) 用
├── worker-configuration.d.ts  # wrangler types で自動生成 (gitignore)
├── frontend/               # フロントエンドソース (Vite でビルド)
│   ├── index.html           # SPA HTML エントリポイント
│   ├── main.ts              # TypeScript メイン (WebAuthn + 暗号化 + UI)
│   ├── style.css            # スタイル
│   └── tsconfig.json        # フロントエンド用 TypeScript 設定
├── public/                  # Vite ビルド出力 ※gitignore・コミット不要
│   ├── index.html
│   └── assets/
├── src/
│   ├── index.ts             # Hono エントリポイント
│   ├── routes/
│   │   ├── auth.ts          # WebAuthn 登録・認証 API
│   │   └── todos.ts         # TODO CRUD API
│   └── middleware/
│       └── auth.ts          # JWT セッション検証 (Web Crypto HMAC-SHA256)
└── migrations/
    └── 0001_initial.sql     # D1 スキーマ
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

## 開発コマンド

```bash
# 依存関係インストール
npm install

# 型定義生成（wrangler.jsonc のバインディングから）
npm run cf-typegen

# ローカル開発サーバー起動（Workers + D1 ローカル）
npm run dev

# フロントエンドのみ開発サーバー（Vite HMR、/api は :8787 にプロキシ）
npm run dev:frontend

# フロントエンドビルド（frontend/ → public/）
npm run build:frontend

# D1 データベース作成（初回のみ）
npm run db:create

# D1 マイグレーション適用（ローカル）
npm run db:migrate:local

# D1 マイグレーション適用（本番）
npm run db:migrate:remote

# TypeScript 型チェック（サーバーサイド）
npm run type-check

# コード品質チェック（vite-plus / Oxlint）
npm run lint

# フォーマット（vite-plus / Oxfmt）
npm run format

# デプロイ（vite build → wrangler deploy）
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

## デプロイ手順

### 初回セットアップ

1. **D1 データベース作成**
   ```bash
   npm run db:create
   # 出力された database_id を wrangler.jsonc の d1_databases[0].database_id に設定
   ```

2. **マイグレーション適用**
   ```bash
   npm run db:migrate:remote
   ```

3. **シークレット設定**
   ```bash
   npx wrangler secret put JWT_SECRET
   ```

4. **本番用 RP_ID・RP_ORIGIN を wrangler.jsonc に設定**

### GitHub 連携デプロイ（GitHub Actions は使わない）

1. リポジトリを GitHub にプッシュ
2. Cloudflare ダッシュボード → Workers & Pages → Create → Import a Repository
3. GitHub リポジトリを選択
4. ビルド設定:
   - **Build command**: `npm ci && npx vite build`
   - **Deploy command**: `npx wrangler deploy`（デフォルト）
   - **Production branch**: `master`（または `main`）
5. 接続後は `master` ブランチへのプッシュで自動デプロイ
   - Cloudflare 側で `npm ci && npx vite build` → `npx wrangler deploy` が実行される
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

## D1 スキーマ

| テーブル | 概要 |
|---------|------|
| `users` | ユーザー情報 |
| `credentials` | WebAuthn クレデンシャル |
| `challenges` | 短命チャレンジ（5 分有効） |
| `prf_salts` | PRF 鍵導出用ソルト（クレデンシャルごと） |
| `todos` | 暗号化 TODO（encrypted_data + iv のみ） |

## 注意事項

- PRF 拡張は HTTPS 環境でのみ動作（Workers はデフォルト HTTPS）
- ローカル開発は `localhost` で動作（ブラウザが HTTP を許可するため）
- `wrangler.jsonc` の `RP_ID` と `RP_ORIGIN` は本番ドメインに合わせて変更すること
- 複数パスキーを登録した場合、全 TODO の再暗号化が必要（`/api/todos/bulk` エンドポイント利用）
