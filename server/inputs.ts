import type { ArtifactAccess, PublishInput } from "../shared/api";
import {
  MAX_EXPIRATION_SECONDS,
  MIN_EXPIRATION_SECONDS
} from "../shared/config";
import { AppError } from "./errors";

export type AutomationPublishRequest = Omit<PublishInput, "artifactId" | "slug"> & {
  slug?: string;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError("Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

function requiredString(
  value: unknown,
  name: string
): string {
  if (typeof value !== "string") {
    throw new AppError(`${name} must be a string.`);
  }
  return value;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, name);
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new AppError(`${name} must be a boolean.`);
  }
  return value;
}

function optionalStringArray(
  value: unknown,
  name: string
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new AppError(`${name} must be an array of strings.`);
  }
  return value;
}

function optionalExpiration(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return value;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < MIN_EXPIRATION_SECONDS ||
    value > MAX_EXPIRATION_SECONDS
  ) {
    throw new AppError(
      `expiresInSeconds must be between ${MIN_EXPIRATION_SECONDS} seconds and one year, or null.`
    );
  }
  return value;
}

export function parsePublishInput(value: unknown): PublishInput {
  const body = record(value);
  return {
    artifactId: optionalString(body.artifactId, "artifactId"),
    title: requiredString(body.title, "title"),
    slug: requiredString(body.slug, "slug"),
    html: requiredString(body.html, "html"),
    sharedWith: optionalStringArray(body.sharedWith, "sharedWith"),
    sharedDomains: optionalStringArray(body.sharedDomains, "sharedDomains"),
    isPublic: optionalBoolean(body.isPublic, "isPublic"),
    expiresInSeconds: optionalExpiration(body.expiresInSeconds)
  };
}

export function parseAutomationPublishRequest(
  value: unknown
): AutomationPublishRequest {
  const body = record(value);
  return {
    title: requiredString(body.title, "title"),
    slug: optionalString(body.slug, "slug"),
    html: requiredString(body.html, "html"),
    sharedWith: optionalStringArray(body.sharedWith, "sharedWith"),
    sharedDomains: optionalStringArray(body.sharedDomains, "sharedDomains"),
    isPublic: optionalBoolean(body.isPublic, "isPublic"),
    expiresInSeconds: optionalExpiration(body.expiresInSeconds)
  };
}

export function parseArtifactAccess(value: unknown): ArtifactAccess {
  const body = record(value);
  const emails = optionalStringArray(body.emails, "emails");
  const domains = optionalStringArray(body.domains, "domains");
  const isPublic = optionalBoolean(body.isPublic, "isPublic");
  if (!emails || !domains || isPublic === undefined) {
    throw new AppError("emails, domains, and isPublic are required.");
  }
  return { emails, domains, isPublic };
}

export function parseExpirationUpdate(value: unknown): number | null {
  const expiresInSeconds = optionalExpiration(record(value).expiresInSeconds);
  if (expiresInSeconds === undefined) {
    throw new AppError("expiresInSeconds is required.");
  }
  return expiresInSeconds;
}
