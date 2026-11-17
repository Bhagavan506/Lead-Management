import { randomInt } from "node:crypto";

// No 0/O/1/l/I so it can be read out or typed from a message without mistakes.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/** Cryptographically random temporary password, shown to the admin exactly once. */
export function generateTempPassword(length = 14): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
