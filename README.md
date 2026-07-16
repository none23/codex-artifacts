# Codex Artifacts

A private-by-default HTML artifact service built as a [Lakebed](https://lakebed.dev) capsule.

- Google authentication is provided by Lakebed.
- Owner access is configured through `OWNER_EMAILS` in `shared/config.ts`; all listed verified Google emails can manage every artifact.
- New artifacts have no recipients by default.
- The owner can grant access to exact, normalized Google email addresses.
- Artifact HTML runs in a sandboxed iframe without `allow-same-origin`, keeping it away from the authenticated parent app.
- Codex and other local agents can publish through a server-secret-protected HTTP endpoint.

## Why Lakebed

Lakebed already includes Google auth, a database, hosting, deploy ownership, and a free hosted URL. Its object storage intentionally rejects HTML, so this capsule stores HTML in 48 KiB database chunks. Lakebed currently caps capsule state at 1 MiB and individual values at 64 KiB; this app caps each artifact at 512 KiB so updates and metadata have headroom. This is a good personal alpha, not a high-volume artifact archive.

## Run locally

```sh
npm run dev
```

Local Lakebed state resets when the dev server restarts. Select a test identity with `npx lakebed@0.0.29 auth as alice`; local guest identities do not have a verified Google email, so owner-only UI is intentionally available only after real Google sign-in. The automation endpoint can be tested locally by copying the example env file first.

```sh
cp .env.lakebed.server.example .env.lakebed.server
npm run dev
```

## Deploy and claim

An anonymous preview can be deployed immediately:

```sh
npm run deploy
```

To make the deployment permanent and enable the automation secret, authenticate and claim it in a browser:

```sh
npx lakebed@0.0.29 auth login
npx lakebed@0.0.29 claim
```

Generate a long secret, write it to the ignored `.env.lakebed.server`, then redeploy:

```sh
openssl rand -hex 32
# Add the result as: PUBLISH_TOKEN=<result>
npm run deploy
```

Optionally reserve a stable Lakebed subdomain after claiming:

```sh
npx lakebed@0.0.29 domains add codex-artifacts.lakebed.app
```

## Publish from Codex or a terminal

```sh
node scripts/publish.mjs ./report.html \
  --title "Architecture report" \
  --share teammate@example.com
```

When run from this repository, the script uses the production URL and reads `PUBLISH_TOKEN` from the ignored `.env.lakebed.server` automatically. `ARTIFACTS_URL` and `ARTIFACTS_PUBLISH_TOKEN` remain available as overrides. The command prints the private artifact URL. Recipients must open that URL and sign in with the exact Google email supplied in `--share`.

Do not commit `.env.lakebed.server` or place the publish token in an artifact.

Production: <https://codex-artifacts.lakebed.app>

## Global Codex skill

The reusable skill lives at `skills/create-artifact`. Link it into the user-level Codex skill directory so every new session can discover it:

```sh
ln -s /home/n/misc/artifacts/skills/create-artifact /home/n/.codex/skills/create-artifact
```

Then ask Codex to “create an artifact,” “publish this as a visual report,” or invoke `$create-artifact` explicitly. The skill creates a self-contained HTML page, publishes it privately, and returns the URL. Reusing an existing artifact slug updates the same URL.
