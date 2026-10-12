import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, open } from "node:fs/promises";
const web = Number(process.env.VERIFY_WEB_PORT || 5274),
  pwa = Number(process.env.VERIFY_PWA_PORT || 5275),
  api = Number(process.env.VERIFY_API_PORT || 4200),
  pwaApi = Number(process.env.VERIFY_PWA_API_PORT || 4201);
const children = [];
await mkdir(".local", { recursive: true });
const log = await open(".local/browser-verification.log", "w", 0o600);
async function assertFree(port) {
  await new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(port, "127.0.0.1", () => s.close(resolve));
  });
}
function start(args, env) {
  const child = spawn(process.execPath, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", log.fd, log.fd],
  });
  children.push(child);
  return child;
}
async function ready(url, child) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null)
      throw Error(
        "Verification server exited; inspect .local/browser-verification.log",
      );
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {}
    await delay(200);
  }
  throw Error("Timed out waiting for " + url);
}
async function run(script) {
  await new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [script], {
      env: {
        ...process.env,
        BROWSER_BASE_URL: `http://localhost:${web}`,
        PWA_BASE_URL: `http://localhost:${pwa}`,
      },
      stdio: "inherit",
    });
    c.on("error", reject);
    c.on("exit", (code) =>
      code === 0 ? resolve() : reject(Error(script + " failed with " + code)),
    );
  });
}
try {
  for (const port of [web, pwa, api, pwaApi]) await assertFree(port);
  const a = start(["--import", "tsx", "apps/api/src/server.ts"], {
    API_PORT: String(api),
    WEB_ORIGIN: `http://localhost:${web}`,
  });
  const b = start(["--import", "tsx", "apps/api/src/server.ts"], {
    API_PORT: String(pwaApi),
    WEB_ORIGIN: `http://localhost:${pwa}`,
  });
  await ready(`http://127.0.0.1:${api}/api/health`, a);
  await ready(`http://127.0.0.1:${pwaApi}/api/health`, b);
  const v = start(
    ["node_modules/vite/bin/vite.js", "--config", "apps/web/vite.config.ts"],
    { WEB_PORT: String(web), API_TARGET: `http://127.0.0.1:${api}` },
  );
  const p = start(
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--config",
      "apps/web/vite.config.ts",
    ],
    { PWA_PORT: String(pwa), API_TARGET: `http://127.0.0.1:${pwaApi}` },
  );
  await ready(`http://localhost:${web}`, v);
  await ready(`http://localhost:${pwa}`, p);
  for (const script of [
    "scripts/browser-check.mjs",
    "scripts/maintenance-browser.mjs",
    "scripts/workflow-browser.mjs",
    "scripts/offline-browser.mjs",
    "scripts/check-install.mjs",
  ])
    await run(script);
  console.log(
    "All browser workflows verified; temporary servers are stopping.",
  );
} finally {
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(
    children.map((c) =>
      c.exitCode !== null
        ? Promise.resolve()
        : Promise.race([
            new Promise((r) => c.once("exit", r)),
            delay(3000).then(() => c.kill("SIGKILL")),
          ]),
    ),
  );
  await log.close();
}
