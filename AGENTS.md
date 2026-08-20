# Codex Artifacts contributor notes

- Keep authorization in the Worker. Emails locate invitations; durable owner, workspace-viewer, and recipient authorization uses immutable Better Auth user IDs.
- New artifacts stay non-public. Owners and configured workspace viewers may read them until an owner adds recipients or enables public access.
- Only owners may change artifacts or access. Replacing HTML preserves omitted exact-email, domain, and public settings.
- Treat artifact HTML as untrusted. Keep the iframe sandbox free of `allow-same-origin`.
- Keep one artifact below 512 KiB and total artifact HTML below the 400 MiB application budget.
- Treat released D1 migrations as append-only. Add a numbered migration for later schema changes.
- Update `shared/api.ts`, the Worker route, and the browser client together when an internal contract changes.
- Treat setup as the update path. Preserve saved owners, viewers, secrets, database, URL, and custom domain unless the user explicitly replaces them.
- Keep service deployment separate from artifact publishing. Deployment automation must not receive the publishing token or create artifacts.
- Keep credentials, deployment configuration, database exports, workspace-viewer invitations, and private artifact URLs out of commits and public reports. Rotate exposed secrets immediately.
