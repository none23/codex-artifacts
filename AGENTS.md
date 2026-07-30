# Codex Artifacts contributor notes

This repository is a Lakebed v0 capsule. Keep application code within `server/`, `client/`, and `shared/`; do not add runtime npm dependencies or Node built-ins to capsule code.

- Run `npm run build` after changes.
- Keep authorization server-side. Emails locate pending invitations; durable owner, workspace-viewer, and per-artifact recipient authorization uses immutable Lakebed user IDs.
- New artifacts must remain non-public. Only owners and configured workspace viewers may read them until explicit per-artifact recipients are saved.
- Only owners may change access. Preserve exact-email, domain, and public settings when replacing or republishing HTML.
- Never add `allow-same-origin` to the artifact iframe sandbox. Artifact HTML is untrusted relative to the authenticated shell.
- Keep HTML chunks below Lakebed's 64 KiB value limit, artifact HTML within the 768 KiB application budget, and total state within Lakebed's 1 MiB capsule limit.
- Keep `.env.lakebed.server` and publish tokens out of git.
- Use `node scripts/publish.mjs ...` when asked to publish an HTML artifact through a configured deployment.
