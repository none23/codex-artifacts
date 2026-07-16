# Codex Artifacts contributor notes

This repository is a Lakebed v0 capsule. Keep application code within `server/`, `client/`, and `shared/`; do not add runtime npm dependencies or Node built-ins to capsule code.

- Run `npm run build` after changes.
- Keep authorization server-side. Owner identities are the verified Google emails in `OWNER_EMAILS` within `shared/config.ts`.
- New artifacts must remain private until explicit recipient emails are saved.
- Never add `allow-same-origin` to the artifact iframe sandbox. Artifact HTML is untrusted relative to the authenticated shell.
- Keep HTML chunks below Lakebed's 64 KiB value limit and total state within its 1 MiB free capsule limit.
- Keep `.env.lakebed.server` and publish tokens out of git.
- Use `node scripts/publish.mjs ...` when asked to publish an HTML artifact through a configured deployment.
