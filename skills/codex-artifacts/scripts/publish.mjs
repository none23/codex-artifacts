#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OPTION_NAMES = new Set(["--title", "--slug", "--share"]);

function usage() {
  console.error(`Usage:
  node publish.mjs <file.html> [--title "Title"] [--slug slug] [--share one@example.com,two@example.com] [--public] [--no-open]

Behavior:
  New artifacts are private by default.
  Reusing --slug updates the existing URL.
  Omitting --share during an update preserves the existing allowlist.
  --public makes the artifact accessible without sign-in.

Environment:
  ARTIFACTS_URL             Deployed app URL
  ARTIFACTS_PUBLISH_TOKEN   Publish token
  CODEX_ARTIFACTS_ENV       Optional path to an env file containing those values
  ARTIFACTS_AUTO_OPEN=0     Disable opening the published URL`);
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

function parseEnv(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

async function readConfiguration() {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const envPath = process.env.CODEX_ARTIFACTS_ENV
    ? resolve(process.env.CODEX_ARTIFACTS_ENV)
    : resolve(scriptDirectory, "../../../.env.lakebed.server");

  try {
    return parseEnv(await readFile(envPath, "utf8"));
  } catch {
    return {};
  }
}

function openInBrowser(url) {
  if (args.includes("--no-open") || process.env.ARTIFACTS_AUTO_OPEN === "0") {
    return;
  }

  const command =
    process.platform === "darwin" ? "open" :
    process.platform === "win32" ? "cmd" :
    "xdg-open";
  const commandArgs =
    process.platform === "win32" ? ["/c", "start", "", url] : [url];

  try {
    const child = spawn(command, commandArgs, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // Publishing succeeded; unavailable desktop integration is non-fatal.
  }
}

const args = process.argv.slice(2);
const fileArg = positional(args);
const configuration = await readConfiguration();
const baseUrl = (process.env.ARTIFACTS_URL ?? configuration.ARTIFACTS_URL ?? "").replace(/\/$/, "");
const token =
  process.env.ARTIFACTS_PUBLISH_TOKEN ??
  process.env.PUBLISH_TOKEN ??
  configuration.ARTIFACTS_PUBLISH_TOKEN ??
  configuration.PUBLISH_TOKEN;

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
if (args.includes("--public")) {
  payload.isPublic = true;
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
if (args.includes("--public") && body.isPublic !== true) {
  console.error("Publish succeeded, but the server did not confirm public access.");
  process.exit(1);
}

const artifactUrl = `${baseUrl}/a/${body.slug}`;
console.log(artifactUrl);
openInBrowser(artifactUrl);
