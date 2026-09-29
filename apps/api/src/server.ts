import { databaseURL } from "./config.ts";
import pg from "pg";
import { createApp } from "./app.ts";
if (process.env.NODE_ENV === "production")
  throw Error(
    "Production deployment is gated pending identity, HTTPS, tenancy and operations review. See docs/STATUS.md.",
  );
const pool = new pg.Pool({
  connectionString: databaseURL(),
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
const roles = await pool.query(
  "SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
);
if (roles.rows[0].rolsuper || roles.rows[0].rolbypassrls)
  throw Error("Refusing privileged database runtime");
const server = createApp(pool).listen(
  Number(process.env.API_PORT || 4100),
  "127.0.0.1",
  () =>
    console.log(
      "EOMS API ready at http://127.0.0.1:" +
        String(process.env.API_PORT || 4100),
    ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    }),
  );
