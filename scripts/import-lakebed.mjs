#!/usr/bin/env node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const WRANGLER_EXECUTABLE = join(
  PROJECT_ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wrangler.cmd" : "wrangler"
);
const MAX_SQL_CHUNK_BYTES = 32 * 1024;

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function requiredString(value, field) {
  if (typeof value !== "string") throw new Error(`Lakebed ${field} must be a string.`);
  return value;
}

function normalizedJsonArray(value, field) {
  const source = requiredString(value ?? "[]", field);
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error(`Lakebed ${field} is not valid JSON.`);
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error(`Lakebed ${field} must contain a JSON string array.`);
  }
  return JSON.stringify(parsed);
}

function chunkText(value, maxBytes = MAX_SQL_CHUNK_BYTES) {
  const chunks = [];
  let current = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character);
    if (current && bytes + characterBytes > maxBytes) {
      chunks.push(current);
      current = "";
      bytes = 0;
    }
    current += character;
    bytes += characterBytes;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function readLakebedArtifacts(backup) {
  if (!backup || typeof backup !== "object" || backup.lakebedBackup !== 1) {
    throw new Error("Expected a Lakebed v1 database export.");
  }
  const tables = backup.tables;
  if (!tables || typeof tables !== "object") {
    throw new Error("Lakebed export has no tables.");
  }
  const artifacts = Array.isArray(tables.artifacts) ? tables.artifacts : [];
  const chunks = Array.isArray(tables.artifactChunks) ? tables.artifactChunks : [];
  const chunksByArtifact = new Map();
  for (const chunk of chunks) {
    const artifactId = requiredString(chunk?.artifactId, "artifactChunks.artifactId");
    const values = chunksByArtifact.get(artifactId) ?? [];
    values.push({
      part: requiredString(chunk.part, "artifactChunks.part"),
      content: requiredString(chunk.content, "artifactChunks.content")
    });
    chunksByArtifact.set(artifactId, values);
  }

  return artifacts.map((artifact) => {
    const id = requiredString(artifact?.id, "artifacts.id");
    const artifactChunks = chunksByArtifact.get(id) ?? [];
    artifactChunks.sort((left, right) => left.part.localeCompare(right.part));
    const html = artifactChunks.map((chunk) => chunk.content).join("");
    const expectedChunkCount = Number(artifact.chunkCount);
    const expectedSize = Number(artifact.sizeBytes);
    if (artifactChunks.length !== expectedChunkCount) {
      throw new Error(`Artifact ${id} has an incomplete chunk set.`);
    }
    if (Buffer.byteLength(html) !== expectedSize) {
      throw new Error(`Artifact ${id} HTML does not match its recorded size.`);
    }
    return {
      id,
      slug: requiredString(artifact.slug, "artifacts.slug"),
      title: requiredString(artifact.title, "artifacts.title"),
      ownerId: requiredString(artifact.ownerId, "artifacts.ownerId"),
      ownerEmail: requiredString(artifact.ownerEmail, "artifacts.ownerEmail"),
      sharedWith: normalizedJsonArray(artifact.sharedWith, "artifacts.sharedWith"),
      sharedDomains: normalizedJsonArray(
        artifact.sharedDomains,
        "artifacts.sharedDomains"
      ),
      isPublic: artifact.isPublic === true,
      expiresAt:
        typeof artifact.expiresAt === "string" && artifact.expiresAt
          ? artifact.expiresAt
          : null,
      sizeBytes: expectedSize,
      html,
      createdAt: requiredString(artifact.createdAt, "artifacts.createdAt"),
      updatedAt: requiredString(artifact.updatedAt, "artifacts.updatedAt")
    };
  });
}

export function lakebedImportSql(artifacts) {
  const statements = ["pragma defer_foreign_keys = true;"];
  for (const artifact of artifacts) {
    statements.push(
      `insert into "artifacts" (` +
        `"id", "slug", "title", "ownerId", "ownerEmail", "sharedWith", ` +
        `"sharedDomains", "isPublic", "expiresAt", "sizeBytes", "html", ` +
        `"createdAt", "updatedAt") values (` +
        [
          sqlString(artifact.id),
          sqlString(artifact.slug),
          sqlString(artifact.title),
          sqlString(artifact.ownerId),
          sqlString(artifact.ownerEmail),
          sqlString(artifact.sharedWith),
          sqlString(artifact.sharedDomains),
          artifact.isPublic ? "1" : "0",
          artifact.expiresAt ? sqlString(artifact.expiresAt) : "null",
          String(artifact.sizeBytes),
          "''",
          sqlString(artifact.createdAt),
          sqlString(artifact.updatedAt)
        ].join(", ") +
        `) on conflict ("id") do update set ` +
        `"slug" = excluded."slug", "title" = excluded."title", ` +
        `"ownerId" = excluded."ownerId", "ownerEmail" = excluded."ownerEmail", ` +
        `"sharedWith" = excluded."sharedWith", ` +
        `"sharedDomains" = excluded."sharedDomains", ` +
        `"isPublic" = excluded."isPublic", "expiresAt" = excluded."expiresAt", ` +
        `"sizeBytes" = excluded."sizeBytes", "html" = '', ` +
        `"createdAt" = excluded."createdAt", "updatedAt" = excluded."updatedAt";`
    );
    for (const chunk of chunkText(artifact.html)) {
      statements.push(
        `update "artifacts" set "html" = "html" || ${sqlString(chunk)} ` +
          `where "id" = ${sqlString(artifact.id)};`
      );
    }
  }
  return `${statements.join("\n")}\n`;
}

function parseArguments(args) {
  let file;
  let local = false;
  for (const argument of args) {
    if (argument === "--local") {
      local = true;
      continue;
    }
    if (argument.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
    if (file) throw new Error("Only one Lakebed backup file may be imported.");
    file = argument;
  }
  if (!file) {
    throw new Error("Usage: node scripts/import-lakebed.mjs <backup.json> [--local]");
  }
  return { file: resolve(file), local };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const backup = JSON.parse(await readFile(options.file, "utf8"));
  const artifacts = readLakebedArtifacts(backup);
  const directory = await mkdtemp(join(tmpdir(), "codex-artifacts-import-"));
  const sqlPath = join(directory, "lakebed-import.sql");
  try {
    await writeFile(sqlPath, lakebedImportSql(artifacts), { mode: 0o600 });
    const result = spawnSync(
      WRANGLER_EXECUTABLE,
      [
        "d1",
        "execute",
        "DB",
        options.local ? "--local" : "--remote",
        "--config",
        join(PROJECT_ROOT, "wrangler.jsonc"),
        "--file",
        sqlPath,
        "--yes"
      ],
      { cwd: PROJECT_ROOT, encoding: "utf8", stdio: "inherit" }
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error("Wrangler could not import the backup.");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  console.log(
    `Imported ${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}. ` +
      "Identity bindings were intentionally omitted; users reclaim access on sign-in."
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Import failed.");
    process.exitCode = 1;
  });
}
