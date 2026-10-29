import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hierarchyReadGrantInput } from "../packages/domain/hierarchy-scope";
import {
  hierarchyPage,
  readHierarchyPage,
} from "../apps/api/src/hierarchy-read-page";
test("hierarchy scope assignment requires an explicit named node and inheritance without accepting work or arbitrary permissions", () => {
  const body = {
    key: randomUUID(),
    subjectId: randomUUID(),
    nodeKind: "company",
    nodeId: randomUUID(),
    inheritance: "none",
    action: "granted",
    expectedRevision: 0,
    reference: "Controlled reference",
    reason: "Read hierarchy metadata only",
  };
  assert.equal(hierarchyReadGrantInput.safeParse(body).success, true);
  for (const extra of [
    { permission: "work.read" },
    { inheritance: "all-tenants" },
    { nodeKind: "database" },
    { expectedRevision: -1 },
  ])
    assert.equal(
      hierarchyReadGrantInput.safeParse({ ...body, ...extra }).success,
      false,
    );
});
test("hierarchy cursor binds kind and UUID plus exact account and filters and rejects tampering", () => {
  const id = randomUUID(),
    binding = { actor: "A", customer: "C", q: "", limit: 1 },
    page = hierarchyPage(
      [
        { kind: "company", id },
        { kind: "unit", id },
      ],
      1,
      binding,
    ),
    p = readHierarchyPage(page.nextCursor!, binding);
  assert.equal(p!.kind, "company");
  assert.equal(p!.id, id);
  assert.throws(() =>
    readHierarchyPage(page.nextCursor!, { ...binding, actor: "B" }),
  );
  assert.throws(() => readHierarchyPage("bad?", binding));
});
