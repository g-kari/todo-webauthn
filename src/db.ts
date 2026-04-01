import { createClient, type Client } from "@libsql/client/http";

/**
 * Turso (libSQL) クライアントを生成する
 * Cloudflare Workers では HTTP トランスポートを使用する
 */
export function createDbClient(url: string, authToken: string): Client {
  return createClient({ url, authToken });
}

/** execute の結果行を型付きで返すヘルパー */
export function toRows<T>(result: Awaited<ReturnType<Client["execute"]>>): T[] {
  return result.rows as unknown as T[];
}

/** 最初の行だけ返すヘルパー（D1 の .first<T>() 相当） */
export function firstRow<T>(result: Awaited<ReturnType<Client["execute"]>>): T | null {
  return (result.rows[0] as unknown as T) ?? null;
}
