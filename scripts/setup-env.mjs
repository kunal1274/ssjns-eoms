import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
const admin = randomBytes(24).toString("hex"),
  app = randomBytes(24).toString("hex");
try {
  await writeFile(
    ".env",
    `POSTGRES_PASSWORD=${admin}\nAPP_DB_PASSWORD=${app}\nDATABASE_URL=postgresql://eoms_app:${app}@127.0.0.1:55432/eoms\nADMIN_DATABASE_URL=postgresql://postgres:${admin}@127.0.0.1:55432/eoms\nAPI_PORT=4100\nWEB_ORIGIN=http://localhost:5174\nNODE_ENV=development\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log("Created local .env with random secrets.");
} catch (e) {
  if (e.code === "EEXIST") console.log("Existing .env preserved.");
  else throw e;
}
