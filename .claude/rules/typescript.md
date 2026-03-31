# TypeScript コーディング規約

## 基本方針

- `strict: true` を維持する。型エラーを `any` で誤魔化さない
- `as unknown as T` は避けられない外部ライブラリとの境界でのみ許可
- 非 null アサーション `!` は DOM 要素取得（`getElementById`）に限定する

## 型定義

- 型は `src/db/types.ts` に集約する（DBの型定義）
- `interface` を優先する（`type` は Union/Intersection が必要なときのみ）
- 関数の戻り値型は明示する（特に `async` 関数）

## 非同期処理

- `async/await` を使う（Promise チェーンは使わない）
- エラーハンドリングは `try/catch` で行い、エラー型は `unknown` で受けて `(err as Error).message` でアクセスする

## Cloudflare Workers 固有

- Node.js 組み込みモジュール（`crypto`, `Buffer` 等）は使わない
- 暗号処理は `crypto.subtle`（Web Crypto API）のみ使用
- `ArrayBuffer` と `Uint8Array` の変換には明示的なキャストが必要な場合がある（`.buffer as ArrayBuffer`）

## 命名規則

- 変数・関数: `camelCase`
- 型・インターフェース: `PascalCase`
- 定数: `UPPER_SNAKE_CASE`（モジュールスコープのみ）
- ファイル名: `kebab-case.ts`
