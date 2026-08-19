import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type {
  ApiError,
  ArtifactAccess,
  PublishInput,
  PublishResponse
} from "../shared/api";
import {
  acceptArtifactAccess,
  AppError,
  artifactBySlug,
  claimOwnerAccess,
  claimWorkspaceViewerAccess,
  deleteArtifact,
  ownedArtifacts,
  ownerEmails,
  pruneExpiredArtifacts,
  publishArtifact,
  publishAsSignedInOwner,
  removeExpiredArtifacts,
  setArtifactAccess,
  setArtifactExpiration,
  viewer
} from "./artifacts";
import {
  authenticatedIdentity,
  createAuth,
  type Bindings,
  type Identity
} from "./auth";
import { cleanSlug, cleanTitle, parseSharedEmails } from "../shared/config";

type AppEnv = {
  Bindings: Bindings;
  Variables: {
    identity: Identity | null;
  };
};

const app = new Hono<AppEnv>();

app.onError((error, c) => {
  if (error instanceof AppError) {
    return c.json<ApiError>(
      { error: error.message },
      error.status as ContentfulStatusCode
    );
  }
  console.error(error);
  return c.json<ApiError>({ error: "Internal server error." }, 500);
});

app.get("/api/status", (c) =>
  c.json({ ok: true as const, service: "codex-artifacts" as const })
);

app.on(["GET", "POST"], "/api/auth/*", (c) =>
  createAuth(c.env).handler(c.req.raw)
);

app.use("/api/app/*", async (c, next) => {
  c.set("identity", await authenticatedIdentity(c.req.raw, c.env));
  await next();
});

app.get("/api/app/viewer", async (c) =>
  c.json(await viewer(c.env, c.var.identity))
);

app.get("/api/app/artifacts", async (c) =>
  c.json(await ownedArtifacts(c.env, c.var.identity))
);

app.get("/api/app/artifacts/:slug", async (c) =>
  c.json(await artifactBySlug(c.env, c.var.identity, c.req.param("slug")))
);

app.post("/api/app/access/claim-owner", async (c) =>
  c.json({ claimed: await claimOwnerAccess(c.env, c.var.identity) })
);

app.post("/api/app/access/claim-workspace-viewer", async (c) =>
  c.json({ claimed: await claimWorkspaceViewerAccess(c.env, c.var.identity) })
);

app.post("/api/app/artifacts/:slug/access/accept", async (c) =>
  c.json(
    await acceptArtifactAccess(c.env, c.var.identity, c.req.param("slug"))
  )
);

app.post("/api/app/artifacts", async (c) => {
  const input = await c.req.json<PublishInput>();
  return c.json(await publishAsSignedInOwner(c.env, c.var.identity, input));
});

app.patch("/api/app/artifacts/:id/expiration", async (c) => {
  const body = await c.req.json<{ expiresInSeconds?: unknown }>();
  if (
    body.expiresInSeconds !== null &&
    typeof body.expiresInSeconds !== "number"
  ) {
    throw new AppError("expiresInSeconds must be a number of seconds or null");
  }
  return c.json(
    await setArtifactExpiration(
      c.env,
      c.var.identity,
      c.req.param("id"),
      body.expiresInSeconds
    )
  );
});

app.post("/api/app/artifacts/prune", async (c) =>
  c.json(await pruneExpiredArtifacts(c.env, c.var.identity))
);

app.put("/api/app/artifacts/:id/access", async (c) => {
  const access = await c.req.json<ArtifactAccess>();
  return c.json(
    await setArtifactAccess(c.env, c.var.identity, c.req.param("id"), access)
  );
});

app.delete("/api/app/artifacts/:id", async (c) => {
  await deleteArtifact(c.env, c.var.identity, c.req.param("id"));
  return c.body(null, 204);
});

app.post("/api/artifacts", async (c) => {
  const expected = c.env.PUBLISH_TOKEN;
  if (!expected) {
    return c.json<ApiError>(
      { error: "Automation is disabled until PUBLISH_TOKEN is configured." },
      503
    );
  }
  if (c.req.header("authorization") !== `Bearer ${expected}`) {
    return c.text("Unauthorized", 401);
  }

  const body = await c.req.json<{
    title?: unknown;
    slug?: unknown;
    html?: unknown;
    sharedWith?: unknown;
    sharedDomains?: unknown;
    isPublic?: unknown;
    expiresInSeconds?: unknown;
  }>();
  if (typeof body.title !== "string" || typeof body.html !== "string") {
    throw new AppError("title and html must be strings");
  }
  if (
    body.expiresInSeconds !== undefined &&
    body.expiresInSeconds !== null &&
    typeof body.expiresInSeconds !== "number"
  ) {
    throw new AppError("expiresInSeconds must be a number of seconds or null");
  }

  const title = cleanTitle(body.title);
  const fallbackSlug = `${cleanSlug(title) || "artifact"}-${Date.now().toString(36)}`;
  const requestedSlug =
    typeof body.slug === "string" ? cleanSlug(body.slug) : "";
  const slug = requestedSlug || fallbackSlug;
  const existing = requestedSlug
    ? await c.env.DB
        .prepare('select * from "artifacts" where "slug" = ?')
        .bind(requestedSlug)
        .first<{
          id: string;
          sharedWith: string;
          sharedDomains: string;
          isPublic: number;
        }>()
    : null;
  const sharedWith = Array.isArray(body.sharedWith)
    ? body.sharedWith.filter(
        (value): value is string => typeof value === "string"
      )
    : existing
      ? parseSharedEmails(existing.sharedWith)
      : [];
  const sharedDomains = Array.isArray(body.sharedDomains)
    ? body.sharedDomains.filter(
        (value): value is string => typeof value === "string"
      )
    : existing
      ? parseSharedEmails(existing.sharedDomains)
      : [];
  const input: PublishInput = {
    artifactId: existing?.id,
    title,
    slug,
    html: body.html,
    sharedWith,
    sharedDomains,
    isPublic:
      typeof body.isPublic === "boolean"
        ? body.isPublic
        : existing?.isPublic === 1,
    expiresInSeconds: body.expiresInSeconds as number | null | undefined
  };
  const result = await publishArtifact(
    c.env,
    input,
    `automation:${ownerEmails(c.env)[0]}`
  );
  const response: PublishResponse = {
    ...result,
    updated: Boolean(existing)
  };
  return c.json(response, existing ? 200 : 201);
});

export type AppType = typeof app;

export default {
  fetch: app.fetch,
  scheduled(
    _controller: ScheduledController,
    env: Bindings,
    context: ExecutionContext
  ) {
    context.waitUntil(removeExpiredArtifacts(env.DB));
  }
} satisfies ExportedHandler<Bindings>;
