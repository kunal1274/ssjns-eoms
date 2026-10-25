import {
  randomBytes,
  scrypt as rawScrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(rawScrypt);
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(password: string, hash: string) {
  const validFormat = /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash);
  const [, salt, hex] = validFormat
    ? hash.split(":")
    : ["scrypt", "0".repeat(32), "0".repeat(128)];
  // Corrupt/unknown formats still take the normal derivation path and fail closed.
  const expected = Buffer.from(hex, "hex");
  const key = (await scrypt(password, salt, 64)) as Buffer;
  return timingSafeEqual(expected, key) && validFormat;
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("hex");
