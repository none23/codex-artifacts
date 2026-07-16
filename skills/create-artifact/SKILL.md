---
name: create-artifact
description: Create and privately publish self-contained HTML artifacts to the Codex Artifacts service. Use when the user asks for an artifact, a shareable visual page or link, an HTML report, dashboard, interactive explainer, PR walkthrough, implementation plan, comparison, timeline, checklist, status page, or to update and republish an existing artifact.
---

# Create Artifact

Turn session work into one polished, self-contained HTML page, publish it privately, and return the authenticated link.

## Workflow

1. Decide what the page should communicate. Ask only when audience, purpose, or required content cannot be inferred safely.
2. Choose a concise title and slug.
3. Create the HTML source.
4. Review it for correctness, privacy, security, and size.
5. Publish with the bundled script.
6. Return the URL, source path, and sharing state.

## Choose the source path

- Default to `/tmp/codex-artifacts/<slug>.html` so unrelated repositories stay clean.
- Save under the current repository only when the user asks to retain the source, the page is a project deliverable, or future updates should be versioned with the code.
- Update the existing source file when revising an artifact.

## Build the page

Create one `.html` file with:

- Inline CSS, JavaScript, and SVG.
- No external scripts, stylesheets, fonts, images, `fetch`, XHR, WebSockets, or other network dependencies.
- In-page sections and anchors instead of multiple routes.
- Responsive layouts, semantic structure, keyboard usability, readable contrast, and reduced-motion handling when animation is present.
- Real session or repository context. Prefer exact file references, measured results, and verified facts over generic filler.
- Deliberate visual hierarchy. Avoid repetitive cards, excessive centered copy, arbitrary gradients, uniform rounded containers, and default-looking AI dashboards.
- Only the interactivity that materially improves understanding.

Keep the UTF-8 file below 512 KiB. Prefer HTML, CSS, and SVG over embedded raster images.

## Protect sensitive information

Before publishing, inspect the file for secrets, tokens, credentials, private keys, environment values, internal URLs, and personal data that the user did not ask to include. Private access reduces exposure but does not make secret material appropriate to publish on a hosted service.

Never place `PUBLISH_TOKEN`, `ARTIFACTS_PUBLISH_TOKEN`, or `.env.lakebed.server` contents in the HTML.

## Publish

Run the bundled publisher:

```sh
SKILL_DIR="${CODEX_HOME:-$HOME/.codex}/skills/create-artifact"
node "$SKILL_DIR/scripts/publish.mjs" <file.html> --title "<title>"
```

Optional arguments:

```sh
--slug <stable-slug>
--share person@example.com,other@example.com
```

- Omit `--share` to keep a new artifact owner-only.
- Add only emails the user explicitly named. Never infer recipients from git history, repository metadata, contacts, or conversation participants.
- Supplying `--share` replaces the complete allowlist.
- To update an existing artifact, reuse the slug from its URL. Republishing the same slug updates the existing page and preserves its sharing list when `--share` is omitted.
- Without `--slug`, publishing creates a new artifact and URL.

Treat a successful script exit and printed URL as the publish result. Optionally verify that the browser shell is reachable:

```sh
curl -fsS -o /dev/null -H 'accept: text/html' <artifact-url>
```

## Hand off

Return:

- The artifact URL first.
- Whether it is owner-only or the exact emails it was shared with.
- The local source path.
- Whether this created a new artifact or updated an existing slug.

Do not expose or print the publishing token.
