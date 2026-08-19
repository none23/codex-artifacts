# Security policy

## Supported version

Security fixes are made on the default branch. This project has not yet published a stable compatibility or long-term-support policy.

## Report a vulnerability

Use **Security → Report a vulnerability** in the GitHub repository so details remain private. If private vulnerability reporting is unavailable, open a minimal issue asking the maintainer to establish a private channel; do not include exploit details, credentials, private artifact URLs, or personal data in a public issue.

Include:

- Affected revision and deployment mode
- Reproduction steps or a proof of concept
- Expected and observed impact
- Any suggested mitigation

Do not test against a deployment you do not own or have explicit permission to assess.

## Deployment secrets

Publishing tokens, Cloudflare tokens, Google OAuth secrets, `.dev.vars`, `.env.cloudflare.*`, `wrangler.jsonc`, database exports, workspace-viewer invitations, and private artifact URLs must not be committed or included in reports. Rotate a secret immediately if it is exposed.
