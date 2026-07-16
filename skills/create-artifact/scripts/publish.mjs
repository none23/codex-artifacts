#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_URL = "https://codex-artifacts.lakebed.app";
const OPTION_NAMES = new Set(["--title", "--slug", "--share"]);

function usage() {
  console.error(`Usage:
  node publish.mjs <file.html> [--title "Title"] [--slug slug] [--share one@example.com,two@example.com]

Behavior:
  New artifacts are private by default.
  Reusing --slug updates the existing URL.
  Omitting --share during an update preserves the existing allowlist.

Environment:
  ARTIFACTS_URL             Optional deployed app URL override
  ARTIFACTS_PUBLISH_TOKEN   Optional token override`);
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function optionValues(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) {
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
}

function positional(args) {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (OPTION_NAMES.has(value)) {
      index += 1;
      continue;
    }
    if (!value.startsWith("--")) {
      return value;
    }
  }
  return undefined;
}

async function readRepositoryToken() {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const repositoryEnv = resolve(scriptDirectory, "../../../.env.lakebed.server");

  try {
    const env = await readFile(repositoryEnv, "utf8");
    const line = env.split(/\r?\n/).find((value) => value.startsWith("PUBLISH_TOKEN="));
    return line?.slice("PUBLISH_TOKEN=".length).trim();
  } catch {
    return undefined;
  }
}

const args = process.argv.slice(2);
const fileArg = positional(args);
const baseUrl = (process.env.ARTIFACTS_URL ?? DEFAULT_URL).replace(/\/$/, "");
const token =
  process.env.ARTIFACTS_PUBLISH_TOKEN ??
  process.env.PUBLISH_TOKEN ??
  await readRepositoryToken();

if (!fileArg || !baseUrl || !token) {
  usage();
  process.exit(1);
}

const filePath = resolve(fileArg);
const html = await readFile(filePath, "utf8");
const fileName = basename(filePath).replace(/\.html?$/i, "");
const title = option(args, "--title") ?? fileName;
const slug = option(args, "--slug");
const shareOptions = optionValues(args, "--share");
const sharedWith = shareOptions
  .flatMap((value) => value.split(","))
  .map((value) => value.trim())
  .filter(Boolean);

const payload = { title, slug, html };
if (shareOptions.length > 0) {
  payload.sharedWith = sharedWith;
}

const response = await fetch(`${baseUrl}/api/artifacts`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json"
  },
  body: JSON.stringify(payload)
});

const body = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(body.error ?? `Publish failed with HTTP ${response.status}`);
  process.exit(1);
}

console.log(`${baseUrl}/a/${body.slug}`);
