import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeOwnerEmails,
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
      "--skip-login"
    ]),
    {
      owners: ["one@example.com", "two@example.com", "three@example.com"],
      skipLogin: true,
      help: false
    }
  );
});

test("normalizes and deduplicates owner emails", () => {
  assert.deepEqual(
    normalizeOwnerEmails([" Owner@Example.com ", "owner@example.com", "other@example.com"]),
    ["owner@example.com", "other@example.com"]
  );
  assert.throws(() => normalizeOwnerEmails(["not-an-email"]), /Invalid owner email/);
});

test("serializes primary settings first and rejects multiline values", () => {
  assert.equal(
    serializeEnvironment({
      ARTIFACTS_URL: "https://artifacts.example.com",
      EXTRA: "preserved",
      PUBLISH_TOKEN: "secret",
      OWNER_EMAILS: "owner@example.com"
    }),
    [
      "OWNER_EMAILS=owner@example.com",
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
