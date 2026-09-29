import "../apps/api/src/config.ts";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { passwordHash } from "../apps/api/src/security.ts";
if (process.env.NODE_ENV === "production")
  throw Error("Development seed cannot run in production");
const pool = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const c = await pool.connect();
const company = "10000000-0000-4000-8000-000000000001";
const estates = [
  {
    id: "20000000-0000-4000-8000-000000000001",
    code: "SN",
    name: "Senama Estate",
  },
  {
    id: "20000000-0000-4000-8000-000000000002",
    code: "IB",
    name: "Ibam Estate",
  },
];
const credentials: { email: string; password: string; role: string }[] = [];
try {
  await c.query("BEGIN");
  await c.query(
    "INSERT INTO eoms.companies(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [company, "STM Development Company"],
  );
  for (const e of estates) {
    await c.query(
      "INSERT INTO eoms.estates(id,company_id,code,name) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [e.id, company, e.code, e.name],
    );
    await c.query(
      "INSERT INTO eoms.periods(estate_id,month) VALUES($1,'2026-09-01'),($1,'2026-10-01') ON CONFLICT DO NOTHING",
      [e.id],
    );
    for (let i = 1; i <= 4; i++)
      await c.query(
        "INSERT INTO eoms.workers(estate_id,code,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [
          e.id,
          `${e.code}-W${i}`,
          e.code === "SN"
            ? ["Amir Rahman", "Budi Santoso", "Ravi Kumar", "Dimas Putra"][
                i - 1
              ]
            : ["Farid Hassan", "Jaya Pratama", "Rajan Dev", "Eko Saputra"][
                i - 1
              ],
        ],
      );
    for (let i = 1; i <= 3; i++)
      await c.query(
        "INSERT INTO eoms.occurrences(estate_id,block_code,task_code,activity,round_code,capacity_ha) VALUES($1,$2,$3,'Circle spraying','2026-R3',2) ON CONFLICT DO NOTHING",
        [e.id, e.code + "-01", "T0" + i],
      );
  }
  const accounts = [
    {
      email: "manager@eoms.local",
      name: "Development Manager",
      role: "manager",
      estates: estates.map((e) => e.id),
    },
    {
      email: "supervisor@eoms.local",
      name: "Senama Supervisor",
      role: "supervisor",
      estates: [estates[0].id],
    },
    {
      email: "ibam@eoms.local",
      name: "Ibam Supervisor",
      role: "supervisor",
      estates: [estates[1].id],
    },
    {
      email: "clerk@eoms.local",
      name: "Senama Clerk",
      role: "clerk",
      estates: [estates[0].id],
    },
  ];
  for (const a of accounts) {
    const existing = await c.query("SELECT id FROM eoms.users WHERE email=$1", [
      a.email,
    ]);
    let id = existing.rows[0]?.id;
    if (!id) {
      const password = randomBytes(18).toString("base64url");
      const row = await c.query(
        "INSERT INTO eoms.users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id",
        [a.email, a.name, await passwordHash(password)],
      );
      id = row.rows[0].id;
      credentials.push({ email: a.email, password, role: a.role });
    }
    for (const estateId of a.estates)
      await c.query(
        "INSERT INTO eoms.memberships(user_id,estate_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [id, estateId, a.role],
      );
  }
  await c.query("COMMIT");
  if (credentials.length) {
    await mkdir(".local", { recursive: true });
    let old: any[] = [];
    try {
      old = JSON.parse(
        await readFile(
          process.env.ACCOUNTS_FILE || ".local/dev-accounts.json",
          "utf8",
        ),
      );
    } catch {}
    await writeFile(
      process.env.ACCOUNTS_FILE || ".local/dev-accounts.json",
      JSON.stringify(
        [
          ...old.filter((x) => !credentials.some((y) => y.email === x.email)),
          ...credentials,
        ],
        null,
        2,
      ),
      { mode: 0o600 },
    );
  }
  console.log(
    "Development data ready. Credentials stored only in ignored .local/dev-accounts.json.",
  );
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await pool.end();
}
