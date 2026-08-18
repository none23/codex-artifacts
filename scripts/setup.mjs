#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { parseEnv, validateBaseUrl } from "../skills/codex-artifacts/scripts/publisher-core.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_ENV_PATH = join(PROJECT_ROOT, ".env.cloudflare.server");
const SECRETS_PATH = join(PROJECT_ROOT, ".env.cloudflare.secrets");
const DEV_VARS_PATH = join(PROJECT_ROOT, ".dev.vars");
const WRANGLER_CONFIG_PATH = join(PROJECT_ROOT, "wrangler.jsonc");
const BUILT_WRANGLER_CONFIG_PATH = join(
  PROJECT_ROOT,
  "dist",
  "codex_artifacts",
  "wrangler.json"
);
const WRANGLER_EXECUTABLE = join(
  PROJECT_ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wrangler.cmd" : "wrangler"
);
const NPM_EXECUTABLE = process.platform === "win32" ? "npm.cmd" : "npm";
const DATABASE_NAME = "codex-artifacts";

function usage() {
  return `Usage:
  GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run setup -- --owner you@example.com [--viewer viewer@example.com]
  npm run setup

Options:
  --owner <emails>   Owner invitations. Repeat or use commas.
  --viewer <emails>  Read-only workspace viewers. Repeat or use commas.
  --clear-viewers    Remove all configured workspace viewers.
  --domain <host>    Deploy to a custom domain already managed by Cloudflare.
  --skip-login       Use existing Wrangler credentials or CLOUDFLARE_API_TOKEN.
  --help, -h         Show this help.

The first run creates D1 storage, applies migrations, deploys the Worker, and
writes ignored local configuration files with mode 0600. Google credentials
come from the process environment on first setup and are saved for later runs.`;
}

export function parseSetupArguments(args) {
  const owners = [];
  const viewers = [];
  let clearViewers = false;
  let domain;
  let skipLogin = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--owner" || argument === "--viewer" || argument === "--domain") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      index += 1;
      if (argument === "--owner") owners.push(...value.split(","));
      if (argument === "--viewer") viewers.push(...value.split(","));
      if (argument === "--domain") {
        if (domain !== undefined) throw new Error("--domain may only be supplied once.");
        domain = normalizeCustomDomain(value);
      }
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
  return { owners, viewers, clearViewers, domain, skipLogin, help };
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

export function normalizeCustomDomain(value) {
  const domain = value.trim().toLowerCase();
  if (
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
  ) {
    throw new Error("--domain must be a hostname such as artifacts.example.com.");
  }
  return domain;
}

export function serializeEnvironment(values) {
  const preferredOrder = [
    "OWNER_EMAILS",
    "WORKSPACE_VIEWER_EMAILS",
    "PUBLISH_TOKEN",
    "ARTIFACTS_URL",
    "CUSTOM_DOMAIN",
    "D1_DATABASE_ID",
    "BETTER_AUTH_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET"
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

export function buildWranglerConfiguration({
  databaseId,
  owners,
  viewers,
  baseUrl = "",
  domain
}) {
  return {
    $schema: "./node_modules/wrangler/config-schema.json",
    name: "codex-artifacts",
    main: "server/index.ts",
    compatibility_date: "2026-08-15",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: true,
    ...(domain
      ? { routes: [{ pattern: domain, custom_domain: true }] }
      : {}),
    assets: {
      binding: "ASSETS",
      not_found_handling: "single-page-application",
      run_worker_first: ["/api/*"]
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: DATABASE_NAME,
        database_id: databaseId,
        migrations_dir: "migrations"
      }
    ],
    vars: {
      OWNER_EMAILS: owners.join(","),
      WORKSPACE_VIEWER_EMAILS: viewers.join(","),
      BETTER_AUTH_URL: baseUrl
    },
    triggers: { crons: ["17 * * * *"] },
    observability: { enabled: true }
  };
}

async function readEnvironment(path) {
  try {
    return parseEnv(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeSecureFile(path, contents) {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, contents, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
}

async function writeWranglerConfiguration(configuration) {
  await writeFile(
    WRANGLER_CONFIG_PATH,
    `${JSON.stringify(configuration, null, 2)}\n`,
    "utf8"
  );
}

function runCommand(executable, args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync(executable, args, {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    env: process.env,
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const detail = capture ? (result.stderr || result.stdout || "").trim() : "";
    throw new Error(
      `${executable} ${args.join(" ")} failed` + (detail ? `\n${detail}` : "")
    );
  }
  return {
    ok: result.status === 0,
    stdout: capture ? result.stdout : "",
    stderr: capture ? result.stderr : ""
  };
}

function runWrangler(args, options) {
  return runCommand(WRANGLER_EXECUTABLE, args, options);
}

function parseJsonOutput(output, command) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${command} returned invalid JSON.`);
  }
}

async function ensureDeveloperLogin(skipLogin) {
  if (skipLogin || process.env.CLOUDFLARE_API_TOKEN) return;
  const status = runWrangler(["whoami", "--json"], {
    capture: true,
    allowFailure: true
  });
  if (!status.ok) runWrangler(["login"]);
}

function databaseIdFromList(value) {
  const databases = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray(value.result)
      ? value.result
      : [];
  const match = databases.find(
    (database) => database && typeof database === "object" && database.name === DATABASE_NAME
  );
  if (!match) return undefined;
  const id = match.uuid ?? match.id;
  return typeof id === "string" ? id : undefined;
}

async function ensureDatabase(existingDatabaseId) {
  if (existingDatabaseId) return existingDatabaseId;
  const list = () => parseJsonOutput(
    runWrangler(["d1", "list", "--json"], { capture: true }).stdout,
    "wrangler d1 list"
  );
  const existing = databaseIdFromList(list());
  if (existing) return existing;
  runWrangler(["d1", "create", DATABASE_NAME, "--location", "eeur"]);
  const created = databaseIdFromList(list());
  if (!created) throw new Error("Wrangler created D1 but did not return its database ID.");
  return created;
}

function deployedUrl(output) {
  const matches = output.match(/https:\/\/[^\s]+/g) ?? [];
  const candidate = matches.find((value) => value.includes("workers.dev")) ?? matches.at(-1);
  return candidate ? validateBaseUrl(candidate.replace(/[),.;]+$/, "")) : undefined;
}

async function waitForHealth(baseUrl) {
  const statusUrl = new URL("/api/status", baseUrl);
  let lastError;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      const response = await fetch(statusUrl, { signal: AbortSignal.timeout(5_000) });
      const body = await response.json();
      if (response.ok && body?.ok === true && body?.service === "codex-artifacts") return;
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

function requireGoogleCredential(name, existing) {
  const value = process.env[name]?.trim() || existing?.trim();
  if (!value) {
    throw new Error(
      `${name} is required on first setup. Export it in the process environment and run setup again.`
    );
  }
  return value;
}

async function buildAndDeploy() {
  runCommand(NPM_EXECUTABLE, ["run", "build"]);
  return runWrangler(
    [
      "deploy",
      "--config",
      BUILT_WRANGLER_CONFIG_PATH,
      "--secrets-file",
      SECRETS_PATH
    ],
    { capture: true }
  ).stdout;
}

async function main() {
  const options = parseSetupArguments(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const existing = await readEnvironment(SERVER_ENV_PATH);
  const requestedOwners = normalizeOwnerEmails(options.owners);
  const requestedViewers = normalizeWorkspaceViewerEmails(options.viewers);
  const configuredOwners = requestedOwners.length
    ? requestedOwners
    : normalizeOwnerEmails((existing.OWNER_EMAILS ?? "").split(","));
  if (!configuredOwners.length) {
    throw new Error("At least one --owner email is required on the first setup run.");
  }
  const configuredViewers = requestedViewers.length || options.clearViewers
    ? requestedViewers
    : normalizeWorkspaceViewerEmails(
        (existing.WORKSPACE_VIEWER_EMAILS ?? "").split(",")
      );
  const googleClientId = requireGoogleCredential(
    "GOOGLE_CLIENT_ID",
    existing.GOOGLE_CLIENT_ID
  );
  const googleClientSecret = requireGoogleCredential(
    "GOOGLE_CLIENT_SECRET",
    existing.GOOGLE_CLIENT_SECRET
  );
  const publishToken = existing.PUBLISH_TOKEN || randomBytes(32).toString("hex");
  const betterAuthSecret =
    existing.BETTER_AUTH_SECRET || randomBytes(32).toString("hex");
  const configuredDomain = options.domain || existing.CUSTOM_DOMAIN || undefined;
  let baseUrl = configuredDomain
    ? `https://${configuredDomain}`
    : existing.ARTIFACTS_URL
      ? validateBaseUrl(existing.ARTIFACTS_URL)
      : "";

  await ensureDeveloperLogin(options.skipLogin);
  const databaseId = await ensureDatabase(existing.D1_DATABASE_ID);
  let wranglerConfiguration = buildWranglerConfiguration({
    databaseId,
    owners: configuredOwners,
    viewers: configuredViewers,
    baseUrl,
    domain: configuredDomain
  });
  await writeWranglerConfiguration(wranglerConfiguration);

  const secretValues = {
    BETTER_AUTH_SECRET: betterAuthSecret,
    GOOGLE_CLIENT_ID: googleClientId,
    GOOGLE_CLIENT_SECRET: googleClientSecret,
    PUBLISH_TOKEN: publishToken
  };
  await writeSecureFile(SECRETS_PATH, serializeEnvironment(secretValues));
  await writeSecureFile(
    DEV_VARS_PATH,
    serializeEnvironment({
      ...secretValues,
      BETTER_AUTH_URL: "http://localhost:5173"
    })
  );

  runWrangler([
    "d1",
    "migrations",
    "apply",
    "DB",
    "--remote",
    "--config",
    WRANGLER_CONFIG_PATH
  ]);
  runWrangler([
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--config",
    WRANGLER_CONFIG_PATH
  ]);

  const firstDeployOutput = await buildAndDeploy();
  if (!baseUrl) {
    baseUrl = deployedUrl(firstDeployOutput) ?? "";
    if (!baseUrl) {
      throw new Error("Wrangler deployed the Worker but did not report its URL.");
    }
    wranglerConfiguration = buildWranglerConfiguration({
      databaseId,
      owners: configuredOwners,
      viewers: configuredViewers,
      baseUrl
    });
    await writeWranglerConfiguration(wranglerConfiguration);
    await buildAndDeploy();
  }

  const configuration = {
    ...existing,
    OWNER_EMAILS: configuredOwners.join(","),
    WORKSPACE_VIEWER_EMAILS: configuredViewers.join(","),
    PUBLISH_TOKEN: publishToken,
    ARTIFACTS_URL: baseUrl,
    ...(configuredDomain ? { CUSTOM_DOMAIN: configuredDomain } : {}),
    D1_DATABASE_ID: databaseId,
    BETTER_AUTH_SECRET: betterAuthSecret,
    GOOGLE_CLIENT_ID: googleClientId,
    GOOGLE_CLIENT_SECRET: googleClientSecret
  };
  await writeSecureFile(SERVER_ENV_PATH, serializeEnvironment(configuration));
  await waitForHealth(baseUrl);

  console.log(`Service URL: ${baseUrl}`);
  console.log(`Google callback URL: ${new URL("/api/auth/callback/google", baseUrl)}`);
  console.log("Local Google callback URL: http://localhost:5173/api/auth/callback/google");
  console.log(`Server and publisher config: ${SERVER_ENV_PATH}`);
  console.log("Deployment is healthy. Add both callback URLs to the Google OAuth client before signing in.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Setup failed.");
    process.exitCode = 1;
  });
}
