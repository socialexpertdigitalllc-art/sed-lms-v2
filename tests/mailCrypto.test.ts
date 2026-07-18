// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { randomBytes } from "crypto";
import { encryptSecret, decryptSecret } from "@/lib/mail/crypto";

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");

describe("mail crypto (AES-256-GCM)", () => {
  beforeEach(() => {
    process.env.MAILBOX_ENC_KEY = KEY_A;
  });

  it("round-trips a secret", () => {
    const plain = "hunter2-p@ss word";
    const cipher = encryptSecret(plain);
    expect(cipher).not.toContain(plain);
    expect(cipher.split(":")).toHaveLength(3);
    expect(decryptSecret(cipher)).toBe(plain);
  });

  it("produces a different ciphertext each call (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("fails the auth tag when the ciphertext is tampered", () => {
    const cipher = encryptSecret("secret");
    const [iv, tag, data] = cipher.split(":");
    const bytes = Buffer.from(data, "base64");
    bytes[0] = bytes[0] ^ 0xff; // flip a bit
    const tampered = [iv, tag, bytes.toString("base64")].join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("fails to decrypt with the wrong key", () => {
    const cipher = encryptSecret("secret");
    process.env.MAILBOX_ENC_KEY = KEY_B;
    expect(() => decryptSecret(cipher)).toThrow();
  });

  it("throws when the key is missing or wrong length", () => {
    delete process.env.MAILBOX_ENC_KEY;
    expect(() => encryptSecret("x")).toThrow(/MAILBOX_ENC_KEY/);
    process.env.MAILBOX_ENC_KEY = Buffer.from("tooshort").toString("base64");
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });
});
