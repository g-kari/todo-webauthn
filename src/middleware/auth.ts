import { type Context, type MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { Bindings } from "../index";

export interface SessionPayload {
  userId: string;
  credentialId: string;
  iat: number;
  exp: number;
}

type Variables = {
  userId: string;
  credentialId: string;
};

// Web Crypto API を使った HMAC-SHA256 JWT 実装
// Cloudflare Workers は Node.js の crypto モジュールを使えないため

function base64UrlEncode(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let str = "";
  for (const byte of bytes) {
    str += String.fromCharCode(byte);
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64UrlDecode(str: string): ArrayBuffer {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  const paddedStr = pad ? padded + "=".repeat(4 - pad) : padded;
  const binary = atob(paddedStr);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function getSigningKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  return crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function createJwt(
  payload: Omit<SessionPayload, "iat" | "exp">,
  secret: string,
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: SessionPayload = {
    ...payload,
    iat: now,
    exp: now + 60 * 60 * 24 * 7, // 7日間
  };

  const encoder = new TextEncoder();
  const headerStr = base64UrlEncode(encoder.encode(JSON.stringify(header)).buffer as ArrayBuffer);
  const payloadStr = base64UrlEncode(
    encoder.encode(JSON.stringify(fullPayload)).buffer as ArrayBuffer,
  );
  const signingInput = `${headerStr}.${payloadStr}`;

  const key = await getSigningKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export async function verifyJwt(token: string, secret: string): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerStr, payloadStr, signatureStr] = parts;
  const signingInput = `${headerStr}.${payloadStr}`;

  try {
    const key = await getSigningKey(secret);
    const encoder = new TextEncoder();
    const signature = base64UrlDecode(signatureStr);

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      encoder.encode(signingInput).buffer as ArrayBuffer,
    );
    if (!valid) return null;

    const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadStr));
    const payload = JSON.parse(payloadJson) as SessionPayload;

    if (payload.exp < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

export function requireAuth(): MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> {
  return async (c: Context<{ Bindings: Bindings; Variables: Variables }>, next) => {
    const token = getCookie(c, "session");
    if (!token) {
      return c.json({ error: "認証が必要ですわ" }, 401);
    }

    const payload = await verifyJwt(token, c.env.JWT_SECRET);
    if (!payload) {
      return c.json({ error: "セッションが無効ですわ" }, 401);
    }

    c.set("userId", payload.userId);
    c.set("credentialId", payload.credentialId);
    await next();
  };
}
