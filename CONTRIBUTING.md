# Contributing

## Development

Use Node.js 20 or later:

```sh
npm ci
npm run check
```

`npm run check` runs the dependency-free Node test suite and builds the Lakebed capsule. Run it before every commit.

Application code belongs in `server/`, `client/`, and `shared/`. Capsule code may use Lakebed-provided modules and pure relative imports, but not Node built-ins or arbitrary runtime npm dependencies. Node built-ins are allowed in repository scripts and tests.

## Security and privacy invariants

- New artifacts remain non-public; configured workspace viewers have read-only access to every artifact.
- Authorization stays server-side and uses durable Lakebed user IDs after owner, workspace-viewer, or per-artifact invitation acceptance.
- Only deployment owners may publish, replace, delete, or change access.
- Republishing preserves omitted exact-email, domain, and public settings.
- The artifact iframe must never gain `allow-same-origin`.
- HTML chunks remain below Lakebed's value limit and total state stays below the deployment limit.
- Tests, examples, commits, and issue reports contain no real credentials, private artifact URLs, or personal data.

## Pull requests

Keep changes focused and explain user-visible behavior, security impact, schema migration behavior, and verification. Add regression tests for changes to access control, publisher configuration, CLI parsing, chunking, or deployment setup.

For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public pull request first.
