import {
  capsule,
  endpoint,
  id,
  json,
  mutation,
  query,
  string,
  table,
  text,
  type ServerContext,
  type WriteDatabaseForSchema
} from "lakebed/server";
import {
  MAX_ARTIFACT_BYTES,
  MAX_CHUNK_BYTES,
  MAX_SHARED_EMAILS,
  OWNER_EMAIL,
  chunkHtml,
  cleanSlug,
  cleanTitle,
  normalizeEmail,
  normalizeSharedEmails,
  parseSharedEmails,
  utf8Bytes
} from "../shared/config";

const schema = {
  artifacts: table({
    slug: string(),
    title: string(),
    ownerId: string(),
    ownerEmail: string(),
    sharedWith: string().default("[]"),
    sizeBytes: string(),
    chunkCount: string()
  })
    .index("by_slug", ["slug"])
    .index("by_owner_email", ["ownerEmail"]),
  artifactChunks: table({
    artifactId: id("artifacts"),
    part: string(),
    content: string()
  }).index("by_artifact_part", ["artifactId", "part"])
};

type AppContext = ServerContext<WriteDatabaseForSchema<typeof schema>>;

type PublishInput = {
  artifactId?: string;
  title: string;
  slug: string;
  chunks: string[];
  sharedWith?: string[];
};

function authenticatedEmail(ctx: { auth: ServerContext["auth"] }): string | null {
  if (
    !ctx.auth.isAuthenticated ||
    ctx.auth.provider !== "google" ||
    ctx.auth.emailVerified !== true ||
    !ctx.auth.email
  ) {
    return null;
  }
  return normalizeEmail(ctx.auth.email);
}

function requireOwner(ctx: { auth: ServerContext["auth"] }): void {
  if (authenticatedEmail(ctx) !== OWNER_EMAIL) {
    throw new Error("Only the artifact owner can perform this action.");
  }
}

function validateChunks(chunks: string[]): number {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error("Artifact HTML cannot be empty.");
  }

  let total = 0;
  for (const chunk of chunks) {
    if (typeof chunk !== "string") {
      throw new Error("Artifact chunks must be strings.");
    }
    const size = utf8Bytes(chunk);
    if (size > MAX_CHUNK_BYTES) {
      throw new Error("An artifact chunk exceeds the 48 KiB limit.");
    }
    total += size;
  }

  if (total > MAX_ARTIFACT_BYTES) {
    throw new Error("Artifact exceeds the 512 KiB limit.");
  }
  return total;
}

function validatePublishInput(input: PublishInput) {
  const title = cleanTitle(input.title);
  const slug = cleanSlug(input.slug);
  const sizeBytes = validateChunks(input.chunks);
  const sharedWith = normalizeSharedEmails(input.sharedWith ?? []);

  if (!title) {
    throw new Error("Title is required.");
  }
  if (!slug) {
    throw new Error("A valid slug is required.");
  }
  if ((input.sharedWith?.length ?? 0) > MAX_SHARED_EMAILS) {
    throw new Error(`At most ${MAX_SHARED_EMAILS} people can be added.`);
  }

  return { title, slug, sizeBytes, sharedWith };
}

async function replaceChunks(ctx: AppContext, artifactId: string, chunks: string[]) {
  const oldChunks = await ctx.db.artifactChunks
    .withIndex("by_artifact_part", (q) => q.eq("artifactId", artifactId))
    .collect();

  for (const chunk of oldChunks) {
    await ctx.db.artifactChunks.delete(chunk.id);
  }

  for (let index = 0; index < chunks.length; index += 1) {
    await ctx.db.artifactChunks.insert({
      artifactId,
      part: String(index).padStart(4, "0"),
      content: chunks[index] ?? ""
    });
  }
}

async function publishAsOwner(
  ctx: AppContext,
  input: PublishInput,
  ownerId: string
): Promise<{ id: string; slug: string }> {
  const validated = validatePublishInput(input);

  if (input.artifactId) {
    const artifact = await ctx.db.artifacts.get(input.artifactId);
    if (!artifact || normalizeEmail(artifact.ownerEmail) !== OWNER_EMAIL) {
      throw new Error("Artifact not found.");
    }

    const slugMatch = await ctx.db.artifacts
      .withIndex("by_slug", (q) => q.eq("slug", validated.slug))
      .first();
    if (slugMatch && slugMatch.id !== artifact.id) {
      throw new Error("That slug is already in use.");
    }

    await replaceChunks(ctx, artifact.id, input.chunks);
    await ctx.db.artifacts.update(artifact.id, {
      title: validated.title,
      slug: validated.slug,
      sharedWith: JSON.stringify(validated.sharedWith),
      sizeBytes: String(validated.sizeBytes),
      chunkCount: String(input.chunks.length)
    });
    return { id: artifact.id, slug: validated.slug };
  }

  const existing = await ctx.db.artifacts
    .withIndex("by_slug", (q) => q.eq("slug", validated.slug))
    .first();
  if (existing) {
    throw new Error("That slug is already in use.");
  }

  const artifact = await ctx.db.artifacts.insert({
    title: validated.title,
    slug: validated.slug,
    ownerId,
    ownerEmail: OWNER_EMAIL,
    sharedWith: JSON.stringify(validated.sharedWith),
    sizeBytes: String(validated.sizeBytes),
    chunkCount: String(input.chunks.length)
  });
  await replaceChunks(ctx, artifact.id, input.chunks);
  return { id: artifact.id, slug: validated.slug };
}

export default capsule({
  name: "Codex Artifacts",
  favicon: "favicon.svg",
  schema,

  queries: {
    ownedArtifacts: query(async (ctx) => {
      if (authenticatedEmail(ctx) !== OWNER_EMAIL) {
        return [];
      }

      const artifacts = await ctx.db.artifacts
        .withIndex("by_owner_email", (q) => q.eq("ownerEmail", OWNER_EMAIL))
        .order("desc")
        .collect();

      return artifacts.map((artifact) => ({
        ...artifact,
        sharedWith: parseSharedEmails(artifact.sharedWith)
      }));
    }),

    artifactBySlug: query(async (ctx, slugInput: string) => {
      const email = authenticatedEmail(ctx);
      if (!email) {
        return null;
      }

      const slug = cleanSlug(slugInput);
      const artifact = await ctx.db.artifacts
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .first();
      if (!artifact) {
        return null;
      }

      const sharedWith = parseSharedEmails(artifact.sharedWith);
      if (email !== OWNER_EMAIL && !sharedWith.includes(email)) {
        return null;
      }

      const chunks = await ctx.db.artifactChunks
        .withIndex("by_artifact_part", (q) => q.eq("artifactId", artifact.id))
        .order("asc")
        .collect();

      return {
        id: artifact.id,
        slug: artifact.slug,
        title: artifact.title,
        html: chunks.map((chunk) => chunk.content).join(""),
        sizeBytes: Number(artifact.sizeBytes),
        updatedAt: artifact.updatedAt,
        sharedWith: email === OWNER_EMAIL ? sharedWith : []
      };
    })
  },

  mutations: {
    publishArtifact: mutation(async (ctx, input: PublishInput) => {
      requireOwner(ctx);
      return publishAsOwner(ctx, input, ctx.auth.userId);
    }),

    setArtifactShares: mutation(async (ctx, artifactId: string, emails: string[]) => {
      requireOwner(ctx);
      const artifact = await ctx.db.artifacts.get(artifactId);
      if (!artifact || normalizeEmail(artifact.ownerEmail) !== OWNER_EMAIL) {
        throw new Error("Artifact not found.");
      }
      if (!Array.isArray(emails) || emails.length > MAX_SHARED_EMAILS) {
        throw new Error(`At most ${MAX_SHARED_EMAILS} people can be added.`);
      }

      const sharedWith = normalizeSharedEmails(emails);
      await ctx.db.artifacts.update(artifact.id, {
        sharedWith: JSON.stringify(sharedWith)
      });
      return sharedWith;
    }),

    deleteArtifact: mutation(async (ctx, artifactId: string) => {
      requireOwner(ctx);
      const artifact = await ctx.db.artifacts.get(artifactId);
      if (!artifact || normalizeEmail(artifact.ownerEmail) !== OWNER_EMAIL) {
        throw new Error("Artifact not found.");
      }

      const chunks = await ctx.db.artifactChunks
        .withIndex("by_artifact_part", (q) => q.eq("artifactId", artifact.id))
        .collect();
      for (const chunk of chunks) {
        await ctx.db.artifactChunks.delete(chunk.id);
      }
      await ctx.db.artifacts.delete(artifact.id);
    })
  },

  endpoints: {
    status: endpoint({ method: "GET", path: "/api/status" }, () =>
      json({ ok: true, service: "codex-artifacts" })
    ),

    publish: endpoint({ method: "POST", path: "/api/artifacts" }, async (ctx, req) => {
      const expected = ctx.env.PUBLISH_TOKEN;
      const authorization = req.headers.get("authorization");
      if (!expected) {
        return json(
          { error: "Automation is disabled until PUBLISH_TOKEN is configured." },
          { status: 503 }
        );
      }
      if (authorization !== `Bearer ${expected}`) {
        return text("Unauthorized", { status: 401 });
      }

      try {
        const body = await req.json<{
          title?: unknown;
          slug?: unknown;
          html?: unknown;
          sharedWith?: unknown;
        }>();
        if (typeof body.title !== "string" || typeof body.html !== "string") {
          return json({ error: "title and html must be strings" }, { status: 400 });
        }

        const title = cleanTitle(body.title);
        const fallbackSlug = `${cleanSlug(title) || "artifact"}-${Date.now().toString(36)}`;
        const requestedSlug = typeof body.slug === "string" ? cleanSlug(body.slug) : "";
        const slug = requestedSlug || fallbackSlug;
        const existing = requestedSlug
          ? await ctx.db.artifacts
              .withIndex("by_slug", (q) => q.eq("slug", requestedSlug))
              .first()
          : null;
        const sharedWith = Array.isArray(body.sharedWith)
          ? body.sharedWith.filter((value): value is string => typeof value === "string")
          : existing
            ? parseSharedEmails(existing.sharedWith)
            : [];
        const result = await publishAsOwner(
          ctx as AppContext,
          {
            artifactId: existing?.id,
            title,
            slug,
            chunks: chunkHtml(body.html),
            sharedWith
          },
          `automation:${OWNER_EMAIL}`
        );
        return json({ ...result, updated: Boolean(existing) }, { status: existing ? 200 : 201 });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to publish artifact.";
        return json({ error: message }, { status: 400 });
      }
    })
  }
});
