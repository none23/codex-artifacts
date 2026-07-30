import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeOwnerEmails,
  normalizeWorkspaceViewerEmails,
  parseSetupArguments,
  serializeEnvironment
} from "../scripts/setup.mjs";

test("parses repeated and comma-separated owner invitations", () => {
  assert.deepEqual(
    parseSetupArguments([
      "--owner",
      "one@example.com,two@example.com",
      "--owner",
      "three@example.com",
      "--viewer",
      "viewer@example.com,second-viewer@example.com",
      "--skip-login"
    ]),
    {
      owners: ["one@example.com", "two@example.com", "three@example.com"],
      viewers: ["viewer@example.com", "second-viewer@example.com"],
      clearViewers: false,
      skipLogin: true,
      help: false
    }
  );
});

test("parses clearing workspace viewers and rejects conflicting options", () => {
  assert.deepEqual(
    parseSetupArguments(["--clear-viewers"]),
    {
      owners: [],
      viewers: [],
      clearViewers: true,
      skipLogin: false,
      help: false
    }
  );
  assert.throws(
    () => parseSetupArguments([
      "--viewer",
      "viewer@example.com",
      "--clear-viewers"
    ]),
    /cannot be combined/
  );
});

test("normalizes and deduplicates owner emails", () => {
  assert.deepEqual(
    normalizeOwnerEmails([" Owner@Example.com ", "owner@example.com", "other@example.com"]),
    ["owner@example.com", "other@example.com"]
  );
  assert.throws(() => normalizeOwnerEmails(["not-an-email"]), /Invalid owner email/);
});

test("validates workspace viewer emails with viewer-specific errors", () => {
  assert.deepEqual(
    normalizeWorkspaceViewerEmails([" Viewer@Example.com ", "viewer@example.com"]),
    ["viewer@example.com"]
  );
  assert.throws(
    () => normalizeWorkspaceViewerEmails(["not-an-email"]),
    /Invalid workspace viewer email/
  );
});

test("serializes primary settings first and rejects multiline values", () => {
  assert.equal(
    serializeEnvironment({
      ARTIFACTS_URL: "https://artifacts.example.com",
      WORKSPACE_VIEWER_EMAILS: "viewer@example.com",
      EXTRA: "preserved",
      PUBLISH_TOKEN: "secret",
      OWNER_EMAILS: "owner@example.com"
    }),
    [
      "OWNER_EMAILS=owner@example.com",
      "WORKSPACE_VIEWER_EMAILS=viewer@example.com",
      "PUBLISH_TOKEN=secret",
      "ARTIFACTS_URL=https://artifacts.example.com",
      "EXTRA=preserved",
      ""
    ].join("\n")
  );
  assert.throws(
    () => serializeEnvironment({ OWNER_EMAILS: "owner@example.com\nsecond@example.com" }),
    /cannot contain a newline/
  );
});
