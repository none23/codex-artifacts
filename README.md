# Codex Artifacts

Codex Artifacts publishes self-contained HTML files as private, shareable web pages. Coding agents can publish reports, dashboards, plans, and walkthroughs while the deployment owner controls who may open them.

Each installation runs in the owner's Cloudflare account. It has separate data, credentials, and a publishing token. There is no shared hosted service.

**[Explore the public capabilities demo](https://codex-artifacts.none23.workers.dev/?artifact=capabilities-demo)**

## Set up your service

You need:

- Node.js 20.19 or later
- A free Cloudflare account
- A Google OAuth web client

### 1. Create the Google OAuth client

Create a web OAuth client in Google Cloud Console. Add this local redirect URI:

```text
http://localhost:5173/api/auth/callback/google
```

Copy the client ID and client secret. Setup will print the production redirect URI after the first deployment. Add that URI to the same Google client before signing in.

If you already know the custom domain, add `https://your-domain/api/auth/callback/google` now and pass the domain to setup with `--domain`.

### 2. Clone and deploy

```sh
git clone https://github.com/none23/codex-artifacts.git
cd codex-artifacts
npm ci

export GOOGLE_CLIENT_ID="your-client-id"
export GOOGLE_CLIENT_SECRET="your-client-secret"
npm run setup -- --owner you@example.com \
  --viewer viewer@example.com,another-viewer@example.com
```

Wrangler opens Cloudflare login if needed. Setup then creates D1 storage, applies migrations, deploys the Worker, and prints the service URL and Google callback URL.

To use a custom domain already managed by Cloudflare:

```sh
npm run setup -- --owner you@example.com --domain artifacts.example.com
```

### 3. Finish Google configuration and sign in

Add the printed production callback URL to the Google OAuth client. Open the service URL and choose **Sign in with Google**. The first matching sign-in accepts the owner invitation.

### 4. Install the agent skill

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

Start a new agent session after installing the skill.

### 5. Publish an artifact

Ask your agent:

```text
Use codex-artifacts to create and publish a visual architecture report for this repository.
```

Or publish an existing file directly:

```sh
node scripts/publish.mjs ./report.html --title "Architecture report"
```

## Publishing options

```sh
--slug architecture-report        # Reuse the URL on future updates
--share person@example.com        # Set additional exact-email recipients
--share-domain example.com        # Set additional recipient domains
--clear-share                     # Remove all exact-email recipients
--clear-share-domain              # Remove all recipient domains
--expires-in 1h                   # Override the default three-day lifetime
--expires-in never                # Keep the artifact until deletion
--public                          # Allow anyone with the link to view
--private                         # Revoke public access
--no-open                         # Do not open the result in a browser
-- --option-like-name.html        # Publish a filename beginning with "-"
```

Workspace viewers always retain access. On update, `--share` and `--share-domain` replace their respective artifact-specific lists. The corresponding `--clear-*` option removes every rule in that list, while omission preserves it. Use `--public` or `--private` to change public access. Omitting both preserves the current setting. Republishing resets the three-day expiration unless `--expires-in` supplies another duration or `never`.

The publisher rejects a process-level URL override paired with a token from the saved configuration. Override `ARTIFACTS_URL` and `ARTIFACTS_PUBLISH_TOKEN` together.

If the skill is copied away from this repository instead of linked, set `CODEX_ARTIFACTS_ENV` to the absolute path of `.env.cloudflare.server`.

## Identity and access

New artifacts start private. Owners and the deployment's workspace viewers can read them immediately. Each artifact may also allow exact email addresses, email domains, or public access.

Owner, workspace-viewer, and per-artifact recipient emails are invitations. They are not permanent authorization keys.

- Better Auth verifies Google sign-in and assigns an immutable user ID.
- The first matching sign-in binds an invitation to that user ID.
- Later requests authorize the bound ID and check that its invitation still exists.
- Removing an owner or workspace-viewer email and redeploying revokes its access.
- Removing an artifact email or domain rule invalidates grants created from it.
- Owners can manage every artifact. Workspace viewers can read every artifact but cannot change them.
- Per-artifact recipients can read only artifacts shared with their exact email or domain.

Owner access wins when an address appears in both deployment lists.

Domain invitations are broad. A rule such as `gmail.com` would admit every matching signed-in account. Prefer exact-email invitations for sensitive artifacts.

## Configuration

Setup writes these ignored files:

- `.env.cloudflare.server` contains the publisher profile and saved setup values.
- `.env.cloudflare.secrets` contains Worker secrets uploaded during deployment.
- `.dev.vars` contains secrets for local development.
- `wrangler.jsonc` binds this clone to its D1 database and deployment settings.

The important values are:

| Variable | Purpose |
| --- | --- |
| `OWNER_EMAILS` | Comma-separated owner invitations |
| `WORKSPACE_VIEWER_EMAILS` | Read-only viewers of every artifact |
| `PUBLISH_TOKEN` | Deployment-wide automation authority |
| `ARTIFACTS_URL` | Publisher destination saved locally |
| `BETTER_AUTH_SECRET` | Better Auth session secret |
| `GOOGLE_CLIENT_ID` | Google OAuth web client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth web client secret |
| `ARTIFACTS_PUBLISH_TOKEN` | Process-level publisher token override |
| `ARTIFACTS_AUTO_OPEN=0` | Disable opening a published artifact |
| `CODEX_ARTIFACTS_ENV` | Use another publisher configuration file |
| `CLOUDFLARE_API_TOKEN` | Optional non-interactive Wrangler authentication |

Never commit the ignored configuration, Cloudflare credentials, publishing tokens, database exports, or private artifact URLs.

The automation contract remains documented in [openapi.yaml](openapi.yaml).

## Operations

### Automatic service deployments

The GitHub Actions workflow checks every pull request and push to `main`. After a push to `main` passes, its production job applies pending D1 migrations and deploys the Worker. The job does not receive the publishing token and never creates or updates individual artifacts.

Create a `production` environment in the GitHub repository with:

| Name | Kind | Value |
| --- | --- | --- |
| `ARTIFACTS_URL` | Environment variable | The deployed service origin |
| `CLOUDFLARE_ACCOUNT_ID` | Environment secret | The target Cloudflare account ID |
| `CLOUDFLARE_API_TOKEN` | Environment secret | A token restricted to the target account with Workers Scripts and D1 edit access |
| `CLOUDFLARE_WRANGLER_CONFIG` | Environment secret | The full contents of the ignored production `wrangler.jsonc` |

Restrict the environment's deployment branches to the selected branch `main`. This prevents workflows on other branches from requesting the production secrets.

The Wrangler configuration contains deployment metadata rather than Worker secrets, but storing it as an environment secret keeps owner and viewer email lists out of the public repository. Better Auth, Google OAuth, and publishing secrets remain stored in Cloudflare and survive normal Worker deployments.

### Manual service update

```sh
git pull --ff-only
npm run check
npm run setup
```

Setup preserves existing owners, viewers, secrets, database, URL, and custom domain unless command options replace them. It applies pending migrations before deployment.

### Back up D1

```sh
npx wrangler d1 export DB --remote \
  --config wrangler.jsonc \
  --output codex-artifacts-backup.sql
```

Keep exports private. They contain artifact HTML, identities, sessions, invitations, and access rules.

### Rotate secrets or change access lists

Edit `.env.cloudflare.server`, export any changed Google values if needed, then run `npm run setup`. To replace workspace viewers from the command line:

```sh
npm run setup -- --viewer one@example.com,two@example.com
npm run setup -- --clear-viewers
```

Changing `PUBLISH_TOKEN` takes effect at deployment. Update any separate publisher configuration that copied the old token. If GitHub deployment is configured, replace the `CLOUDFLARE_WRANGLER_CONFIG` environment secret after `wrangler.jsonc` changes so later deployments retain the new access lists and routes.

## Security and capacity

Artifact HTML is untrusted. The app renders it through `srcDoc` in an iframe sandbox without `allow-same-origin`. Scripts, forms, popups, downloads, and outbound requests are allowed inside the artifact. An artifact can transmit data embedded in its own HTML. Downloaded HTML is not sandboxed when opened directly.

The publishing token has owner-level automation authority. Anyone holding it can create artifacts and replace an artifact whose slug they know.

The service limits each artifact to 512 KiB and total artifact HTML to 400 MiB. A free D1 database allows 500 MB, leaving roughly 100 MB for auth data, access records, and indexes. Cloudflare's free plan also limits Worker requests and D1 operations. Monitor usage in the Cloudflare dashboard before production traffic approaches those ceilings.

Reads reject expired artifacts immediately. An hourly Cron Trigger reclaims expired rows, and publishing also removes expired rows before checking capacity.

## Local development

After setup has written `.dev.vars` and `wrangler.jsonc`:

```sh
npx wrangler d1 migrations apply DB --local --config wrangler.jsonc
npm run dev
```

Run the full check before committing:

```sh
npm run check
```

Local D1 data persists under `.wrangler/`. Google sign-in needs the local callback URL listed on the OAuth client.

## How it works

Cloudflare Workers hosts the Hono API and Vite-built React app. Better Auth stores Google users and sessions in D1. D1 also stores artifact metadata, access rules, and HTML in one row so publication stays atomic. The browser talks to a typed internal client, while automation uses the stable bearer-token HTTP API. HTML previews inject an `about:srcdoc` base URL at render time so fragment links stay inside the artifact without changing stored or downloaded HTML.

Codex Artifacts is independent and is not affiliated with or endorsed by OpenAI or Anthropic.
