#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildArtifactUrl,
  parseArguments,
  parseEnv,
  resolvePublishingProfile
} from "./publisher-core.mjs";

const MAX_ARTIFACT_BYTES = 512 * 1024;
const PUBLISH_TIMEOUT_MS = 30_000;

function usage() {
  console.error(`Usage:
  node publish.mjs <file.html> [--title "Title"] [--slug slug] [--share one@example.com,two@example.com | --clear-share] [--share-domain example.com | --clear-share-domain] [--expires-in 3d|never] [--public | --private] [--no-open]

Behavior:
  New artifacts are private by default.
  Deployment-configured workspace viewers always retain read access.
  --share and --share-domain set additional access rules and replace their
  respective lists on update.
  Reusing --slug updates the existing URL.
  Omitting either sharing option during an update preserves that list.
  --clear-share and --clear-share-domain remove their respective lists.
  Artifacts expire in 3 days by default; every update resets that timer.
  --expires-in accepts durations such as 1h, 3d, or 2w, or never.
  --public makes the artifact accessible without sign-in.
  --private requires sign-in and a matching access rule.

Environment:
  ARTIFACTS_URL             Deployed app URL
  ARTIFACTS_PUBLISH_TOKEN   Publish token
  CODEX_ARTIFACTS_ENV       Optional path to an env file containing those values
  ARTIFACTS_AUTO_OPEN=0     Disable opening the published URL`);
}

async function readConfiguration() {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const envPath = process.env.CODEX_ARTIFACTS_ENV
    ? resolve(process.env.CODEX_ARTIFACTS_ENV)
    : resolve(scriptDirectory, "../../../.env.cloudflare.server");

  try {
    return { path: envPath, values: parseEnv(await readFile(envPath, "utf8")) };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { path: envPath, values: {} };
    }
    throw error;
  }
}

function openInBrowser(url, noOpen) {
  if (noOpen || process.env.ARTIFACTS_AUTO_OPEN === "0") {
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

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (!args.file) {
    throw new Error("An HTML file is required. Use --help for usage.");
  }

  const configuration = await readConfiguration();
  const { baseUrl, token } = resolvePublishingProfile(process.env, configuration.values);
  const filePath = resolve(args.file);
  const fileInfo = await stat(filePath);
  if (!fileInfo.isFile()) {
    throw new Error(`${filePath} is not a regular file.`);
  }
  if (fileInfo.size > MAX_ARTIFACT_BYTES) {
    throw new Error("Artifact exceeds the 512 KiB limit.");
  }

  const html = await readFile(filePath, "utf8");
  if (Buffer.byteLength(html, "utf8") > MAX_ARTIFACT_BYTES) {
    throw new Error("Artifact exceeds the 512 KiB limit.");
  }
  const fileName = basename(filePath).replace(/\.html?$/i, "");
  const payload = {
    title: args.title ?? fileName,
    slug: args.slug,
    html
  };
  if (args.sharedWith !== undefined) {
    payload.sharedWith = args.sharedWith;
  }
  if (args.sharedDomains !== undefined) {
    payload.sharedDomains = args.sharedDomains;
  }
  if (args.isPublic !== undefined) {
    payload.isPublic = args.isPublic;
  }
  if (args.expiresInSeconds !== undefined) {
    payload.expiresInSeconds = args.expiresInSeconds;
  }

  const response = await fetch(`${baseUrl}/api/artifacts`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS)
  });

  const responseText = await response.text();
  let body = {};
  try {
    body = responseText ? JSON.parse(responseText) : {};
  } catch {
    if (!response.ok) {
      throw new Error(`Publish failed with HTTP ${response.status}.`);
    }
    throw new Error("Publish succeeded but returned an invalid JSON response.");
  }
  if (!response.ok) {
    throw new Error(
      typeof body.error === "string" ? body.error : `Publish failed with HTTP ${response.status}.`
    );
  }
  if (typeof body.slug !== "string" || !body.slug) {
    throw new Error("Publish succeeded but returned no artifact slug.");
  }
  if (args.isPublic !== undefined && body.isPublic !== args.isPublic) {
    throw new Error("Publish succeeded, but the server did not confirm the requested access.");
  }
  if (args.expiresInSeconds === null && body.expiresAt !== null) {
    throw new Error("Publish succeeded, but the server did not confirm non-expiring access.");
  }
  if (args.expiresInSeconds !== null && typeof body.expiresAt !== "string") {
    throw new Error("Publish succeeded, but the server did not confirm artifact expiration.");
  }

  const artifactUrl = buildArtifactUrl(baseUrl, body.slug);
  console.log(artifactUrl);
  openInBrowser(artifactUrl, args.noOpen);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unable to publish artifact.";
  console.error(message);
  process.exitCode = 1;
});
