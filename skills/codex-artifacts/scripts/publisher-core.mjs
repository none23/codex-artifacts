const OPTIONS_WITH_VALUES = new Set(["--title", "--slug", "--share"]);
const FLAG_OPTIONS = new Set(["--public", "--no-open", "--help", "-h"]);

export function parseArguments(args) {
  const result = {
    file: undefined,
    title: undefined,
    slug: undefined,
    sharedWith: [],
    isPublic: false,
    noOpen: false,
    help: false
  };
  let positionalOnly = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (!positionalOnly && argument === "--") {
      positionalOnly = true;
      continue;
    }

    if (!positionalOnly && OPTIONS_WITH_VALUES.has(argument)) {
      const value = args[index + 1];
      if (value === undefined || value === "--" || OPTIONS_WITH_VALUES.has(value) || FLAG_OPTIONS.has(value)) {
        throw new Error(`${argument} requires a value.`);
      }
      index += 1;

      if (argument === "--share") {
        result.sharedWith.push(
          ...value
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        );
        continue;
      }

      const property = argument === "--title" ? "title" : "slug";
      if (result[property] !== undefined) {
        throw new Error(`${argument} may only be supplied once.`);
      }
      result[property] = value;
      continue;
    }

    if (!positionalOnly && FLAG_OPTIONS.has(argument)) {
      if (argument === "--public") result.isPublic = true;
      if (argument === "--no-open") result.noOpen = true;
      if (argument === "--help" || argument === "-h") result.help = true;
      continue;
    }

    if (!positionalOnly && argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}`);
    }

    if (result.file !== undefined) {
      throw new Error("Only one HTML file may be published at a time.");
    }
    result.file = argument;
  }

  return result;
}

export function parseEnv(source) {
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

function nonempty(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function validateBaseUrl(value) {
  const raw = nonempty(value);
  if (!raw) {
    throw new Error("ARTIFACTS_URL is required.");
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("ARTIFACTS_URL must be a valid absolute URL.");
  }

  const isLoopback = parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "::1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback)) {
    throw new Error("ARTIFACTS_URL must use HTTPS, except for a loopback development URL.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("ARTIFACTS_URL must not contain credentials.");
  }
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new Error("ARTIFACTS_URL must be an origin without a path, query, or fragment.");
  }

  return parsed.origin;
}

export function resolvePublishingProfile(environment, configuration) {
  const environmentUrl = nonempty(environment.ARTIFACTS_URL);
  const environmentToken = nonempty(environment.ARTIFACTS_PUBLISH_TOKEN);
  const configuredUrl = nonempty(configuration.ARTIFACTS_URL);
  const configuredToken =
    nonempty(configuration.ARTIFACTS_PUBLISH_TOKEN) ??
    nonempty(configuration.PUBLISH_TOKEN);

  if (environmentUrl && !environmentToken) {
    throw new Error(
      "ARTIFACTS_URL was overridden in the process environment without ARTIFACTS_PUBLISH_TOKEN. " +
      "Set both together so a configured token cannot be redirected to another service."
    );
  }

  const baseUrl = validateBaseUrl(environmentUrl ?? configuredUrl);
  const token = environmentToken ?? configuredToken;
  if (!token) {
    throw new Error("ARTIFACTS_PUBLISH_TOKEN is required.");
  }

  return {
    baseUrl,
    token,
    source: environmentUrl ? "environment" : environmentToken ? "environment-token" : "configuration"
  };
}
