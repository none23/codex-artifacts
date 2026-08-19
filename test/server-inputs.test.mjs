import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true }
});
const {
  parseArtifactAccess,
  parseAutomationPublishRequest,
  parseExpirationUpdate,
  parsePublishInput
} = await vite.ssrLoadModule("/server/inputs.ts");

after(() => vite.close());

test("parses signed-in artifact publishing input", () => {
  assert.deepEqual(
    parsePublishInput({
      title: "Report",
      slug: "report",
      html: "<h1>Report</h1>",
      sharedWith: ["reader@example.com"],
      isPublic: false,
      expiresInSeconds: null
    }),
    {
      artifactId: undefined,
      title: "Report",
      slug: "report",
      html: "<h1>Report</h1>",
      sharedWith: ["reader@example.com"],
      sharedDomains: undefined,
      isPublic: false,
      expiresInSeconds: null
    }
  );
});

test("rejects invalid publishing input at the request boundary", () => {
  assert.throws(
    () => parsePublishInput({ title: 42, slug: "report", html: "content" }),
    /title must be a string/
  );
  assert.throws(
    () =>
      parsePublishInput({
        title: "Report",
        slug: "report",
        html: "content",
        sharedWith: ["reader@example.com", 42]
      }),
    /sharedWith must be an array of strings/
  );
  assert.throws(
    () =>
      parsePublishInput({
        title: "Report",
        slug: "report",
        html: "content",
        expiresInSeconds: 30
      }),
    /expiresInSeconds must be between/
  );
});

test("requires complete artifact access and expiration updates", () => {
  assert.deepEqual(
    parseArtifactAccess({ emails: [], domains: [], isPublic: false }),
    { emails: [], domains: [], isPublic: false }
  );
  assert.throws(
    () => parseArtifactAccess({ emails: [], domains: [], isPublic: "false" }),
    /isPublic must be a boolean/
  );
  assert.equal(parseExpirationUpdate({ expiresInSeconds: null }), null);
  assert.throws(() => parseExpirationUpdate({}), /expiresInSeconds is required/);
});

test("preserves explicit automation access revocation", () => {
  assert.deepEqual(
    parseAutomationPublishRequest({
      title: "Report",
      html: "content",
      sharedWith: [],
      sharedDomains: [],
      isPublic: false
    }),
    {
      title: "Report",
      slug: undefined,
      html: "content",
      sharedWith: [],
      sharedDomains: [],
      isPublic: false,
      expiresInSeconds: undefined
    }
  );
});
