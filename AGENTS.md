# Codex Artifacts contributor notes

This repository deploys a React app and Hono API as one Cloudflare Worker. D1 stores auth, access rules, metadata, and artifact HTML.

- Run `npm run check` after changes.
- Keep authorization in the Worker. Emails locate pending invitations; durable owner, workspace-viewer, and recipient authorization uses immutable Better Auth user IDs.
- New artifacts stay non-public. Owners and configured workspace viewers may read them until an owner adds recipients or enables public access.
- Only owners may change artifacts or access. Replacing HTML preserves omitted exact-email, domain, and public settings.
- Keep the artifact iframe sandbox free of `allow-same-origin`. Artifact HTML is untrusted relative to the authenticated shell.
- Keep one artifact below 512 KiB and total artifact HTML below the 400 MiB application budget.
- Treat released D1 migrations as append-only. Add a numbered migration for later schema changes.
- Keep `.dev.vars`, `.env.cloudflare.*`, `wrangler.jsonc`, database exports, and deployment tokens out of git.
- Keep Node built-ins in scripts and build configuration. Worker and browser code must use runtime-compatible APIs.
- Update `shared/api.ts`, the Worker route, and the browser client together when an internal contract changes.
- Use `node scripts/publish.mjs ...` when asked to publish HTML through a configured deployment.
