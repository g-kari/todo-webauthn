import { describe, it, expect } from "vitest";
import { generateId, generateBase64URLId } from "../utils";

describe("generateId", () => {
  it("32文字の16進数文字列を生成する", () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("呼び出しごとに異なる値を返す", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe("generateBase64URLId", () => {
  it("Base64URL 文字のみで構成される", () => {
    const id = generateBase64URLId();
    expect(id).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it("パディング文字 '=' を含まない", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateBase64URLId()).not.toContain("=");
    }
  });

  it("32バイト = 43文字の Base64URL になる", () => {
    // 32 bytes → base64: ceil(32/3)*4 = 44 chars, padding 1 → 43 without padding
    const id = generateBase64URLId();
    expect(id.length).toBe(43);
  });

  it("呼び出しごとに異なる値を返す", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateBase64URLId()));
    expect(ids.size).toBe(100);
  });
});
