---
paths:
  - "src/**/*.ts"
  - "wrangler.jsonc"
---

# Cloudflare Workers 規約

## デプロイ方針

- デプロイは **Cloudflare Workers Builds の GitHub 連携のみ**（GitHub Actions 不使用）
- `master` ブランチへの push で自動デプロイ
- `npm run build` = `node scripts/migrate.mjs && vite build`（migrate が先）

## wrangler.jsonc 変更時

1. 変更を加える
2. `npm run cf-typegen` で `worker-configuration.d.ts` を再生成する（git ignore 対象）
3. `npm run type-check` でエラーがないことを確認する

## Bindings 型

`src/index.ts` の `Bindings` 型に定義する。自動生成の `Env` 型は `worker-configuration.d.ts` に生成されるが、`JWT_SECRET` など secret は手動で追加が必要。

## 静的アセット

- フロントエンドのソースは `frontend/`
- ビルド出力は `public/`（`git ignore` 対象）
- `wrangler.jsonc` の `assets.run_worker_first: ["/api/*"]` で API は Worker へ、それ以外は静的ファイルへルーティング

## ローカル開発

```bash
# バックエンド（Workers + Turso 本番 DB）
npm run dev

# フロントエンドのみ（HMR あり、/api は :8787 にプロキシ）
npm run dev:frontend
```
