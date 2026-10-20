import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class Vault {
  constructor(private readonly key: Buffer) {}

  encrypt(plaintext: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${nonce.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
  }

  decrypt(payload: string): string {
    const [version, nonceText, tagText, ciphertextText] = payload.split(":");
    if (version !== "v1" || !nonceText || !tagText || !ciphertextText) throw new Error("Unsupported encrypted credential format.");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(nonceText, "base64url"));
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
  }
}
