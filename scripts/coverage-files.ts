import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import {
  buildLedger,
  inventorySchema,
  renderLedger,
  runSchema,
  type RunEvidence,
} from "../packages/testing/coverage";
export function sourceFingerprint(root = process.cwd()) {
  const files: string[] = [];
  function walk(path: string) {
    for (const entry of readdirSync(join(root, path), {
      withFileTypes: true,
    })) {
      if (
        ["dist", "node_modules", ".local"].includes(entry.name) ||
        entry.name.startsWith(".")
      )
        continue;
      const next = join(path, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (entry.isFile()) files.push(next);
    }
  }
  for (const dir of ["apps", "packages", "db", "tests/e2e", "scripts"])
    walk(dir);
  files.push(
    "package.json",
    "package-lock.json",
    "playwright.config.ts",
    "tsconfig.json",
  );
  const hash = createHash("sha256");
  for (const path of files.sort())
    hash
      .update(relative(root, join(root, path)))
      .update("\0")
      .update(readFileSync(join(root, path)))
      .update("\0");
  return hash.digest("hex");
}
export function loadInventory() {
  return inventorySchema.parse(
    JSON.parse(readFileSync("tests/e2e/coverage-inventory.json", "utf8")),
  );
}
function atomic(path: string, value: string) {
  mkdirSync(".local/e2e-ledger", { recursive: true, mode: 0o700 });
  writeFileSync(path + ".tmp", value, { mode: 0o600 });
  renameSync(path + ".tmp", path);
}
export function publishLedger(run?: RunEvidence) {
  const inventory = loadInventory();
  const ledger = buildLedger(inventory, run, sourceFingerprint());
  atomic(".local/e2e-ledger/coverage.json", JSON.stringify(ledger, null, 2));
  atomic(".local/e2e-ledger/index.html", renderLedger(ledger));
  return ledger;
}
export function saveEvidence(run: RunEvidence) {
  atomic(
    ".local/e2e-ledger/latest-run.json",
    JSON.stringify(runSchema.parse(run), null, 2),
  );
  return publishLedger(run);
}
