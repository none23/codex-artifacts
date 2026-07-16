# Codex Artifacts

Codex Artifacts turns self-contained HTML files into shareable web pages with access control. It is designed for reports, dashboards, plans, walkthroughs, and other visual documents created by coding agents.

Artifacts are private by default. Owners can share an artifact with individual Google accounts, allow an entire email domain, or make it public.

[View the public README demo](https://codex-artifacts.lakebed.app/a/readme-demo)

## What you get

- Google sign-in and verified-email access checks
- Private-by-default artifact publishing
- Per-artifact sharing by email, domain, or public link
- A browser UI for uploading, replacing, downloading, and deleting artifacts
- A shared Codex and Claude Code skill for agent-driven publishing
- A command-line publisher that can update an existing artifact URL
- Sandboxed HTML previews

## Use it

Once the service and skill are installed, ask your agent for an artifact:

```text
Use codex-artifacts to create and publish a visual architecture report for this repository.
```

Codex can select the skill automatically when the request calls for a shareable visual page. In Claude Code, invoke `/codex-artifacts` explicitly so it does not conflict with Claude's built-in artifact feature.

You can also publish an existing HTML file from the repository:

```sh
node scripts/publish.mjs ./report.html \
  --title "Architecture report"
```

Useful options:

```sh
--slug architecture-report        # Reuse the same URL on future updates
--share person@example.com        # Share with one or more exact emails
--public                          # Allow anyone with the link to view
--no-open                         # Do not open the result in a browser
```

Open a published artifact and use **Access** in the top bar to manage people, domains, and public visibility. Email suggestions are remembered locally in that browser.

## Install

You need Node.js, a Google account, and a free [Lakebed](https://lakebed.dev) deployment.

### 1. Configure and deploy the service

```sh
git clone <repository-url> codex-artifacts
cd codex-artifacts
cp .env.lakebed.server.example .env.lakebed.server
```

Edit the ignored `.env.lakebed.server`:

```dotenv
OWNER_EMAILS=you@example.com,another-account@example.com
PUBLISH_TOKEN=replace-with-a-long-random-secret
ARTIFACTS_URL=https://your-artifacts.lakebed.app
```

Generate a publish token with `openssl rand -hex 32`. Then deploy and claim the app:

```sh
npm run deploy
npx lakebed@0.0.29 auth login
npx lakebed@0.0.29 claim
```

Set `ARTIFACTS_URL` to the URL Lakebed gives you and deploy once more so local publishing uses the final address:

```sh
npm run deploy
```

### 2. Install the agent skill

Link the same skill directory for Codex, Claude Code, or both:

```sh
REPO_DIR="$(pwd)"

mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
ln -sfn "$REPO_DIR/skills/codex-artifacts" \
  "${CODEX_HOME:-$HOME/.codex}/skills/codex-artifacts"

mkdir -p "$HOME/.claude/skills"
ln -sfn "$REPO_DIR/skills/codex-artifacts" \
  "$HOME/.claude/skills/codex-artifacts"
```

If your skill directory differs, set `CODEX_ARTIFACTS_SKILL_DIR` to the installed skill path. If the skill is copied away from the repository, set `CODEX_ARTIFACTS_ENV` to the absolute path of your `.env.lakebed.server`.

## Configuration

| Variable | Purpose |
| --- | --- |
| `OWNER_EMAILS` | Comma-separated Google accounts that can manage every artifact |
| `PUBLISH_TOKEN` | Server secret accepted by the automation endpoint |
| `ARTIFACTS_URL` | Public base URL used by the publishing script |
| `ARTIFACTS_PUBLISH_TOKEN` | Optional local override for `PUBLISH_TOKEN` |
| `ARTIFACTS_AUTO_OPEN=0` | Disables opening newly published artifacts |
| `CODEX_ARTIFACTS_ENV` | Optional path to the publisher environment file |

Never commit `.env.lakebed.server`, `lakebed.json`, or a publish token.

## How it works

The project is a small Lakebed capsule. Lakebed supplies Google authentication, storage, and hosting. Artifact HTML is split into database-safe chunks and rendered in a sandboxed iframe without `allow-same-origin`, keeping it isolated from the authenticated application.

The current 512 KiB artifact limit makes this a good fit for self-contained reports and visual documents rather than a general file-hosting service.
