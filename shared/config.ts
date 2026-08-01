export const MAX_ARTIFACT_BYTES = 512 * 1024;
export const MAX_CHUNK_BYTES = 48 * 1024;
export const MAX_TOTAL_ARTIFACT_BYTES = 768 * 1024;
export const MAX_SHARED_EMAILS = 50;
export const MAX_SHARED_DOMAINS = 20;
export const DEFAULT_EXPIRATION_SECONDS = 3 * 24 * 60 * 60;
export const MIN_EXPIRATION_SECONDS = 60;
export const MAX_EXPIRATION_SECONDS = 365 * 24 * 60 * 60;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^@/, "");
}

export function isValidDomain(value: string): boolean {
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalizeDomain(value));
}

export function emailDomain(value: string): string {
  const email = normalizeEmail(value);
  return email.slice(email.lastIndexOf("@") + 1);
}

export function cleanTitle(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 120);
}

export function cleanSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function artifactHref(slug: string): string {
  return `/?artifact=${encodeURIComponent(cleanSlug(slug))}`;
}

export function expirationTimestamp(
  expiresInSeconds: number | null | undefined,
  now = Date.now()
): string {
  if (expiresInSeconds === null) {
    return "";
  }

  const seconds = expiresInSeconds ?? DEFAULT_EXPIRATION_SECONDS;
  if (
    !Number.isSafeInteger(seconds) ||
    seconds < MIN_EXPIRATION_SECONDS ||
    seconds > MAX_EXPIRATION_SECONDS
  ) {
    throw new Error(
      `Expiration must be between ${MIN_EXPIRATION_SECONDS} seconds and one year, or never.`
    );
  }
  return new Date(now + seconds * 1000).toISOString();
}

export function isArtifactExpired(expiresAt: string, now = Date.now()): boolean {
  if (!expiresAt) {
    return false;
  }
  const timestamp = Date.parse(expiresAt);
  return Number.isFinite(timestamp) && timestamp <= now;
}

export function parseSharedEmails(value: string | null | undefined): string[] {
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function normalizeSharedEmails(values: string[], excludedEmails: string[] = []): string[] {
  const unique = new Set<string>();
  const excluded = new Set(excludedEmails.map(normalizeEmail));

  for (const value of values) {
    const email = normalizeEmail(value);
    if (isValidEmail(email) && !excluded.has(email)) {
      unique.add(email);
    }
  }

  return [...unique].slice(0, MAX_SHARED_EMAILS);
}

export function normalizeSharedDomains(values: string[]): string[] {
  const unique = new Set<string>();

  for (const value of values) {
    const domain = normalizeDomain(value);
    if (isValidDomain(domain)) {
      unique.add(domain);
    }
  }

  return [...unique].slice(0, MAX_SHARED_DOMAINS);
}

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function chunkHtml(value: string): string[] {
  if (utf8Bytes(value) > MAX_ARTIFACT_BYTES) {
    throw new Error("Artifact exceeds the 512 KiB limit.");
  }

  if (!value) {
    throw new Error("Artifact HTML cannot be empty.");
  }

  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const character of value) {
    const characterBytes = utf8Bytes(character);
    if (current && currentBytes + characterBytes > MAX_CHUNK_BYTES) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += character;
    currentBytes += characterBytes;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}
