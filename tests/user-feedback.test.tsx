import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { AuditTrail } from "../apps/web/src/AuditTrail";
import { requestFailure, connectionFailure } from "../apps/web/src/feedback";

test("public error messages retain valid correlation and explain recovery", () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  assert.match(
    requestFailure(409, { error: "Record changed", requestId: id }),
    /Record changed\nReload.*Support reference:/s,
  );
  assert.match(requestFailure(401, {}), /Sign in again/);
  assert.match(requestFailure(422, {}), /required fields/);
  assert.match(requestFailure(429, {}), /Wait a moment/);
  assert.match(requestFailure(503, null, id), /Support reference:/);
  assert.match(connectionFailure, /may already have been saved/);
});
test("server failures never reflect raw private bodies or invalid support references", () => {
  for (const status of [500, 503]) {
    const rendered = requestFailure(status, {
      error: "private SQL password",
      stack: "private-stack",
      requestId: "private-token",
    });
    assert.doesNotMatch(
      rendered,
      /private|SQL|password|stack|Support reference/,
    );
    assert.match(rendered, /before retrying/);
  }
});
test("audit offers short and detailed views without dumping snapshots or invented history", () => {
  const html = renderToStaticMarkup(
    <AuditTrail
      events={[
        {
          id: 1,
          action: "muster.reversed",
          actor: "Test reviewer",
          created_at: "2026-10-16T10:00:00Z",
          record_id: "record-1",
          detail: {
            reason: "Duplicate work",
            previousVersion: 2,
            version: 3,
            snapshot: { bank: "SECRET-BANK" },
            token: "SECRET-TOKEN",
          },
        },
      ]}
    />,
  );
  assert.match(html, /Muster reversed/);
  assert.match(html, /<details><summary>View event details/);
  assert.match(html, /Duplicate work/);
  assert.match(html, /Previous version/);
  assert.doesNotMatch(html, /SECRET|before:|after:/);
  assert.match(html, /not the complete history/);
  const empty = renderToStaticMarkup(<AuditTrail events={[]} />);
  assert.match(empty, /Muster register to begin/);
});
