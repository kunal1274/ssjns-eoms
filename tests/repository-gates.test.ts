import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { repositoryGateProblems } from "../scripts/repository-gates.ts";
const good = () => ({
  required_status_checks: { strict: true, contexts: ["quality-gate"] },
  enforce_admins: { enabled: true },
  required_pull_request_reviews: {
    required_approving_review_count: 1,
    dismiss_stale_reviews: true,
    require_last_push_approval: true,
  },
  required_linear_history: { enabled: true },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
  required_conversation_resolution: { enabled: true },
});
test("only a successful verification result allows the aggregate gate", () => {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  const command = workflow.match(
    /run: (test "\$VERIFY_RESULT" = success)/,
  )?.[1];
  assert.ok(command);
  for (const result of [
    "success",
    "failure",
    "cancelled",
    "skipped",
    "pending",
    "",
    "SUCCESS",
  ]) {
    const actual: { status: number | null } = spawnSync(
      "bash",
      ["-c", command],
      {
        env: { ...process.env, VERIFY_RESULT: result },
      },
    );
    assert.equal(actual.status === 0, result === "success");
  }
  assert.match(workflow, /quality-gate:/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /VERIFY_RESULT: \$\{\{ needs.verify.result \}\}/);
  assert.match(workflow, /test "\$VERIFY_RESULT" = success/);
  assert.doesNotMatch(workflow, /continue-on-error: true/);
});
test("repository protection audit fails closed for missing or weakened settings", () => {
  assert.deepEqual(repositoryGateProblems(good()), []);
  for (const input of [
    undefined,
    null,
    {},
    { required_status_checks: { contexts: ["quality-gate"] } },
  ])
    assert.ok(repositoryGateProblems(input).length > 0);
  for (const key of [
    "enforce_admins",
    "required_linear_history",
    "allow_force_pushes",
    "allow_deletions",
    "required_conversation_resolution",
  ] as const) {
    const policy = good();
    policy[key].enabled = !policy[key].enabled;
    assert.ok(repositoryGateProblems(policy).length > 0);
  }
  const noCheck = good();
  noCheck.required_status_checks.contexts = [];
  assert.ok(
    repositoryGateProblems(noCheck).some((p) => p.includes("quality-gate")),
  );
  const noReview = good();
  noReview.required_pull_request_reviews.required_approving_review_count = 0;
  assert.ok(repositoryGateProblems(noReview).some((p) => p.includes("review")));
});
test("prepared administrator configuration requires checks/reviews and prevents force pushes/deletion", () => {
  const policy = JSON.parse(
    readFileSync(".github/branch-protection.main.json", "utf8"),
  );
  assert.deepEqual(policy.required_status_checks.contexts, ["quality-gate"]);
  assert.equal(policy.required_status_checks.strict, true);
  assert.equal(policy.enforce_admins, true);
  assert.equal(
    policy.required_pull_request_reviews.required_approving_review_count,
    1,
  );
  assert.equal(
    policy.required_pull_request_reviews.require_last_push_approval,
    true,
  );
  assert.equal(policy.allow_force_pushes, false);
  assert.equal(policy.allow_deletions, false);
});
