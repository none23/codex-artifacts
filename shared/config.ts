export const OWNER_EMAIL = "n.anisimov.23@gmail.com";

export const MAX_ARTIFACT_BYTES = 512 * 1024;
export const MAX_CHUNK_BYTES = 48 * 1024;
export const MAX_SHARED_EMAILS = 50;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
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

export function parseSharedEmails(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function normalizeSharedEmails(values: string[]): string[] {
  const unique = new Set<string>();

  for (const value of values) {
    const email = normalizeEmail(value);
    if (email && email !== OWNER_EMAIL) {
      unique.add(email);
    }
  }

  return [...unique].slice(0, MAX_SHARED_EMAILS);
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
