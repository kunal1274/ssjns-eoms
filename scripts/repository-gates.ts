// Read-only inspection. This script does not configure GitHub or merge code.
import { pathToFileURL } from "node:url";
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
export function repositoryGateProblems(value: unknown): string[] {
  const policy = object(value),
    checks = object(policy.required_status_checks),
    reviews = object(policy.required_pull_request_reviews);
  const problems: string[] = [];
  if (checks.strict !== true)
    problems.push("Require the branch to be up to date before merging.");
  if (
    !Array.isArray(checks.contexts) ||
    !checks.contexts.includes("quality-gate")
  )
    problems.push("Require the quality-gate status check.");
  if (object(policy.enforce_admins).enabled !== true)
    problems.push("Enforce the rules for administrators.");
  if (
    Number(reviews.required_approving_review_count) < 1 ||
    !Number.isFinite(Number(reviews.required_approving_review_count))
  )
    problems.push("Require at least one independent review.");
  if (reviews.dismiss_stale_reviews !== true)
    problems.push("Dismiss approvals after changes.");
  if (reviews.require_last_push_approval !== true)
    problems.push("Require approval of the last push.");
  if (object(policy.required_linear_history).enabled !== true)
    problems.push("Require linear history.");
  if (object(policy.allow_force_pushes).enabled !== false)
    problems.push("Disable force pushes.");
  if (object(policy.allow_deletions).enabled !== false)
    problems.push("Disable branch deletion.");
  if (object(policy.required_conversation_resolution).enabled !== true)
    problems.push("Require conversation resolution.");
  return problems;
}
async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY || "kunal1274/ssjns-eoms";
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo))
    throw Error("Use owner/repository for GITHUB_REPOSITORY.");
  if (!token)
    throw Error(
      "GITHUB_TOKEN with repository Administration read access is required to verify settings. Do not print or commit it.",
    );
  const response = await fetch(
    `https://api.github.com/repos/${repo}/branches/main/protection`,
    {
      signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response.ok)
    throw Error(
      `Cannot verify main protection (HTTP ${response.status}). Check protection settings and administrator read access. No settings were changed.`,
    );
  const problems = repositoryGateProblems(await response.json());
  if (problems.length) {
    console.error(JSON.stringify({ status: "not-accepted", problems }));
    process.exitCode = 1;
  } else
    console.log(
      JSON.stringify({ status: "accepted", requiredCheck: "quality-gate" }),
    );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      "Repository protection could not be verified. Check administrator read access and documented settings; no settings were changed.",
    );
    process.exitCode = 1;
  });
