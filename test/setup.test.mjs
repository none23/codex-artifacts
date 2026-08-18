import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWranglerConfiguration,
  normalizeCustomDomain,
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
      domain: undefined,
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
      domain: undefined,
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

test("validates and normalizes a custom domain", () => {
  assert.equal(normalizeCustomDomain(" Artifacts.Example.com "), "artifacts.example.com");
  assert.throws(() => normalizeCustomDomain("https://artifacts.example.com"), /hostname/);
  assert.deepEqual(parseSetupArguments(["--domain", "artifacts.example.com"]), {
    owners: [],
    viewers: [],
    clearViewers: false,
    domain: "artifacts.example.com",
    skipLogin: false,
    help: false
  });
});

test("builds an isolated Worker configuration", () => {
  const configuration = buildWranglerConfiguration({
    databaseId: "database-id",
    owners: ["owner@example.com"],
    viewers: ["viewer@example.com"],
    baseUrl: "https://artifacts.example.com",
    domain: "artifacts.example.com"
  });
  assert.equal(configuration.d1_databases[0].database_id, "database-id");
  assert.equal(configuration.vars.OWNER_EMAILS, "owner@example.com");
  assert.equal(configuration.vars.WORKSPACE_VIEWER_EMAILS, "viewer@example.com");
  assert.deepEqual(configuration.routes, [
    { pattern: "artifacts.example.com", custom_domain: true }
  ]);
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
