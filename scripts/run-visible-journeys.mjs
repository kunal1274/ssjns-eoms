import { spawn } from "node:child_process";
console.log(
  "Visible journey replay: Chrome will open on this computer. Use synthetic test data; the suite creates and changes test records.",
);
const child = spawn(process.execPath, ["scripts/verify-browser.mjs"], {
  env: {
    ...process.env,
    E2E_HEADED: "1",
    E2E_SLOW_MO_MS: process.env.E2E_SLOW_MO_MS || "350",
  },
  stdio: "inherit",
});
child.on("error", () => {
  console.error("Could not start the journey verifier.");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
