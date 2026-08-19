#!/usr/bin/env node

import { chmod, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const outputPath = resolve("wrangler.jsonc");
const serialized = process.env.CLOUDFLARE_WRANGLER_CONFIG?.trim();

if (!serialized) {
  throw new Error("CLOUDFLARE_WRANGLER_CONFIG is required.");
}

let configuration;
try {
  configuration = JSON.parse(serialized);
} catch {
  throw new Error("CLOUDFLARE_WRANGLER_CONFIG must be valid JSON.");
}

const database = configuration?.d1_databases?.find(
  (binding) => binding?.binding === "DB"
);
const owners = configuration?.vars?.OWNER_EMAILS;
const baseUrl = configuration?.vars?.BETTER_AUTH_URL;

if (
  configuration?.name !== "codex-artifacts" ||
  configuration?.main !== "server/index.ts" ||
  typeof database?.database_id !== "string" ||
  !database.database_id ||
  /^0+$|^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(database.database_id) ||
  typeof owners !== "string" ||
  !owners.trim() ||
  typeof baseUrl !== "string" ||
  !baseUrl.startsWith("https://")
) {
  throw new Error(
    "CLOUDFLARE_WRANGLER_CONFIG is not a production Codex Artifacts configuration."
  );
}

await writeFile(outputPath, `${JSON.stringify(configuration, null, 2)}\n`, {
  mode: 0o600
});
await chmod(outputPath, 0o600);
