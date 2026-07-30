# Codex Artifacts

Codex Artifacts is a small service for publishing self-contained HTML files as private, shareable web pages. It gives coding agents a place to publish reports, dashboards, plans, walkthroughs, and other visual documents, while you control who can view them.

You run Codex Artifacts in your own Lakebed account. Your deployment has its own data, owners, URL, and publishing token; there is no shared hosted service or credential.

**[Explore the public, interactive capabilities demo →](https://codex-artifacts.lakebed.app/?artifact=capabilities-demo)**

## Set up your own service

You need:

- Node.js 20 or later
- A Google account
- A free [Lakebed](https://lakebed.dev) account

### 1. Clone, install, and deploy

Replace `you@example.com` with the Google email you will use to administer the
service. Optionally add read-only workspace viewers who should be able to open
every artifact:

```sh
git clone https://github.com/none23/codex-artifacts.git
cd codex-artifacts
npm ci
npm run setup -- --owner you@example.com \
  --viewer viewer@example.com,another-viewer@example.com
```

Follow the Lakebed sign-in prompt if one appears. The command creates your deployment, checks that it is healthy, and prints its service URL.

### 2. Sign in as the owner

Open the printed service URL and choose **Sign in with Google**. Use the same email you passed to `--owner`. This first sign-in accepts the owner invitation and gives you access to the management interface.

### 3. Install the agent skill

Link the included skill for Codex, Claude Code, or both:

```sh
REPO_DIR="$(pwd)"

mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
ln -sfn "$REPO_DIR/skills/codex-artifacts" \
  "${CODEX_HOME:-$HOME/.codex}/skills/codex-artifacts"

mkdir -p "$HOME/.claude/skills"
ln -sfn "$REPO_DIR/skills/codex-artifacts" \
  "$HOME/.claude/skills/codex-artifacts"
```

Start a new agent session after installing the skill so it is discovered.

### 4. Publish your first artifact

From any project, ask your agent:

```text
Use codex-artifacts to create and publish a visual architecture report for this repository.
```

The agent creates the HTML, publishes it to your deployment, and opens the
private result in your browser. Owners and workspace viewers can open every
artifact. Additional recipients can be granted access per artifact.

You can also publish an existing HTML file directly from the Codex Artifacts repository:

```sh
node scripts/publish.mjs ./report.html --title "Architecture report"
```

Your service is now ready to use. See the [public capabilities demo](https://codex-artifacts.lakebed.app/?artifact=capabilities-demo) for a view-only example of a published artifact.

## Using Codex Artifacts

The service provides:

- Google sign-in with durable Lakebed identity bindings
- Private-by-default artifact publishing
- Deployment-wide read-only workspace viewers
- Per-artifact invitations by exact email or email domain
- Optional public links
- A browser UI for uploading, replacing, downloading, and deleting artifacts
- A shared Codex and Claude Code skill for agent-driven publishing
- A command-line publisher that can update an existing artifact URL
- Sandboxed HTML previews without `allow-same-origin`

### Publishing options

Useful options:

```sh
--slug architecture-report        # Reuse the URL on future updates
--share person@example.com        # Set additional exact-email recipients
--public                          # Allow anyone with the link to view
--no-open                         # Do not open the result in a browser
-- --option-like-name.html        # Publish a filename beginning with "-"
```

Workspace viewers always retain access and are independent of `--share`. On
update, supplying `--share` replaces only the artifact's additional exact-email
invitation list; omitting it preserves existing access. Omitting `--public` on
update preserves the public setting. The publisher refuses to combine a
process-level URL override with a token loaded from the configuration file;
override `ARTIFACTS_URL` and `ARTIFACTS_PUBLISH_TOKEN` together.

If the skill is copied away from this repository instead of linked, set `CODEX_ARTIFACTS_ENV` to the absolute path of `.env.lakebed.server`.

## What setup configures

The setup command:

1. Creates a random 256-bit publishing token.
2. Writes the ignored `.env.lakebed.server` with mode `0600`.
3. Opens Lakebed developer login if needed.
4. Creates an owned deployment or updates the deployment already bound in `lakebed.json`.
5. Saves the deployment URL and verifies `/api/status`.

Re-run `npm run setup` after pulling an update. Existing owners, workspace
viewers, secrets, and a configured custom URL are preserved unless you
explicitly replace them with `--owner`, `--viewer`, or `--clear-viewers`.

## Identity and access

Owner, workspace-viewer, and per-artifact recipient emails are invitations, not
permanent authorization keys.

- The first matching verified Google sign-in accepts an invitation and binds it to the account's immutable Lakebed user ID.
- Later requests authorize the bound user ID rather than trusting current profile email.
- Removing an owner invitation from `OWNER_EMAILS` and redeploying revokes that binding.
- Removing a workspace viewer invitation from `WORKSPACE_VIEWER_EMAILS` and
  redeploying revokes read access across the workspace.
- Removing an artifact email or domain rule immediately invalidates and removes grants created from that rule.
- Every configured owner is a deployment administrator and can manage every artifact.
- Every configured workspace viewer can open every existing and future artifact
  but cannot publish, delete, or change access.
- Per-artifact recipients can open only artifacts shared with their exact email
  or domain.

If an address appears in both `OWNER_EMAILS` and `WORKSPACE_VIEWER_EMAILS`,
owner access takes precedence.

Domain invitations are broad. Do not add public mail domains such as `gmail.com`; every matching signed-in account could accept access. Prefer exact-email invitations for sensitive artifacts.

## Manual setup

The setup command is recommended, but the equivalent manual flow is:

```sh
cp .env.lakebed.server.example .env.lakebed.server
chmod 600 .env.lakebed.server
```

Set:

```dotenv
OWNER_EMAILS=you@example.com
WORKSPACE_VIEWER_EMAILS=viewer@example.com,another-viewer@example.com
PUBLISH_TOKEN=replace-with-a-long-random-secret
ARTIFACTS_URL=https://your-artifacts.lakebed.app
```

Generate the token with `openssl rand -hex 32`. Authenticate before the first deployment so Lakebed creates an owned app:

```sh
npm exec lakebed -- auth login
npm run deploy
```

Set `ARTIFACTS_URL` to the deployed or custom URL. `lakebed.json` is intentionally ignored in this upstream repository so a clone never targets the maintainer's deployment; Lakebed creates your local binding automatically.

## Configuration

| Variable | Purpose |
| --- | --- |
| `OWNER_EMAILS` | Comma-separated pending/current owner invitations |
| `WORKSPACE_VIEWER_EMAILS` | Comma-separated read-only viewers of every artifact |
| `PUBLISH_TOKEN` | Server-side automation secret |
| `ARTIFACTS_URL` | Publisher destination in the local configuration file |
| `ARTIFACTS_PUBLISH_TOKEN` | Process-level publisher token override |
| `ARTIFACTS_AUTO_OPEN=0` | Disables opening newly published artifacts |
| `CODEX_ARTIFACTS_ENV` | Optional absolute publisher environment-file path |
| `LAKEBED_TOKEN` | Optional Lakebed deployment credential for automation |

Never commit `.env.lakebed.server`, `.lakebed/`, `lakebed.json`, or publishing/deployment tokens.

The owner automation contract is documented in [openapi.yaml](openapi.yaml).

## Operations

### Update safely

```sh
git pull --ff-only
npm run check
npm run setup
```

`npm run setup` updates the bound deployment only after tests/build are run separately. For a controlled rollback, check out the last known-good revision, run `npm run check`, then `npm run deploy`.

### Back up data

Read the deploy ID from the ignored `lakebed.json`, then export:

```sh
DEPLOY_ID="$(node -p "JSON.parse(require('fs').readFileSync('lakebed.json')).deployId")"
npm exec lakebed -- db export "$DEPLOY_ID" --out codex-artifacts-backup.json
```

Lakebed export is not a point-in-time snapshot during concurrent writes. Keep backups private: they contain artifact HTML, owner and workspace-viewer invitations, and per-artifact recipient access data.

### Rotate the publisher token

Replace `PUBLISH_TOKEN` in `.env.lakebed.server` with a new 64-character hex value, keep the file at mode `0600`, and run `npm run deploy`. The publisher reads the same local file, so the old token stops working after deployment.

### Change owners

Update `OWNER_EMAILS` and run `npm run deploy`. Removing an email revokes its bound owner access. Adding an email creates a pending invitation that binds on that person's next sign-in.

### Change workspace viewers

Run `npm run setup -- --viewer one@example.com,two@example.com` to replace the
read-only workspace viewer list, or use `--clear-viewers` to remove it. The
change applies to every existing and future artifact. A newly added viewer must
sign in with the matching verified Google email to bind the invitation.

## Security and capacity

Artifact HTML is untrusted. It runs in an iframe sandbox without `allow-same-origin` and cannot access the authenticated shell, but scripts, forms, popups, and outbound network requests are currently allowed inside the artifact. An artifact can transmit data embedded in its own HTML. Downloaded HTML is no longer sandboxed if you open it directly. Do not publish secrets, credentials, private source, or regulated data without reviewing the generated page.

The publishing token is deployment-wide owner automation authority. Anyone holding it can create artifacts and replace an artifact whose slug they know. Keep it only on trusted owner machines; do not distribute it as a consumer credential.

Lakebed currently limits capsule state to 1 MiB. This project limits one artifact to 512 KiB, individual chunks to 48 KiB, and total artifact HTML to 768 KiB, reserving the remaining state for metadata, access grants, and indexes. Treat the deployment as a small visual-document workspace, not general hosting. Delete superseded artifacts and monitor usage with Lakebed inspection tools.

Public artifacts are subject to the [Lakebed Acceptable Use Policy](https://lakebed.dev/acceptable-use). The deployment owner is responsible for its published content and recipients.

## Local development

```sh
npm test
npm run build
npm run dev
```

Lakebed local state resets when the dev process restarts. Real Google sign-in accepts configured owner and artifact invitations; automation publishing continues to use `PUBLISH_TOKEN`.

## How it works

The project is a Lakebed v0 capsule. Lakebed supplies first-party Google authentication, transactional storage, and hosting. Artifact HTML is split into database-safe chunks. Owner, workspace-viewer, and recipient invitations bind to durable Lakebed user IDs on first matching sign-in. HTML is rendered with `srcDoc` in a sandboxed iframe without `allow-same-origin`.

Codex Artifacts is an independent project and is not affiliated with or endorsed by OpenAI or Anthropic.
