import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

/** AES-256-GCM, so a sealed value can be neither read nor altered without the key. */
export function secretBox(key: Buffer) {
  if (key.length !== 32) throw new TypeError("The key must be 32 bytes.");
  return {
    seal(value: unknown): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
      return [VERSION, iv, cipher.getAuthTag(), ciphertext].map((part) => (typeof part === "string" ? part : part.toString("base64url"))).join(".");
    },
    open<T>(sealed: string): T {
      const [version, iv, tag, ciphertext] = sealed.split(".");
      if (version !== VERSION || !iv || !tag || !ciphertext) throw new TypeError("Not a sealed value.");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]);
      return JSON.parse(plaintext.toString("utf8")) as T;
    },
  };
}
