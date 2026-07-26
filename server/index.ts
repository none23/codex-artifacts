import {
  boolean,
  capsule,
  endpoint,
  id,
  json,
  mutation,
  query,
  string,
  table,
  text,
  type QueryServerContext,
  type ServerContext,
  type WriteDatabaseForSchema
} from "lakebed/server";
import {
  MAX_ARTIFACT_BYTES,
  MAX_CHUNK_BYTES,
  MAX_SHARED_DOMAINS,
  MAX_SHARED_EMAILS,
  chunkHtml,
  cleanSlug,
  cleanTitle,
  emailDomain,
  isValidEmail,
  normalizeEmail,
  normalizeSharedDomains,
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
    sharedDomains: string().default("[]"),
    isPublic: boolean().default(false),
    sizeBytes: string(),
    chunkCount: string()
  })
    .index("by_slug", ["slug"])
    .index("by_owner_email", ["ownerEmail"]),
  artifactChunks: table({
    artifactId: id("artifacts"),
    part: string(),
    content: string()
  }).index("by_artifact_part", ["artifactId", "part"]),
  ownerBindings: table({
    userId: string(),
    invitedEmail: string()
  })
    .index("by_user_id", ["userId"])
    .index("by_invited_email", ["invitedEmail"]),
  artifactGrants: table({
    artifactId: id("artifacts"),
    userId: string(),
    ruleType: string(),
    ruleValue: string()
  })
    .index("by_artifact_user", ["artifactId", "userId"])
    .index("by_artifact", ["artifactId"])
};

type AppContext = ServerContext<WriteDatabaseForSchema<typeof schema>>;
type EnvironmentContext = { env: ServerContext["env"] };
type AuthEnvironmentContext = Pick<QueryServerContext, "auth" | "env">;
type OwnerReadContext = AuthEnvironmentContext & {
  db: {
    ownerBindings: Pick<AppContext["db"]["ownerBindings"], "withIndex">;
  };
};
type GrantReadContext = {
  db: {
    artifactGrants: Pick<AppContext["db"]["artifactGrants"], "withIndex">;
  };
};

type PublishInput = {
  artifactId?: string;
  title: string;
  slug: string;
  chunks: string[];
  sharedWith?: string[];
  isPublic?: boolean;
};

function ownerEmails(ctx: EnvironmentContext): string[] {
  const configured = (ctx.env.OWNER_EMAILS ?? "")
    .split(",")
    .map(normalizeEmail)
    .filter(isValidEmail);
  const emails = [...new Set(configured)];
  if (!emails.length) {
    throw new Error("OWNER_EMAILS must contain at least one valid email address.");
  }
  return emails;
}

function primaryOwnerEmail(ctx: EnvironmentContext): string {
  return ownerEmails(ctx)[0]!;
}

function isConfiguredOwner(ctx: EnvironmentContext, value: string): boolean {
  return ownerEmails(ctx).includes(normalizeEmail(value));
}

function authenticatedIdentity(
  ctx: { auth: ServerContext["auth"] }
): { userId: string; email: string } | null {
  if (
    !ctx.auth.isAuthenticated ||
    ctx.auth.provider !== "google" ||
    ctx.auth.emailVerified !== true ||
    !ctx.auth.email
  ) {
    return null;
  }
  return {
    userId: ctx.auth.userId,
    email: normalizeEmail(ctx.auth.email)
  };
}

async function ownerBinding(ctx: OwnerReadContext, userId: string) {
  return ctx.db.ownerBindings
    .withIndex("by_user_id", (q) => q.eq("userId", userId))
    .first();
}

async function hasOwnerAccess(ctx: OwnerReadContext): Promise<boolean> {
  const identity = authenticatedIdentity(ctx);
  if (!identity) {
    return false;
  }
  const binding = await ownerBinding(ctx, identity.userId);
  return Boolean(binding && ownerEmails(ctx).includes(binding.invitedEmail));
}

async function requireOwner(ctx: OwnerReadContext): Promise<void> {
  if (!(await hasOwnerAccess(ctx))) {
    throw new Error("Only the artifact owner can perform this action.");
  }
}

async function claimConfiguredOwner(ctx: AppContext): Promise<boolean> {
  const identity = authenticatedIdentity(ctx);
  if (!identity || !isConfiguredOwner(ctx, identity.email)) {
    return false;
  }

  const existingForUser = await ownerBinding(ctx, identity.userId);
  if (existingForUser?.invitedEmail === identity.email) {
    return true;
  }

  const existingForInvitation = await ctx.db.ownerBindings
    .withIndex("by_invited_email", (q) => q.eq("invitedEmail", identity.email))
    .first();
  if (existingForInvitation && existingForInvitation.userId !== identity.userId) {
    throw new Error("This owner invitation has already been accepted by another identity.");
  }

  if (existingForUser) {
    await ctx.db.ownerBindings.update(existingForUser.id, {
      invitedEmail: identity.email
    });
  } else if (!existingForInvitation) {
    await ctx.db.ownerBindings.insert({
      userId: identity.userId,
      invitedEmail: identity.email
    });
  }
  return true;
}

async function validArtifactGrant(
  ctx: GrantReadContext,
  artifactId: string,
  userId: string,
  sharedWith: string[],
  sharedDomains: string[]
): Promise<boolean> {
  const grants = await ctx.db.artifactGrants
    .withIndex("by_artifact_user", (q) =>
      q.eq("artifactId", artifactId).eq("userId", userId)
    )
    .collect();
  return grants.some((grant) =>
    grant.ruleType === "email"
      ? sharedWith.includes(grant.ruleValue)
      : grant.ruleType === "domain" && sharedDomains.includes(grant.ruleValue)
  );
}

async function pruneArtifactGrants(
  ctx: AppContext,
  artifactId: string,
  sharedWith: string[],
  sharedDomains: string[]
) {
  const grants = await ctx.db.artifactGrants
    .withIndex("by_artifact", (q) => q.eq("artifactId", artifactId))
    .collect();
  for (const grant of grants) {
    const isValid =
      (grant.ruleType === "email" && sharedWith.includes(grant.ruleValue)) ||
      (grant.ruleType === "domain" && sharedDomains.includes(grant.ruleValue));
    if (!isValid) {
      await ctx.db.artifactGrants.delete(grant.id);
    }
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

function validatePublishInput(input: PublishInput, configuredOwners: string[]) {
  const title = cleanTitle(input.title);
  const slug = cleanSlug(input.slug);
  const sizeBytes = validateChunks(input.chunks);
  const sharedWith = normalizeSharedEmails(input.sharedWith ?? [], configuredOwners);

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
  const configuredOwners = ownerEmails(ctx);
  const validated = validatePublishInput(input, configuredOwners);

  if (input.artifactId) {
    const artifact = await ctx.db.artifacts.get(input.artifactId);
    if (!artifact) {
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
      isPublic: input.isPublic ?? artifact.isPublic,
      sizeBytes: String(validated.sizeBytes),
      chunkCount: String(input.chunks.length)
    });
    await pruneArtifactGrants(
      ctx,
      artifact.id,
      validated.sharedWith,
      parseSharedEmails(artifact.sharedDomains)
    );
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
    ownerEmail: configuredOwners[0]!,
    sharedWith: JSON.stringify(validated.sharedWith),
    sharedDomains: "[]",
    isPublic: input.isPublic === true,
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
    viewer: query(async (ctx) => {
      const identity = authenticatedIdentity(ctx);
      return {
        isOwner: await hasOwnerAccess(ctx),
        canClaimOwner: Boolean(identity && isConfiguredOwner(ctx, identity.email))
      };
    }),

    ownedArtifacts: query(async (ctx) => {
      if (!(await hasOwnerAccess(ctx))) {
        return [];
      }

      const artifacts = await ctx.db.artifacts
        .withIndex("by_creation")
        .order("desc")
        .collect();

      return artifacts.map((artifact) => ({
        ...artifact,
        sharedWith: parseSharedEmails(artifact.sharedWith),
        sharedDomains: parseSharedEmails(artifact.sharedDomains),
        isPublic: artifact.isPublic === true
      }));
    }),

    artifactBySlug: query(async (ctx, slugInput: string) => {
      const slug = cleanSlug(slugInput);
      const artifact = await ctx.db.artifacts
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .first();
      if (!artifact) {
        return null;
      }

      const sharedWith = parseSharedEmails(artifact.sharedWith);
      const sharedDomains = parseSharedEmails(artifact.sharedDomains);
      const isPublic = artifact.isPublic === true;
      const identity = authenticatedIdentity(ctx);
      const configuredOwners = ownerEmails(ctx);
      const canManage = await hasOwnerAccess(ctx);
      const hasGrant = identity
        ? await validArtifactGrant(
            ctx,
            artifact.id,
            identity.userId,
            sharedWith,
            sharedDomains
          )
        : false;
      const canView =
        isPublic ||
        canManage ||
        hasGrant;
      if (!canView) {
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
        isPublic,
        canManage,
        ownerEmails: canManage ? configuredOwners : [],
        sharedWith: canManage ? sharedWith : [],
        sharedDomains: canManage ? sharedDomains : []
      };
    })
  },

  mutations: {
    claimOwnerAccess: mutation(async (ctx) => ({
      claimed: await claimConfiguredOwner(ctx)
    })),

    acceptArtifactAccess: mutation(async (ctx, slugInput: string) => {
      const identity = authenticatedIdentity(ctx);
      if (!identity) {
        return { accepted: false };
      }
      if (await claimConfiguredOwner(ctx)) {
        return { accepted: true };
      }

      const slug = cleanSlug(slugInput);
      const artifact = await ctx.db.artifacts
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .first();
      if (!artifact) {
        return { accepted: false };
      }
      if (artifact.isPublic === true) {
        return { accepted: true };
      }

      const sharedWith = parseSharedEmails(artifact.sharedWith);
      const sharedDomains = parseSharedEmails(artifact.sharedDomains);
      const domain = emailDomain(identity.email);
      const ruleType = sharedWith.includes(identity.email)
        ? "email"
        : sharedDomains.includes(domain)
          ? "domain"
          : null;
      const ruleValue = ruleType === "email" ? identity.email : domain;
      if (!ruleType) {
        return { accepted: false };
      }

      const grants = await ctx.db.artifactGrants
        .withIndex("by_artifact_user", (q) =>
          q.eq("artifactId", artifact.id).eq("userId", identity.userId)
        )
        .collect();
      if (!grants.some((grant) =>
        grant.ruleType === ruleType && grant.ruleValue === ruleValue
      )) {
        await ctx.db.artifactGrants.insert({
          artifactId: artifact.id,
          userId: identity.userId,
          ruleType,
          ruleValue
        });
      }
      return { accepted: true };
    }),

    publishArtifact: mutation(async (ctx, input: PublishInput) => {
      await requireOwner(ctx);
      return publishAsOwner(ctx, input, ctx.auth.userId);
    }),

    setArtifactAccess: mutation(async (
      ctx,
      artifactId: string,
      access: { emails: string[]; domains: string[]; isPublic: boolean }
    ) => {
      await requireOwner(ctx);
      const artifact = await ctx.db.artifacts.get(artifactId);
      if (!artifact) {
        throw new Error("Artifact not found.");
      }
      if (!Array.isArray(access.emails) || access.emails.length > MAX_SHARED_EMAILS) {
        throw new Error(`At most ${MAX_SHARED_EMAILS} people can be added.`);
      }
      if (!Array.isArray(access.domains) || access.domains.length > MAX_SHARED_DOMAINS) {
        throw new Error(`At most ${MAX_SHARED_DOMAINS} domains can be added.`);
      }

      const sharedWith = normalizeSharedEmails(access.emails, ownerEmails(ctx));
      const sharedDomains = normalizeSharedDomains(access.domains);
      await ctx.db.artifacts.update(artifact.id, {
        sharedWith: JSON.stringify(sharedWith),
        sharedDomains: JSON.stringify(sharedDomains),
        isPublic: access.isPublic === true
      });
      await pruneArtifactGrants(ctx, artifact.id, sharedWith, sharedDomains);
      return { emails: sharedWith, domains: sharedDomains, isPublic: access.isPublic === true };
    }),

    deleteArtifact: mutation(async (ctx, artifactId: string) => {
      await requireOwner(ctx);
      const artifact = await ctx.db.artifacts.get(artifactId);
      if (!artifact) {
        throw new Error("Artifact not found.");
      }

      const chunks = await ctx.db.artifactChunks
        .withIndex("by_artifact_part", (q) => q.eq("artifactId", artifact.id))
        .collect();
      for (const chunk of chunks) {
        await ctx.db.artifactChunks.delete(chunk.id);
      }
      const grants = await ctx.db.artifactGrants
        .withIndex("by_artifact", (q) => q.eq("artifactId", artifact.id))
        .collect();
      for (const grant of grants) {
        await ctx.db.artifactGrants.delete(grant.id);
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
          isPublic?: unknown;
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
            sharedWith,
            isPublic: typeof body.isPublic === "boolean"
              ? body.isPublic
              : existing?.isPublic === true
          },
          `automation:${primaryOwnerEmail(ctx)}`
        );
        return json(
          {
            ...result,
            updated: Boolean(existing),
            isPublic: typeof body.isPublic === "boolean"
              ? body.isPublic
              : existing?.isPublic === true
          },
          { status: existing ? 200 : 201 }
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to publish artifact.";
        return json({ error: message }, { status: 400 });
      }
    })
  }
});
