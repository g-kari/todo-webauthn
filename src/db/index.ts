export type { DbAdapter } from "./adapter";
export type * from "./types";
export { createTursoAdapter } from "./turso";
export { createD1Adapter } from "./d1";

import type { Bindings } from "../index";
import { createTursoAdapter } from "./turso";
// D1 に切り替える場合:
// import { createD1Adapter } from './d1';

import type { DbAdapter } from "./adapter";

/**
 * 環境変数に応じて DB アダプターを生成するファクトリ
 *
 * Turso 使用時:
 *   env.TURSO_DATABASE_URL と env.TURSO_AUTH_TOKEN が必要
 *
 * D1 に切り替える場合:
 *   1. wrangler.jsonc に d1_databases バインディングを追加
 *   2. Bindings に DB: D1Database を追加
 *   3. このファクトリを createD1Adapter(env.DB) に変更
 */
export function createDb(env: Bindings): DbAdapter {
  return createTursoAdapter(env.TURSO_DATABASE_URL, env.TURSO_AUTH_TOKEN);
  // D1 に切り替える場合:
  // return createD1Adapter((env as unknown as { DB: D1Database }).DB);
}
