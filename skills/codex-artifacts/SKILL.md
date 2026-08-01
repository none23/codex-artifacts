---
name: codex-artifacts
description: Create, publish or update shareble artifacts.
disable-model-invocation: true
argument-hint: "[request or HTML file]"
---


# Codex Artifacts

When invoked in Claude Code, do not use its built-in Artifact tool.

## Build

- Create one responsive, accessible HTML page from verified context; add only useful interactivity.
- Write temporary artifacts under the system temporary directory; use the repository only when requested or useful for versioning.
- Inline all assets; use no network requests or multiple routes.
- Prefer exact references and measured facts. Do not duplicate viewer branding or controls; avoid repetitive cards, excessive centering, gratuitous gradients, and uniform rounding.
- Keep UTF-8 below 512 KiB.
- Remove unrequested secrets, credentials, private URLs, and personal data. Never expose publishing tokens or `.env.lakebed.server`.

## UI Design
- Make sure there is sufficient contrast in the colors, so that texts stay readable and accessible
- Default to a dark theme
- Avoid navy and teal colorscheme
- Avoid elements that don't add meaning to the reader, e.g. unnecessary tags, icons that don't convey meaning, unnecessary cards
- The main goal should be to keep the design easy for a human to scan and understand


## Publish

```sh
node "${CODEX_ARTIFACTS_SKILL_DIR:-${CODEX_HOME:-$HOME/.codex}/skills/codex-artifacts}/scripts/publish.mjs" <file.html> --title "<title>" [--slug <slug>] [--share <email,...>] [--expires-in <1h|3d|never>] [--public]
```

- Omit `--slug` to create; reuse a slug to update.
- Use `--share` only for additional user-named recipients; on update, omit it to preserve the artifact-specific allowlist or supply it to replace that allowlist. Deployment-configured workspace viewers always retain read access.
- Use `--public` only when the user explicitly requests public access.
- Omit `--expires-in` for the three-day default. Re-publishing resets the timer; pass a duration or `never` to override it.
- Always let the publisher open the artifact URL in the user's default browser after success. Never pass `--no-open` unless the user explicitly asks not to open the browser.

Return the URL first, access, source path, and created/updated status.
