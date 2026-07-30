const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

export function parseWorkspaceViewerEmails(value, excludedEmails = [], maxViewers = 50) {
  const configured = String(value ?? "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
  const invalid = configured.find((email) => !EMAIL_PATTERN.test(normalizeEmail(email)));
  if (invalid) {
    throw new Error(`Invalid WORKSPACE_VIEWER_EMAILS address: ${invalid}`);
  }

  const excluded = new Set(excludedEmails.map(normalizeEmail));
  const viewers = [...new Set(configured.map(normalizeEmail))]
    .filter((email) => !excluded.has(email));
  if (viewers.length > maxViewers) {
    throw new Error(`WORKSPACE_VIEWER_EMAILS may contain at most ${maxViewers} people.`);
  }
  return viewers;
}
