import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { secretBox } from "../../src/ai/secret-box";

describe("secretBox", () => {
  const box = secretBox(randomBytes(32));

  it("opens what it sealed", () => {
    const value = { accessToken: "a", refreshToken: "r", nested: [1, "ő"] };
    expect(box.open(box.seal(value))).toEqual(value);
  });

  it("seals the same value differently each time", () => {
    expect(box.seal("same")).not.toBe(box.seal("same"));
  });

  it("refuses a value sealed with another key", () => {
    expect(() => secretBox(randomBytes(32)).open(box.seal("secret"))).toThrow();
  });

  it("refuses a tampered value", () => {
    const [version, iv, tag, ciphertext] = box.seal("secret").split(".");
    const flipped = Buffer.from(ciphertext!, "base64url");
    flipped[0]! ^= 1;
    expect(() => box.open([version, iv, tag, flipped.toString("base64url")].join("."))).toThrow();
  });

  it("only takes a 32-byte key", () => {
    expect(() => secretBox(randomBytes(16))).toThrow();
  });
});
