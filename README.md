<p align="center">
  <img src="favicon.svg" alt="Codex Artifacts logo" width="96" height="96">
</p>

<h1 align="center">Codex Artifacts</h1>

<p align="center">Turn an agent's HTML output into a private link you can open and share.</p>

Codex Artifacts is a self-hosted home for reports, dashboards, plans, and walkthroughs made by coding agents. It is useful when a chat response is too cramped, a file is awkward to pass around, or you want to revisit the result later at the same URL.

Your installation runs in your Cloudflare account. You control its data, credentials, and access. There is no shared hosted service.

**[Open the public demo](https://codex-artifacts.none23.workers.dev/?artifact=capabilities-demo)**

## How it works

1. Ask your agent to create an artifact.
2. The agent builds and publishes the page.
3. The page opens in your browser.
4. You share it only with the people who need it.

Artifacts start private and expire after three days unless you ask for a different lifetime. Reusing an artifact keeps the same URL, which is handy for plans and reports that change over time.

## Install with your agent

You need Node.js 26.7 or later, a Cloudflare account, and a Google account.

Give this request to Codex or Claude Code:

```text
Install Codex Artifacts for me from https://github.com/none23/codex-artifacts.
First, ask me for the owner email address and any workspace viewers. Guide me
through creating a Google OAuth web client, then ask for its client ID and
secret. Have me enter secrets locally instead of in chat. Ask me to authorize
Cloudflare when needed. Then deploy the service, link its included skill into
this agent, verify the deployment, and tell me how to create my first artifact.
```

The agent can handle the repository, deployment, and skill setup. You will still need to sign in to Cloudflare and create a Google OAuth web client when prompted. Enter secrets locally instead of pasting them into chat.

<details>
<summary><strong>Prefer to install it yourself?</strong> Show the manual steps.</summary>

### 1. Create a Google OAuth client

Create a web OAuth client in Google Cloud Console. Add this redirect URI:

```text
http://localhost:5173/api/auth/callback/google
```

Copy the client ID and client secret. You will add the production redirect URI after deployment.

### 2. Deploy

```sh
git clone https://github.com/none23/codex-artifacts.git
cd codex-artifacts
npm ci

export GOOGLE_CLIENT_ID="your-client-id"
export GOOGLE_CLIENT_SECRET="your-client-secret"
npm run setup -- --owner you@example.com
```

Setup signs in to Cloudflare, creates the required storage, deploys the service, and prints its URL.

To give someone read-only access to every artifact, add them as a workspace viewer:

```sh
npm run setup -- --owner you@example.com --viewer teammate@example.com
```

### 3. Finish Google sign-in

Add the production callback URL printed by setup to the same Google OAuth client. Open the service URL and choose **Sign in with Google**.

### 4. Connect your agent

Link the included skill into Codex, Claude Code, or both:

```sh
REPO_DIR="$(pwd)"

mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
ln -sfn "$REPO_DIR/skills/codex-artifacts" \
  "${CODEX_HOME:-$HOME/.codex}/skills/codex-artifacts"

mkdir -p "$HOME/.claude/skills"
ln -sfn "$REPO_DIR/skills/codex-artifacts" \
  "$HOME/.claude/skills/codex-artifacts"
```

Start a new agent session after linking the skill.

</details>

## Create your first artifact

Ask in plain language:

```text
Use codex-artifacts to create and publish a visual architecture report for this repository.
```

Include access or lifetime in the request when needed:

```text
Publish this as a private artifact, share it with teammate@example.com, and keep it for one week.
```

The skill handles the publishing commands. You only need to describe the result and who should see it.

## Access and configuration

| Choice | What it means |
| --- | --- |
| Owner | Can publish, update, delete, and manage access for every artifact |
| Workspace viewer | Can read every artifact but cannot change anything |
| Artifact recipient | Can read one artifact shared with their email address or email domain |
| Public access | Anyone with the link can read that artifact |

Prefer exact email addresses for sensitive artifacts. Sharing with a domain gives every signed-in account on that domain access.

Setup saves the deployment configuration and secrets in ignored local files. Keep the repository clone, keep those files private, and rerun `npm run setup` when you need to change the installation. `npm run setup -- --help` lists the available settings.

For security reporting and secret-handling guidance, read [SECURITY.md](SECURITY.md). For development setup and contribution rules, read [CONTRIBUTING.md](CONTRIBUTING.md).

Codex Artifacts is independent and is not affiliated with or endorsed by OpenAI or Anthropic.
