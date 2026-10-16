import { readFile, rm } from "node:fs/promises";
import { publishLedger } from "./coverage-files";
import { runSchema } from "../packages/testing/coverage";
try {
  let run;
  try {
    run = runSchema.parse(
      JSON.parse(await readFile(".local/e2e-ledger/latest-run.json", "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const ledger = await publishLedger(run);
  console.log("Coverage ledger:", JSON.stringify(ledger.counts));
  console.log(
    "Open .local/e2e-ledger/index.html; machine-readable data: coverage.json.",
  );
} catch {
  await Promise.all(
    [".local/e2e-ledger/index.html", ".local/e2e-ledger/coverage.json"].map(
      (path) => rm(path, { force: true }),
    ),
  );
  console.error(
    "Coverage inventory/evidence could not be validated. No verified report generated.",
  );
  process.exitCode = 1;
}
