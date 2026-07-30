import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkspaceViewerEmails } from "../shared/workspace-viewers.mjs";

test("parses workspace viewers and excludes deployment owners", () => {
  assert.deepEqual(
    parseWorkspaceViewerEmails(
      " Owner@Example.com, viewer@example.com,VIEWER@example.com ",
      ["owner@example.com"]
    ),
    ["viewer@example.com"]
  );
});

test("rejects invalid and excessive workspace viewer configuration", () => {
  assert.throws(
    () => parseWorkspaceViewerEmails("not-an-email"),
    /Invalid WORKSPACE_VIEWER_EMAILS/
  );
  assert.throws(
    () => parseWorkspaceViewerEmails("one@example.com,two@example.com", [], 1),
    /at most 1/
  );
});
