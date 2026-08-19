import assert from "node:assert/strict";
import test from "node:test";
import {
  buildArtifactUrl,
  parseArguments,
  parseExpiration,
  parseEnv,
  resolvePublishingProfile,
  validateBaseUrl
} from "../skills/codex-artifacts/scripts/publisher-core.mjs";

test("buildArtifactUrl creates a hosted-deploy-safe root URL", () => {
  assert.equal(
    buildArtifactUrl("https://artifacts.example.com", "architecture review"),
    "https://artifacts.example.com/?artifact=architecture+review"
  );
});

test("parses publishing options and repeated recipients", () => {
  assert.deepEqual(
    parseArguments([
      "report.html",
      "--title",
      "Architecture",
      "--slug",
      "architecture",
      "--share",
      "one@example.com,two@example.com",
      "--share",
      "three@example.com",
      "--share-domain",
      "example.org,example.net",
      "--share-domain",
      "another.example",
      "--public",
      "--expires-in",
      "1h",
      "--no-open"
    ]),
    {
      file: "report.html",
      title: "Architecture",
      slug: "architecture",
      sharedWith: ["one@example.com", "two@example.com", "three@example.com"],
      sharedDomains: ["example.org", "example.net", "another.example"],
      isPublic: true,
      expiresInSeconds: 3600,
      noOpen: true,
      help: false
    }
  );
});

test("parses relative and never expiration settings", () => {
  assert.equal(parseExpiration("3d"), 259200);
  assert.equal(parseExpiration("2w"), 1209600);
  assert.equal(parseExpiration("never"), null);
  assert.throws(() => parseExpiration("90 minutes"), /duration such as/);
  assert.throws(() => parseExpiration("366d"), /between 1m and 365d/);
});

test("supports an option-like filename after the option terminator", () => {
  assert.equal(parseArguments(["--", "--report.html"]).file, "--report.html");
});

test("rejects unknown options, duplicate scalar options, and missing values", () => {
  assert.throws(() => parseArguments(["--unknown"]), /Unknown option/);
  assert.throws(
    () => parseArguments(["report.html", "--slug", "one", "--slug", "two"]),
    /only be supplied once/
  );
  assert.throws(() => parseArguments(["report.html", "--title", "--public"]), /requires a value/);
  assert.throws(
    () => parseArguments(["report.html", "--expires-in", "1h", "--expires-in", "3d"]),
    /only be supplied once/
  );
  assert.throws(
    () => parseArguments(["report.html", "--share-domain", "--public"]),
    /requires a value/
  );
});

test("parses simple quoted environment files as data", () => {
  assert.deepEqual(
    parseEnv("ARTIFACTS_URL='https://artifacts.example.com'\nPUBLISH_TOKEN=\"secret\"\n"),
    {
      ARTIFACTS_URL: "https://artifacts.example.com",
      PUBLISH_TOKEN: "secret"
    }
  );
});

test("resolves URL and token from one configuration file", () => {
  assert.deepEqual(
    resolvePublishingProfile({}, {
      ARTIFACTS_URL: "https://artifacts.example.com/",
      PUBLISH_TOKEN: "configured-secret"
    }),
    {
      baseUrl: "https://artifacts.example.com",
      token: "configured-secret",
      source: "configuration"
    }
  );
});

test("does not redirect a configured token with an environment URL", () => {
  assert.throws(
    () => resolvePublishingProfile(
      { ARTIFACTS_URL: "https://attacker.example.com" },
      {
        ARTIFACTS_URL: "https://artifacts.example.com",
        PUBLISH_TOKEN: "configured-secret"
      }
    ),
    /Set both together/
  );
});

test("accepts a paired environment profile", () => {
  assert.deepEqual(
    resolvePublishingProfile(
      {
        ARTIFACTS_URL: "https://other.example.com",
        ARTIFACTS_PUBLISH_TOKEN: "environment-secret"
      },
      {
        ARTIFACTS_URL: "https://artifacts.example.com",
        PUBLISH_TOKEN: "configured-secret"
      }
    ),
    {
      baseUrl: "https://other.example.com",
      token: "environment-secret",
      source: "environment"
    }
  );
});

test("preserves a token-only environment override for the configured service", () => {
  assert.deepEqual(
    resolvePublishingProfile(
      { ARTIFACTS_PUBLISH_TOKEN: "environment-secret" },
      { ARTIFACTS_URL: "https://artifacts.example.com", PUBLISH_TOKEN: "configured-secret" }
    ),
    {
      baseUrl: "https://artifacts.example.com",
      token: "environment-secret",
      source: "environment-token"
    }
  );
});

test("requires HTTPS except for loopback development", () => {
  assert.equal(validateBaseUrl("http://localhost:3000/"), "http://localhost:3000");
  assert.throws(() => validateBaseUrl("http://artifacts.example.com"), /must use HTTPS/);
  assert.throws(() => validateBaseUrl("https://artifacts.example.com/path"), /without a path/);
});
