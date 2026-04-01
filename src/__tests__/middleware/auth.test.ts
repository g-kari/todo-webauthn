import { describe, it, expect } from "vitest";
import { createJwt, verifyJwt } from "../../middleware/auth";

const SECRET = "test-secret-for-vitest";

describe("createJwt", () => {
  it("header.payload.signature の3パート構成になる", async () => {
    const token = await createJwt({ userId: "u1", credentialId: "c1" }, SECRET);
    expect(token.split(".")).toHaveLength(3);
  });

  it("ペイロードに userId・credentialId・iat・exp が含まれる", async () => {
    const before = Math.floor(Date.now() / 1000);
    const token = await createJwt({ userId: "u1", credentialId: "c1" }, SECRET);
    const after = Math.floor(Date.now() / 1000);

    const [, payloadB64] = token.split(".");
    const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4;
    const json = atob(pad ? padded + "=".repeat(4 - pad) : padded);
    const payload = JSON.parse(json);

    expect(payload.userId).toBe("u1");
    expect(payload.credentialId).toBe("c1");
    expect(payload.iat).toBeGreaterThanOrEqual(before);
    expect(payload.iat).toBeLessThanOrEqual(after);
  });

  it("exp が iat の 7日後になる", async () => {
    const token = await createJwt({ userId: "u1", credentialId: "c1" }, SECRET);
    const [, payloadB64] = token.split(".");
    const padded = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4;
    const payload = JSON.parse(atob(pad ? padded + "=".repeat(4 - pad) : padded));

    expect(payload.exp - payload.iat).toBe(60 * 60 * 24 * 7);
  });
});

describe("verifyJwt", () => {
  it("有効なトークンのペイロードを返す", async () => {
    const token = await createJwt({ userId: "u1", credentialId: "c1" }, SECRET);
    const payload = await verifyJwt(token, SECRET);

    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe("u1");
    expect(payload?.credentialId).toBe("c1");
  });

  it("署名が改ざんされたトークンは null を返す", async () => {
    const token = await createJwt({ userId: "u1", credentialId: "c1" }, SECRET);
    const [h, p, _sig] = token.split(".");
    const tampered = `${h}.${p}.invalidsignature`;
    expect(await verifyJwt(tampered, SECRET)).toBeNull();
  });

  it("異なるシークレットで署名されたトークンは null を返す", async () => {
    const token = await createJwt({ userId: "u1", credentialId: "c1" }, "wrong-secret");
    expect(await verifyJwt(token, SECRET)).toBeNull();
  });

  it("3パート未満のトークンは null を返す", async () => {
    expect(await verifyJwt("not.a.valid.jwt", SECRET)).toBeNull();
    expect(await verifyJwt("invalid", SECRET)).toBeNull();
  });

  it("期限切れトークンは null を返す", async () => {
    // exp を過去に書き換えてトークンを再署名
    const encoder = new TextEncoder();
    const header = { alg: "HS256", typ: "JWT" };
    const expiredPayload = {
      userId: "u1",
      credentialId: "c1",
      iat: 1000000,
      exp: 1000001, // 過去
    };

    const toB64Url = (obj: unknown): string =>
      btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj))))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");

    const headerStr = toB64Url(header);
    const payloadStr = toB64Url(expiredPayload);
    const signingInput = `${headerStr}.${payloadStr}`;

    const keyData = encoder.encode(SECRET);
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    const expiredToken = `${signingInput}.${sigB64}`;
    expect(await verifyJwt(expiredToken, SECRET)).toBeNull();
  });
});
