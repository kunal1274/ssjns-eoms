import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  readdirSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import {
  buildLedger,
  inventorySchema,
  renderLedger,
  runSchema,
  type RunEvidence,
} from "../packages/testing/coverage";
import { sourceFingerprint } from "../scripts/coverage-files";
const fingerprint = "a".repeat(64);
const inventory = inventorySchema.parse({
  schemaVersion: 1,
  scope: "Test fixture only",
  projects: ["desktop", "mobile"],
  items: [
    {
      id: "COV-EMAIL",
      journey: "JRN-03",
      screen: "Sign in",
      category: "field",
      control: "Email",
      assertion: "Required email",
      binding: { caseId: "E2E-JRN-03-001", step: "Assert required email" },
    },
    {
      id: "COV-GAP",
      journey: "JRN-03",
      screen: "Sign in",
      category: "action",
      control: "Revoke",
      assertion: "Revoked session denial",
    },
  ],
});
function evidence(): RunEvidence {
  return {
    schemaVersion: 1,
    fingerprint,
    sourceCommit: "fixture-not-real-evidence",
    runId: "unit-fixture",
    environment: "unit",
    startedAt: new Date().toISOString(),
    status: "passed",
    errors: 0,
    selected: [{ caseId: "E2E-JRN-03-001", project: "desktop" }],
    cases: [
      {
        caseId: "E2E-JRN-03-001",
        project: "desktop",
        expectedStatus: "passed",
        attempts: [
          { status: "passed", assertionSteps: ["Assert required email"] },
        ],
      },
    ],
  };
}
const status = (run?: RunEvidence, hash = fingerprint) =>
  buildLedger(inventory, run, hash).rows[0].status;
test("only actual selected assertion evidence can pass; unmapped and unselected rows stay open", () => {
  assert.equal(status(), "not-run");
  const report = buildLedger(inventory, evidence(), fingerprint);
  assert.deepEqual(
    report.rows.map((r) => r.status),
    ["passed", "not-run", "untested", "untested"],
  );
  const missing = evidence();
  missing.cases[0].attempts[0].assertionSteps = [];
  assert.equal(status(missing), "mapping-error");
});
test("failures, retries, skips, interruptions and global errors never become green", () => {
  const run = evidence();
  for (const [actual, expected] of [
    ["failed", "failed"],
    ["timedOut", "failed"],
    ["skipped", "skipped"],
    ["interrupted", "cancelled"],
  ] as const) {
    run.cases[0].attempts[0].status = actual;
    assert.equal(status(run), expected);
  }
  run.cases[0].attempts.push({
    status: "passed",
    assertionSteps: ["Assert required email"],
  });
  assert.equal(status(run), "flaky");
  const failure = evidence();
  failure.status = "failed";
  assert.equal(status(failure), "blocked");
  failure.status = "passed";
  failure.errors = 1;
  assert.equal(status(failure), "blocked");
  const expectedFailure = evidence();
  expectedFailure.cases[0].expectedStatus = "failed";
  assert.equal(status(expectedFailure), "failed");
});
test("a changed fingerprint marks old evidence stale while retaining prior failure", () => {
  const run = evidence();
  run.cases[0].attempts[0].status = "failed";
  const row = buildLedger(inventory, run, "b".repeat(64)).rows[0];
  assert.equal(row.status, "stale");
  assert.equal(row.previousStatus, "failed");
  run.status = "running";
  assert.equal(status(run), "running");
  run.status = "interrupted";
  assert.equal(status(run), "cancelled");
});
test("malformed or duplicate evidence and inventory cannot silently choose an old pass", () => {
  const duplicate = evidence();
  duplicate.cases.push(structuredClone(duplicate.cases[0]));
  assert.throws(() => runSchema.parse(duplicate));
  const unselected = evidence();
  unselected.selected = [];
  assert.throws(() => runSchema.parse(unselected));
  assert.throws(() => runSchema.parse({ status: "passed" }));
  assert.throws(() =>
    inventorySchema.parse({
      ...inventory,
      items: [inventory.items[0], inventory.items[0]],
    }),
  );
});
test("HTML output escapes inventory/metadata and preserves textual status labels", () => {
  const input = structuredClone(inventory);
  input.items[0].control = '<script>alert("private")</script>';
  const html = renderLedger(buildLedger(input, undefined, fingerprint));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes('<script>alert("private")'));
  assert.ok(html.includes("not-run"));
  assert.ok(html.includes("No runner assertion mapped"));
});
test("fingerprints detect source/test/inventory changes and ignore generated output/secrets", () => {
  const root = mkdtempSync(join(tmpdir(), "eoms-ledger-"));
  try {
    for (const dir of [
      "apps",
      "packages",
      "db",
      "tests/e2e",
      "scripts",
      "apps/web/dist",
    ])
      mkdirSync(join(root, dir), { recursive: true });
    for (const file of [
      "package.json",
      "package-lock.json",
      "playwright.config.ts",
      "tsconfig.json",
    ])
      writeFileSync(join(root, file), "fixture");
    writeFileSync(join(root, "apps/app.ts"), "original");
    const original = sourceFingerprint(root);
    writeFileSync(join(root, ".env"), "SECRET");
    writeFileSync(join(root, "apps/web/dist/output.js"), "generated");
    assert.equal(sourceFingerprint(root), original);
    writeFileSync(join(root, "apps/app.ts"), "changed");
    assert.notEqual(sourceFingerprint(root), original);
    const codeHash = sourceFingerprint(root);
    writeFileSync(
      join(root, "tests/e2e/coverage-inventory.json"),
      "new assertions",
    );
    assert.notEqual(sourceFingerprint(root), codeHash);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("real inventory bindings point to named steps inside their actual test cases", () => {
  const real = inventorySchema.parse(
    JSON.parse(readFileSync("tests/e2e/coverage-inventory.json", "utf8")),
  );
  const cases = new Map<string, Set<string>>();
  for (const file of readdirSync("tests/e2e").filter((f) =>
    f.endsWith(".spec.ts"),
  )) {
    const source = ts.createSourceFile(
      file,
      readFileSync("tests/e2e/" + file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(source) === "test" &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const id = node.arguments[0].text.match(
          /^(E2E-JRN-\d{2}-\d{3})\b/,
        )?.[1];
        if (id) {
          const steps = new Set<string>();
          function find(n: ts.Node) {
            if (
              ts.isCallExpression(n) &&
              n.expression.getText(source) === "test.step" &&
              ts.isStringLiteral(n.arguments[0])
            )
              steps.add(n.arguments[0].text);
            ts.forEachChild(n, find);
          }
          find(node);
          assert.ok(!cases.has(id), "Duplicate case ID");
          cases.set(id, steps);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  for (const item of real.items)
    if (item.binding)
      assert.ok(
        cases.get(item.binding.caseId)?.has(item.binding.step),
        item.id + " has an invalid binding",
      );
});
