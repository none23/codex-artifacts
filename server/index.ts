import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiError, PublishInput, PublishResponse } from "../shared/api";
import {
  acceptArtifactAccess,
  artifactBySlug,
  claimOwnerAccess,
  claimWorkspaceViewerAccess,
  deleteArtifact,
  ownedArtifacts,
  ownerEmails,
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
import { AppError } from "./errors";
import { cleanSlug, cleanTitle, parseSharedEmails } from "../shared/config";
import {
  parseArtifactAccess,
  parseAutomationPublishRequest,
  parseExpirationUpdate,
  parsePublishInput
} from "./inputs";

type AppEnv = {
  Bindings: Bindings;
  Variables: {
    identity: Identity | null;
  };
};

const app = new Hono<AppEnv>();

async function requestJson(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json<unknown>();
  } catch {
    throw new AppError("Request body must be valid JSON.");
  }
}

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
  const input = parsePublishInput(await requestJson(c));
  return c.json(await publishAsSignedInOwner(c.env, c.var.identity, input));
});

app.patch("/api/app/artifacts/:id/expiration", async (c) => {
  const expiresInSeconds = parseExpirationUpdate(await requestJson(c));
  return c.json(
    await setArtifactExpiration(
      c.env,
      c.var.identity,
      c.req.param("id"),
      expiresInSeconds
    )
  );
});

app.put("/api/app/artifacts/:id/access", async (c) => {
  const access = parseArtifactAccess(await requestJson(c));
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

  const body = parseAutomationPublishRequest(await requestJson(c));

  const title = cleanTitle(body.title);
  const fallbackSlug = `${cleanSlug(title) || "artifact"}-${Date.now().toString(36)}`;
  const requestedSlug = cleanSlug(body.slug ?? "");
  const slug = requestedSlug || fallbackSlug;
  const existing = requestedSlug
    ? await c.env.DB
        .prepare(
          `select "id", "sharedWith", "sharedDomains", "isPublic"
           from "artifacts" where "slug" = ?`
        )
        .bind(requestedSlug)
        .first<{
          id: string;
          sharedWith: string;
          sharedDomains: string;
          isPublic: number;
        }>()
    : null;
  const sharedWith = body.sharedWith
    ? body.sharedWith
    : existing
      ? parseSharedEmails(existing.sharedWith)
      : [];
  const sharedDomains = body.sharedDomains
    ? body.sharedDomains
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
    isPublic: body.isPublic ?? existing?.isPublic === 1,
    expiresInSeconds: body.expiresInSeconds
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
