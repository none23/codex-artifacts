#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { parseEnv, validateBaseUrl } from "../skills/codex-artifacts/scripts/publisher-core.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_ENV_PATH = join(PROJECT_ROOT, ".env.lakebed.server");
const LAKEBED_EXECUTABLE = join(
  PROJECT_ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "lakebed.cmd" : "lakebed"
);

function usage() {
  return `Usage:
  npm run setup -- --owner you@example.com [--viewer viewer@example.com]
  npm run setup

Options:
  --owner <emails>   Owner invitations. Repeat or use commas.
  --viewer <emails>  Read-only workspace viewers. Repeat or use commas.
  --clear-viewers    Remove all configured workspace viewers.
  --skip-login       Use an existing LAKEBED_TOKEN or saved Lakebed login.
  --help, -h         Show this help.

The first run writes .env.lakebed.server with mode 0600, authenticates with
Lakebed, creates an owned deployment, verifies its health, and saves its URL.
Re-running setup updates the same deployment without replacing existing secrets.`;
}

export function parseSetupArguments(args) {
  const owners = [];
  const viewers = [];
  let clearViewers = false;
  let skipLogin = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--owner") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--owner requires one or more email addresses.");
      }
      owners.push(...value.split(","));
      index += 1;
      continue;
    }
    if (argument === "--viewer") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--viewer requires one or more email addresses.");
      }
      viewers.push(...value.split(","));
      index += 1;
      continue;
    }
    if (argument === "--clear-viewers") {
      clearViewers = true;
      continue;
    }
    if (argument === "--skip-login") {
      skipLogin = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  if (clearViewers && viewers.length) {
    throw new Error("--clear-viewers cannot be combined with --viewer.");
  }
  return { owners, viewers, clearViewers, skipLogin, help };
}

function normalizeEmails(values, label) {
  const emails = [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
  for (const email of emails) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`Invalid ${label} email: ${email}`);
    }
  }
  return emails;
}

export function normalizeOwnerEmails(values) {
  return normalizeEmails(values, "owner");
}

export function normalizeWorkspaceViewerEmails(values) {
  return normalizeEmails(values, "workspace viewer");
}

export function serializeEnvironment(values) {
  const preferredOrder = [
    "OWNER_EMAILS",
    "WORKSPACE_VIEWER_EMAILS",
    "PUBLISH_TOKEN",
    "ARTIFACTS_URL"
  ];
  const keys = [
    ...preferredOrder.filter((key) => values[key] !== undefined),
    ...Object.keys(values)
      .filter((key) => !preferredOrder.includes(key))
      .sort()
  ];

  return `${keys.map((key) => {
    const value = String(values[key]);
    if (/[\r\n]/.test(value)) {
      throw new Error(`${key} cannot contain a newline.`);
    }
    return `${key}=${value}`;
  }).join("\n")}\n`;
}

async function readExistingEnvironment() {
  try {
    return parseEnv(await readFile(SERVER_ENV_PATH, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeSecureEnvironment(values) {
  const temporaryPath = `${SERVER_ENV_PATH}.tmp-${process.pid}`;
  await writeFile(temporaryPath, serializeEnvironment(values), { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, SERVER_ENV_PATH);
  await chmod(SERVER_ENV_PATH, 0o600);
}

function runLakebed(arguments_, { capture = false } = {}) {
  const result = spawnSync(LAKEBED_EXECUTABLE, arguments_, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    env: process.env,
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = capture ? (result.stderr || result.stdout || "").trim() : "";
    throw new Error(
      `Lakebed command failed: lakebed ${arguments_.join(" ")}` +
      (detail ? `\n${detail}` : "")
    );
  }
  return capture ? result.stdout : "";
}

function parseJsonOutput(output, command) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${command} returned invalid JSON.`);
  }
}

async function ensureDeveloperLogin(skipLogin) {
  if (skipLogin || process.env.LAKEBED_TOKEN) {
    return;
  }
  const status = parseJsonOutput(
    runLakebed(["auth", "status", "--json"], { capture: true }),
    "Lakebed auth status"
  );
  if (!status.authenticated) {
    runLakebed(["auth", "login"]);
  }
}

async function waitForHealth(baseUrl) {
  const statusUrl = new URL("/api/status", baseUrl);
  let lastError;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const response = await fetch(statusUrl, { signal: AbortSignal.timeout(5_000) });
      const body = await response.json();
      if (response.ok && body?.ok === true && body?.service === "codex-artifacts") {
        return;
      }
      lastError = new Error(`Health check returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error(
    `Deployment completed, but ${statusUrl} did not become healthy: ` +
    (lastError instanceof Error ? lastError.message : "unknown error")
  );
}

async function main() {
  const options = parseSetupArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const existing = await readExistingEnvironment();
  const requestedOwners = normalizeOwnerEmails(options.owners);
  const requestedViewers = normalizeWorkspaceViewerEmails(options.viewers);
  const configuredOwners = requestedOwners.length
    ? requestedOwners
    : normalizeOwnerEmails((existing.OWNER_EMAILS ?? "").split(","));
  if (!configuredOwners.length) {
    throw new Error("At least one --owner email is required on the first setup run.");
  }

  const configuration = {
    ...existing,
    OWNER_EMAILS: configuredOwners.join(","),
    PUBLISH_TOKEN: existing.PUBLISH_TOKEN || randomBytes(32).toString("hex")
  };
  if (requestedViewers.length || options.clearViewers) {
    configuration.WORKSPACE_VIEWER_EMAILS = requestedViewers.join(",");
  }
  await writeSecureEnvironment(configuration);

  await ensureDeveloperLogin(options.skipLogin);
  const deployed = parseJsonOutput(
    runLakebed(["deploy", ".", "--json"], { capture: true }),
    "Lakebed deploy"
  );
  if (deployed.claimed !== true || typeof deployed.url !== "string") {
    throw new Error("Lakebed did not create or update an owned deployment.");
  }

  const existingUrl =
    existing.ARTIFACTS_URL && !existing.ARTIFACTS_URL.includes("your-artifacts.lakebed.app")
      ? validateBaseUrl(existing.ARTIFACTS_URL)
      : undefined;
  configuration.ARTIFACTS_URL = existingUrl ?? validateBaseUrl(deployed.url);
  await writeSecureEnvironment(configuration);
  await waitForHealth(configuration.ARTIFACTS_URL);

  console.log(`Service URL: ${configuration.ARTIFACTS_URL}`);
  console.log(`Server and publisher config: ${SERVER_ENV_PATH}`);
  console.log("Deployment is owned, healthy, and ready for private publishing.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Setup failed.");
    process.exitCode = 1;
  });
}
