import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
  TestStep,
} from "@playwright/test/reporter";
import {
  sourceFingerprint,
  loadInventory,
  saveEvidence,
} from "./coverage-files";
import { type RunEvidence } from "../packages/testing/coverage";
const identify = (test: TestCase) =>
  test.title.match(/^(E2E-JRN-\d{2}-\d{3})\b/)?.[1];
function assertionSteps(steps: TestStep[]): string[] {
  const hasAssertion = (s: TestStep): boolean =>
    s.category === "expect" || s.steps.some(hasAssertion);
  return steps.flatMap((s) => [
    ...(s.category === "test.step" && !s.error && hasAssertion(s)
      ? [s.title]
      : []),
    ...assertionSteps(s.steps),
  ]);
}
export default class CoverageReporter implements Reporter {
  private run?: RunEvidence;
  private errors = 0;
  onBegin(_config: FullConfig, suite: Suite) {
    const inventory = loadInventory();
    const selected = suite.allTests().map((test) => ({
      caseId: identify(test) || "",
      project: test.parent.project()!.name,
    }));
    if (
      _config.projects.some((p) => !inventory.projects.includes(p.name)) ||
      inventory.projects.some(
        (p) => !_config.projects.some((c) => c.name === p),
      ) ||
      selected.some(
        (c) => !inventory.items.some((i) => i.binding?.caseId === c.caseId),
      )
    ) {
      this.errors++;
      throw Error(
        "Coverage inventory must include configured projects and selected case IDs.",
      );
    }
    if (
      selected.some((t) => !t.caseId) ||
      new Set(selected.map((t) => t.project + ":" + t.caseId)).size !==
        selected.length
    ) {
      this.errors++;
      throw Error("Coverage requires unique stable case IDs per project.");
    }
    this.run = {
      schemaVersion: 1,
      fingerprint: sourceFingerprint(),
      sourceCommit: process.env.GITHUB_SHA || "local-unversioned",
      runId: process.env.GITHUB_RUN_ID || "local-" + Date.now(),
      environment: "local-eoms_test",
      startedAt: new Date().toISOString(),
      status: "running",
      selected,
      cases: [],
      errors: 0,
    };
    saveEvidence(this.run);
  }
  onError() {
    this.errors++;
  }
  onTestEnd(test: TestCase, result: TestResult) {
    if (!this.run) return;
    const id = identify(test)!;
    const project = test.parent.project()!.name;
    let row = this.run.cases.find(
      (r) => r.caseId === id && r.project === project,
    );
    if (!row) {
      row = {
        caseId: id,
        project,
        expectedStatus: test.expectedStatus,
        attempts: [],
      };
      this.run.cases.push(row);
    }
    row.attempts.push({
      status: result.status,
      assertionSteps: assertionSteps(result.steps),
    });
  }
  async onEnd(result: FullResult) {
    if (!this.run) {
      this.errors++;
      this.run = {
        schemaVersion: 1,
        fingerprint: sourceFingerprint(),
        sourceCommit: process.env.GITHUB_SHA || "local-unversioned",
        runId: process.env.GITHUB_RUN_ID || "local-" + Date.now(),
        environment: "local-eoms_test",
        startedAt: new Date().toISOString(),
        status: "failed",
        selected: [],
        cases: [],
        errors: this.errors,
      };
    }
    this.run.status = result.status;
    this.run.finishedAt = new Date().toISOString();
    this.run.errors = this.errors;
    let ledger = saveEvidence(this.run);
    const invalid =
      ledger.rows.some((r) =>
        ["mapping-error", "flaky", "stale"].includes(r.status),
      ) || this.errors > 0;
    if (invalid) {
      this.run.status = "failed";
      this.run.errors++;
      ledger = saveEvidence(this.run);
    }
    console.log(
      "Assertion coverage ledger:",
      JSON.stringify(ledger.counts),
      "(.local/e2e-ledger/index.html)",
    );
    if (invalid) return { status: "failed" as const };
  }
}
