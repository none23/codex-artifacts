# Contributing

## Development

Use Node.js 20.19 or later:

```sh
npm ci
npm run check
```

`npm run check` runs the Node test suite, TypeScript, and the production Cloudflare build.

The React app lives in `client/`, the Worker in `server/`, and shared contracts and validation in `shared/`. Build and setup scripts may use Node built-ins. Code bundled into the Worker or browser must use APIs available in those runtimes.

For local Worker and D1 development, copy `wrangler.example.jsonc` to the ignored `wrangler.jsonc`, replace its owner and database binding, and create `.dev.vars` with the Better Auth, Google OAuth, and publishing secrets described in the README. Then apply migrations:

```sh
npx wrangler d1 migrations apply DB --local --config wrangler.jsonc
npm run dev
```

## Security and privacy invariants

- New artifacts remain non-public. Configured workspace viewers have read-only access to every artifact.
- Authorization stays server-side and uses Better Auth user IDs after invitation acceptance.
- Only deployment owners may publish, replace, delete, or change access.
- Republishing preserves omitted exact-email, domain, and public settings.
- The artifact iframe must never gain `allow-same-origin`.
- One artifact stays below 512 KiB and total artifact HTML stays below 400 MiB.
- Tests, examples, commits, and issue reports contain no real credentials, private artifact URLs, or personal data.

## Pull requests

Keep changes focused. Explain user-visible behavior, security impact, schema effects, and verification. Add focused regression tests for access control, publisher configuration, CLI parsing, D1 migrations, and setup changes.

For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a public pull request.
