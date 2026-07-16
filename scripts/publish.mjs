#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

function usage() {
  console.error(`Usage:
  node scripts/publish.mjs <file.html> [--title "Title"] [--slug slug] [--share one@example.com,two@example.com]

Environment:
  ARTIFACTS_URL             Optional deployed app URL override
  ARTIFACTS_PUBLISH_TOKEN   Optional token override; defaults to PUBLISH_TOKEN in .env.lakebed.server`);
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const fileArg = args.find((arg) => !arg.startsWith("--") && ![option(args, "--title"), option(args, "--slug"), option(args, "--share")].includes(arg));
const baseUrl = (process.env.ARTIFACTS_URL ?? "https://codex-artifacts.lakebed.app").replace(/\/$/, "");

async function readLocalToken() {
  try {
    const env = await readFile(resolve(".env.lakebed.server"), "utf8");
    const line = env.split(/\r?\n/).find((value) => value.startsWith("PUBLISH_TOKEN="));
    return line?.slice("PUBLISH_TOKEN=".length).trim();
  } catch {
    return undefined;
  }
}

const token = process.env.ARTIFACTS_PUBLISH_TOKEN ?? process.env.PUBLISH_TOKEN ?? await readLocalToken();

if (!fileArg || !baseUrl || !token) {
  usage();
  process.exit(1);
}

const filePath = resolve(fileArg);
const html = await readFile(filePath, "utf8");
const fileName = basename(filePath).replace(/\.html?$/i, "");
const title = option(args, "--title") ?? fileName;
const slug = option(args, "--slug");
const sharedWith = (option(args, "--share") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const response = await fetch(`${baseUrl}/api/artifacts`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json"
  },
  body: JSON.stringify({ title, slug, html, sharedWith })
});

const body = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(body.error ?? `Publish failed with HTTP ${response.status}`);
  process.exit(1);
}

console.log(`${baseUrl}/a/${body.slug}`);
