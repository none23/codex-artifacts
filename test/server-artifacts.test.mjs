import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  server: { middlewareMode: true }
});
const {
  acceptArtifactAccess,
  artifactBySlug,
  claimOwnerAccess,
  claimWorkspaceViewerAccess,
  hasOwnerAccess,
  ownedArtifacts,
  setArtifactAccess
} = await vite.ssrLoadModule("/server/artifacts.ts");

after(() => vite.close());

function normalizeSql(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

function createDatabase() {
  const state = {
    artifacts: [],
    ownerBindings: new Map(),
    workspaceViewerBindings: new Map(),
    grants: [],
    queries: []
  };

  class Statement {
    constructor(sql) {
      this.sql = normalizeSql(sql);
      this.values = [];
      state.queries.push(this.sql);
    }

    bind(...values) {
      this.values = values;
      return this;
    }

    async first() {
      const bindingMatch = this.sql.match(
        /^select "invitedEmail" from "(ownerBindings|workspaceViewerBindings)" where "userId" = \?$/
      );
      if (bindingMatch) {
        const invitedEmail = state[bindingMatch[1]].get(this.values[0]);
        return invitedEmail ? { invitedEmail } : null;
      }

      const invitationMatch = this.sql.match(
        /^select "userId" from "(ownerBindings|workspaceViewerBindings)" where "invitedEmail" = \?$/
      );
      if (invitationMatch) {
        for (const [userId, invitedEmail] of state[invitationMatch[1]]) {
          if (invitedEmail === this.values[0]) return { userId };
        }
        return null;
      }

      if (
        this.sql.includes('from "artifacts" where "id" = ?') &&
        !this.sql.includes('select "html"')
      ) {
        const artifact = state.artifacts.find(
          (candidate) => candidate.id === this.values[0]
        );
        if (!artifact) return null;
        const { html: _html, ...metadata } = artifact;
        return metadata;
      }
      if (
        this.sql.includes('from "artifacts" where "slug" = ?') &&
        !this.sql.includes('select "html"')
      ) {
        const artifact = state.artifacts.find(
          (candidate) => candidate.slug === this.values[0]
        );
        if (!artifact) return null;
        const { html: _html, ...metadata } = artifact;
        return metadata;
      }
      if (this.sql === 'select "html" from "artifacts" where "id" = ?') {
        const artifact = state.artifacts.find(
          (candidate) => candidate.id === this.values[0]
        );
        return artifact ? { html: artifact.html } : null;
      }
      if (
        this.sql ===
        'select "ruleType", "ruleValue" from "artifactGrants" where "artifactId" = ? and "userId" = ?'
      ) {
        const grant = state.grants.find(
          (candidate) =>
            candidate.artifactId === this.values[0] &&
            candidate.userId === this.values[1]
        );
        return grant
          ? { ruleType: grant.ruleType, ruleValue: grant.ruleValue }
          : null;
      }
      throw new Error(`Unexpected first() query: ${this.sql}`);
    }

    async all() {
      if (
        this.sql ===
        'select "id", "ruleType", "ruleValue" from "artifactGrants" where "artifactId" = ?'
      ) {
        return {
          results: state.grants
            .filter((grant) => grant.artifactId === this.values[0])
            .map(({ id, ruleType, ruleValue }) => ({ id, ruleType, ruleValue }))
        };
      }
      if (
        this.sql.includes('from "artifacts" where "expiresAt" is null or "expiresAt" > ?')
      ) {
        const cutoff = this.values[0];
        return {
          results: state.artifacts
            .filter(
              (artifact) =>
                artifact.expiresAt === null || artifact.expiresAt > cutoff
            )
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
            .map(({ html: _html, ...artifact }) => artifact)
        };
      }
      throw new Error(`Unexpected all() query: ${this.sql}`);
    }

    async run() {
      const bindingInsert = this.sql.match(
        /^insert into "(ownerBindings|workspaceViewerBindings)" \("userId", "invitedEmail"\) values \(\?, \?\)$/
      );
      if (bindingInsert) {
        state[bindingInsert[1]].set(this.values[0], this.values[1]);
        return { meta: { changes: 1 } };
      }

      const bindingUpdate = this.sql.match(
        /^update "(ownerBindings|workspaceViewerBindings)" set "invitedEmail" = \? where "userId" = \?$/
      );
      if (bindingUpdate) {
        state[bindingUpdate[1]].set(this.values[1], this.values[0]);
        return { meta: { changes: 1 } };
      }

      if (this.sql.startsWith('insert into "artifactGrants"')) {
        const [id, artifactId, userId, ruleType, ruleValue] = this.values;
        const existing = state.grants.find(
          (grant) => grant.artifactId === artifactId && grant.userId === userId
        );
        if (existing) {
          existing.ruleType = ruleType;
          existing.ruleValue = ruleValue;
        } else {
          state.grants.push({ id, artifactId, userId, ruleType, ruleValue });
        }
        return { meta: { changes: 1 } };
      }

      if (this.sql.startsWith('update "artifacts" set "sharedWith" = ?')) {
        const [sharedWith, sharedDomains, isPublic, updatedAt, artifactId] =
          this.values;
        const artifact = state.artifacts.find(
          (candidate) => candidate.id === artifactId
        );
        if (!artifact) return { meta: { changes: 0 } };
        Object.assign(artifact, {
          sharedWith,
          sharedDomains,
          isPublic,
          updatedAt
        });
        return { meta: { changes: 1 } };
      }

      if (this.sql === 'delete from "artifactGrants" where "id" = ?') {
        const index = state.grants.findIndex((grant) => grant.id === this.values[0]);
        if (index === -1) return { meta: { changes: 0 } };
        state.grants.splice(index, 1);
        return { meta: { changes: 1 } };
      }
      throw new Error(`Unexpected run() query: ${this.sql}`);
    }
  }

  const db = {
    prepare(sql) {
      return new Statement(sql);
    },
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    }
  };
  return { db, state };
}

function artifact(overrides = {}) {
  const now = new Date().toISOString();
  return {
    id: "artifact-1",
    slug: "private-report",
    title: "Private report",
    ownerId: "owner-id",
    ownerEmail: "owner@example.com",
    sharedWith: '["reader@example.com"]',
    sharedDomains: '["example.org"]',
    isPublic: 0,
    expiresAt: null,
    sizeBytes: 18,
    html: "<h1>Private</h1>",
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function environment(db, overrides = {}) {
  return {
    DB: db,
    OWNER_EMAILS: "owner@example.com",
    WORKSPACE_VIEWER_EMAILS: "",
    ...overrides
  };
}

test("binds an owner invitation to a user ID and honors later revocation", async () => {
  const { db } = createDatabase();
  const env = environment(db);
  const identity = { userId: "owner-id", email: "owner@example.com" };

  assert.equal(await claimOwnerAccess(env, identity), true);
  assert.equal(await hasOwnerAccess(env, identity), true);

  env.OWNER_EMAILS = "replacement@example.com";
  assert.equal(await hasOwnerAccess(env, identity), false);
});

test("binds exact-email and domain access to user IDs and revokes stale grants", async () => {
  const { db, state } = createDatabase();
  const env = environment(db);
  const owner = { userId: "owner-id", email: "owner@example.com" };
  const exactRecipient = {
    userId: "reader-id",
    email: "reader@example.com"
  };
  const domainRecipient = {
    userId: "domain-reader-id",
    email: "person@example.org"
  };
  state.artifacts.push(artifact());
  await claimOwnerAccess(env, owner);

  assert.deepEqual(
    await acceptArtifactAccess(env, exactRecipient, "private-report"),
    { status: "accepted" }
  );
  const durableView = await artifactBySlug(
    env,
    { ...exactRecipient, email: "renamed@example.net" },
    "private-report"
  );
  assert.equal(durableView?.html, "<h1>Private</h1>");

  await setArtifactAccess(env, owner, "artifact-1", {
    emails: [],
    domains: ["example.org"],
    isPublic: false
  });
  assert.equal(state.grants.length, 0);
  assert.equal(
    await artifactBySlug(env, exactRecipient, "private-report"),
    null
  );

  assert.deepEqual(
    await acceptArtifactAccess(env, domainRecipient, "private-report"),
    { status: "accepted" }
  );
  assert.equal(
    (await artifactBySlug(env, domainRecipient, "private-report"))?.slug,
    "private-report"
  );

  await setArtifactAccess(env, owner, "artifact-1", {
    emails: [],
    domains: [],
    isPublic: false
  });
  assert.equal(
    await artifactBySlug(env, domainRecipient, "private-report"),
    null
  );
});

test("workspace viewer bindings grant read-only access to private artifacts", async () => {
  const { db, state } = createDatabase();
  const env = environment(db, {
    WORKSPACE_VIEWER_EMAILS: "viewer@example.com"
  });
  const viewer = { userId: "viewer-id", email: "viewer@example.com" };
  state.artifacts.push(artifact({ sharedWith: "[]", sharedDomains: "[]" }));

  assert.equal(await claimWorkspaceViewerAccess(env, viewer), true);
  const viewed = await artifactBySlug(env, viewer, "private-report");
  assert.equal(viewed?.slug, "private-report");
  assert.equal(viewed?.canManage, false);
});

test("loads artifact HTML only after authorization succeeds", async () => {
  const { db, state } = createDatabase();
  const env = environment(db);
  state.artifacts.push(artifact({ sharedWith: "[]", sharedDomains: "[]" }));

  assert.equal(
    await artifactBySlug(
      env,
      { userId: "stranger-id", email: "stranger@example.net" },
      "private-report"
    ),
    null
  );
  assert.equal(
    state.queries.some((sql) => sql.includes('select "html"')),
    false
  );

  state.queries.length = 0;
  const owner = { userId: "owner-id", email: "owner@example.com" };
  await claimOwnerAccess(env, owner);
  assert.equal(
    (await artifactBySlug(env, owner, "private-report"))?.html,
    "<h1>Private</h1>"
  );
  assert.equal(
    state.queries.filter((sql) => sql.includes('select "html"')).length,
    1
  );
});

test("owner listings select unexpired metadata without artifact HTML", async () => {
  const { db, state } = createDatabase();
  const env = environment(db);
  const owner = { userId: "owner-id", email: "owner@example.com" };
  state.artifacts.push(
    artifact(),
    artifact({
      id: "expired-artifact",
      slug: "expired",
      expiresAt: "2020-01-01T00:00:00.000Z"
    })
  );
  await claimOwnerAccess(env, owner);

  const listed = await ownedArtifacts(env, owner);
  assert.deepEqual(listed.map(({ slug }) => slug), ["private-report"]);
  assert.equal("html" in listed[0], false);

  const listingQuery = state.queries.find(
    (sql) => sql.includes('from "artifacts"') && sql.includes("order by")
  );
  assert.ok(listingQuery);
  assert.doesNotMatch(listingQuery, /select \*/);
  assert.doesNotMatch(listingQuery, /"html"/);
  assert.match(listingQuery, /"expiresAt" is null or "expiresAt" > \?/);
});
