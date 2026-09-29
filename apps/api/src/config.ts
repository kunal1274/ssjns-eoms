import { loadEnvFile } from "node:process";
try {
  loadEnvFile(".env");
} catch {}
export function databaseURL() {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL is required");
  return process.env.DATABASE_URL;
}
export const webOrigin = process.env.WEB_ORIGIN || "http://localhost:5174";
