---
name: create-artifact
description: Create and privately publish self-contained HTML artifacts. Use for requested artifacts, shareable visual pages or links, HTML reports, dashboards, explainers, PR walkthroughs, plans, comparisons, timelines, checklists, status pages, or updates to existing artifacts.
---

# Create Artifact

## Build

- Create one responsive, accessible HTML page from verified context; add only useful interactivity.
- Default to `/tmp/codex-artifacts/<slug>.html`; use the repository only when requested or useful for versioning.
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
node "${CODEX_HOME:-$HOME/.codex}/skills/create-artifact/scripts/publish.mjs" <file.html> --title "<title>" [--slug <slug>] [--share <email,...>] [--no-open]
```

- Omit `--slug` to create; reuse a slug to update.
- Omit `--share` for owner-only creation or to preserve recipients when updating. If supplied, it replaces the allowlist; include only user-named emails.
- The publisher opens the URL after success; use `--no-open` for headless runs.

Return the URL first, access, source path, and created/updated status.
