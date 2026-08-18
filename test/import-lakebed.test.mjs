import assert from "node:assert/strict";
import test from "node:test";
import {
  lakebedImportSql,
  readLakebedArtifacts
} from "../scripts/import-lakebed.mjs";

function backup(overrides = {}) {
  const html = "<h1>It's portable</h1>";
  return {
    lakebedBackup: 1,
    tables: {
      artifacts: [
        {
          id: "artifact-1",
          slug: "portable",
          title: "Portable",
          ownerId: "lakebed-user",
          ownerEmail: "owner@example.com",
          sharedWith: '["reader@example.com"]',
          sharedDomains: '["example.org"]',
          isPublic: false,
          expiresAt: "",
          sizeBytes: String(Buffer.byteLength(html)),
          chunkCount: "2",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          ...overrides
        }
      ],
      artifactChunks: [
        { artifactId: "artifact-1", part: "0001", content: "portable</h1>" },
        { artifactId: "artifact-1", part: "0000", content: "<h1>It's " }
      ]
    }
  };
}

test("reassembles Lakebed chunks and preserves access rules", () => {
  const [artifact] = readLakebedArtifacts(backup());
  assert.equal(artifact.html, "<h1>It's portable</h1>");
  assert.equal(artifact.sharedWith, '["reader@example.com"]');
  assert.equal(artifact.sharedDomains, '["example.org"]');
  assert.equal(artifact.expiresAt, null);
});

test("rejects incomplete Lakebed artifact data", () => {
  assert.throws(
    () => readLakebedArtifacts(backup({ chunkCount: "3" })),
    /incomplete chunk set/
  );
  assert.throws(
    () => readLakebedArtifacts(backup({ sizeBytes: "1" })),
    /recorded size/
  );
});

test("generates rerunnable SQL and escapes artifact HTML", () => {
  const artifacts = readLakebedArtifacts(backup());
  const sql = lakebedImportSql(artifacts);
  assert.match(sql, /on conflict \("id"\) do update/);
  assert.match(sql, /It''s portable/);
  assert.match(sql, /"sharedDomains"/);
});
