import {
  MAX_ARTIFACT_BYTES,
  MAX_SHARED_DOMAINS,
  MAX_SHARED_EMAILS,
  MAX_TOTAL_ARTIFACT_BYTES,
  cleanSlug,
  cleanTitle,
  emailDomain,
  expirationTimestamp,
  isArtifactExpired,
  isValidEmail,
  normalizeEmail,
  normalizeSharedDomains,
  normalizeSharedEmails,
  parseSharedEmails,
  utf8Bytes
} from "../shared/config";
import type {
  ArtifactAccess,
  ArtifactAccessResult,
  OwnedArtifact,
  PublishInput,
  PublishResult,
  ViewedArtifact,
  Viewer
} from "../shared/api";
import { parseWorkspaceViewerEmails } from "../shared/workspace-viewers.mjs";
import type { Bindings, Identity } from "./auth";

type ArtifactRow = {
  id: string;
  slug: string;
  title: string;
  ownerId: string;
  ownerEmail: string;
  sharedWith: string;
  sharedDomains: string;
  isPublic: number;
  expiresAt: string | null;
  sizeBytes: number;
  html: string;
  createdAt: string;
  updatedAt: string;
};

type ArtifactMetadataRow = Omit<ArtifactRow, "html">;

type BindingTable = "ownerBindings" | "workspaceViewerBindings";

export class AppError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 503 = 400
  ) {
    super(message);
  }
}

export function ownerEmails(env: Bindings): string[] {
  const configured = (env.OWNER_EMAILS ?? "")
    .split(",")
    .map(normalizeEmail)
    .filter(isValidEmail);
  const emails = [...new Set(configured)];
  if (!emails.length) {
    throw new AppError(
      "OWNER_EMAILS must contain at least one valid email address.",
      503
    );
  }
  return emails;
}

export function workspaceViewerEmails(
  env: Bindings,
  configuredOwners = ownerEmails(env)
): string[] {
  return parseWorkspaceViewerEmails(
    env.WORKSPACE_VIEWER_EMAILS,
    configuredOwners,
    MAX_SHARED_EMAILS
  );
}

async function bindingEmail(
  db: D1Database,
  table: BindingTable,
  userId: string
): Promise<string | null> {
  const row = await db
    .prepare(`select "invitedEmail" from "${table}" where "userId" = ?`)
    .bind(userId)
    .first<{ invitedEmail: string }>();
  return row?.invitedEmail ?? null;
}

async function hasBoundAccess(
  db: D1Database,
  table: BindingTable,
  identity: Identity | null,
  configuredEmails: string[]
): Promise<boolean> {
  if (!identity) return false;
  const invitedEmail = await bindingEmail(db, table, identity.userId);
  return Boolean(invitedEmail && configuredEmails.includes(invitedEmail));
}

export async function hasOwnerAccess(
  env: Bindings,
  identity: Identity | null
): Promise<boolean> {
  return hasBoundAccess(env.DB, "ownerBindings", identity, ownerEmails(env));
}

export async function hasWorkspaceViewerAccess(
  env: Bindings,
  identity: Identity | null
): Promise<boolean> {
  return hasBoundAccess(
    env.DB,
    "workspaceViewerBindings",
    identity,
    workspaceViewerEmails(env)
  );
}

async function requireOwner(
  env: Bindings,
  identity: Identity | null
): Promise<Identity> {
  if (!identity || !(await hasOwnerAccess(env, identity))) {
    throw new AppError("Only the artifact owner can perform this action.", 403);
  }
  return identity;
}

async function claimBinding(
  db: D1Database,
  table: BindingTable,
  identity: Identity | null,
  configuredEmails: string[]
): Promise<boolean> {
  if (!identity || !configuredEmails.includes(identity.email)) {
    return false;
  }

  const existingForUser = await db
    .prepare(`select "invitedEmail" from "${table}" where "userId" = ?`)
    .bind(identity.userId)
    .first<{ invitedEmail: string }>();
  if (existingForUser?.invitedEmail === identity.email) {
    return true;
  }

  const existingForInvitation = await db
    .prepare(`select "userId" from "${table}" where "invitedEmail" = ?`)
    .bind(identity.email)
    .first<{ userId: string }>();
  if (existingForInvitation && existingForInvitation.userId !== identity.userId) {
    throw new AppError(
      `This ${table === "ownerBindings" ? "owner" : "workspace viewer"} invitation has already been accepted by another identity.`,
      409
    );
  }

  if (existingForUser) {
    await db
      .prepare(`update "${table}" set "invitedEmail" = ? where "userId" = ?`)
      .bind(identity.email, identity.userId)
      .run();
  } else {
    await db
      .prepare(`insert into "${table}" ("userId", "invitedEmail") values (?, ?)`)
      .bind(identity.userId, identity.email)
      .run();
  }
  return true;
}

export async function claimOwnerAccess(
  env: Bindings,
  identity: Identity | null
): Promise<boolean> {
  return claimBinding(env.DB, "ownerBindings", identity, ownerEmails(env));
}

export async function claimWorkspaceViewerAccess(
  env: Bindings,
  identity: Identity | null
): Promise<boolean> {
  return claimBinding(
    env.DB,
    "workspaceViewerBindings",
    identity,
    workspaceViewerEmails(env)
  );
}

async function validArtifactGrant(
  db: D1Database,
  artifactId: string,
  userId: string,
  sharedWith: string[],
  sharedDomains: string[]
): Promise<boolean> {
  const grant = await db
    .prepare(
      'select "ruleType", "ruleValue" from "artifactGrants" where "artifactId" = ? and "userId" = ?'
    )
    .bind(artifactId, userId)
    .first<{ ruleType: string; ruleValue: string }>();
  if (!grant) return false;
  return grant.ruleType === "email"
    ? sharedWith.includes(grant.ruleValue)
    : grant.ruleType === "domain" && sharedDomains.includes(grant.ruleValue);
}

async function pruneArtifactGrants(
  db: D1Database,
  artifactId: string,
  sharedWith: string[],
  sharedDomains: string[]
): Promise<void> {
  const grants = await db
    .prepare(
      'select "id", "ruleType", "ruleValue" from "artifactGrants" where "artifactId" = ?'
    )
    .bind(artifactId)
    .all<{ id: string; ruleType: string; ruleValue: string }>();
  const stale = grants.results.filter((grant) =>
    grant.ruleType === "email"
      ? !sharedWith.includes(grant.ruleValue)
      : !sharedDomains.includes(grant.ruleValue)
  );
  if (stale.length) {
    await db.batch(
      stale.map((grant) =>
        db.prepare('delete from "artifactGrants" where "id" = ?').bind(grant.id)
      )
    );
  }
}

function validatePublishInput(
  input: PublishInput,
  configuredOwners: string[]
): {
  title: string;
  slug: string;
  html: string;
  sizeBytes: number;
  sharedWith: string[];
  sharedDomains: string[];
  expiresAt: string | null;
} {
  const title = cleanTitle(input.title);
  const slug = cleanSlug(input.slug);
  const sizeBytes = utf8Bytes(input.html);
  const sharedWith = normalizeSharedEmails(input.sharedWith ?? [], configuredOwners);
  const sharedDomains = normalizeSharedDomains(input.sharedDomains ?? []);
  const expiresAt = expirationTimestamp(input.expiresInSeconds) || null;

  if (!title) throw new AppError("Title is required.");
  if (!slug) throw new AppError("A valid slug is required.");
  if (!input.html) throw new AppError("Artifact HTML cannot be empty.");
  if (sizeBytes > MAX_ARTIFACT_BYTES) {
    throw new AppError("Artifact exceeds the 512 KiB limit.");
  }
  if ((input.sharedWith?.length ?? 0) > MAX_SHARED_EMAILS) {
    throw new AppError(`At most ${MAX_SHARED_EMAILS} people can be added.`);
  }
  if ((input.sharedDomains?.length ?? 0) > MAX_SHARED_DOMAINS) {
    throw new AppError(`At most ${MAX_SHARED_DOMAINS} domains can be added.`);
  }
  return {
    title,
    slug,
    html: input.html,
    sizeBytes,
    sharedWith,
    sharedDomains,
    expiresAt
  };
}

async function requireArtifactCapacity(
  db: D1Database,
  nextSizeBytes: number,
  replacedArtifactId?: string
): Promise<void> {
  const statement = replacedArtifactId
    ? db
        .prepare(
          'select coalesce(sum("sizeBytes"), 0) as "total" from "artifacts" where "id" != ?'
        )
        .bind(replacedArtifactId)
    : db.prepare(
        'select coalesce(sum("sizeBytes"), 0) as "total" from "artifacts"'
      );
  const stored = await statement.first<{ total: number }>();
  if (Number(stored?.total ?? 0) + nextSizeBytes > MAX_TOTAL_ARTIFACT_BYTES) {
    throw new AppError(
      "Publishing this artifact would exceed the 400 MiB workspace HTML budget. Delete an older artifact or publish a smaller file."
    );
  }
}

async function artifactById(
  db: D1Database,
  artifactId: string
): Promise<ArtifactRow | null> {
  return db
    .prepare('select * from "artifacts" where "id" = ?')
    .bind(artifactId)
    .first<ArtifactRow>();
}

async function artifactBySlugRow(
  db: D1Database,
  slug: string
): Promise<ArtifactRow | null> {
  return db
    .prepare('select * from "artifacts" where "slug" = ?')
    .bind(slug)
    .first<ArtifactRow>();
}

export async function viewer(
  env: Bindings,
  identity: Identity | null
): Promise<Viewer> {
  const configuredOwners = ownerEmails(env);
  const configuredViewers = workspaceViewerEmails(env, configuredOwners);
  return {
    isOwner: await hasOwnerAccess(env, identity),
    isWorkspaceViewer: await hasWorkspaceViewerAccess(env, identity),
    canClaimOwner: Boolean(identity && configuredOwners.includes(identity.email)),
    canClaimWorkspaceViewer: Boolean(
      identity && configuredViewers.includes(identity.email)
    )
  };
}

export async function ownedArtifacts(
  env: Bindings,
  identity: Identity | null
): Promise<OwnedArtifact[]> {
  if (!(await hasOwnerAccess(env, identity))) return [];
  const artifacts = await env.DB
    .prepare(
      `select
        "id", "slug", "title", "ownerId", "ownerEmail", "sharedWith",
        "sharedDomains", "isPublic", "expiresAt", "sizeBytes", "createdAt",
        "updatedAt"
       from "artifacts"
       where "expiresAt" is null or "expiresAt" > ?
       order by "createdAt" desc`
    )
    .bind(new Date().toISOString())
    .all<ArtifactMetadataRow>();
  const workspaceViewerCount = workspaceViewerEmails(env).length;
  return artifacts.results.map((artifact) => ({
    ...artifact,
    expiresAt: artifact.expiresAt || null,
    sharedWith: parseSharedEmails(artifact.sharedWith),
    sharedDomains: parseSharedEmails(artifact.sharedDomains),
    isPublic: artifact.isPublic === 1,
    workspaceViewerCount
  }));
}

export async function artifactBySlug(
  env: Bindings,
  identity: Identity | null,
  slugInput: string
): Promise<ViewedArtifact | null> {
  const artifact = await artifactBySlugRow(env.DB, cleanSlug(slugInput));
  if (!artifact || isArtifactExpired(artifact.expiresAt ?? "")) return null;

  const sharedWith = parseSharedEmails(artifact.sharedWith);
  const sharedDomains = parseSharedEmails(artifact.sharedDomains);
  const isPublic = artifact.isPublic === 1;
  const configuredOwners = ownerEmails(env);
  const configuredViewers = workspaceViewerEmails(env, configuredOwners);
  const canManage = await hasOwnerAccess(env, identity);
  const hasWorkspaceAccess = await hasWorkspaceViewerAccess(env, identity);
  const hasGrant = identity
    ? await validArtifactGrant(
        env.DB,
        artifact.id,
        identity.userId,
        sharedWith,
        sharedDomains
      )
    : false;
  if (!isPublic && !canManage && !hasWorkspaceAccess && !hasGrant) return null;

  return {
    id: artifact.id,
    slug: artifact.slug,
    title: artifact.title,
    html: artifact.html,
    sizeBytes: artifact.sizeBytes,
    updatedAt: artifact.updatedAt,
    expiresAt: artifact.expiresAt || null,
    isPublic,
    canManage,
    ownerEmails: canManage ? configuredOwners : [],
    workspaceViewerEmails: canManage ? configuredViewers : [],
    sharedWith: canManage ? sharedWith : [],
    sharedDomains: canManage ? sharedDomains : []
  };
}

export async function acceptArtifactAccess(
  env: Bindings,
  identity: Identity | null,
  slugInput: string
): Promise<ArtifactAccessResult> {
  const artifact = await artifactBySlugRow(env.DB, cleanSlug(slugInput));
  if (!artifact || !identity) return { status: "unavailable" };

  const sharedWith = parseSharedEmails(artifact.sharedWith);
  const sharedDomains = parseSharedEmails(artifact.sharedDomains);
  const domain = emailDomain(identity.email);
  const ruleType = sharedWith.includes(identity.email)
    ? "email"
    : sharedDomains.includes(domain)
      ? "domain"
      : null;
  const ruleValue = ruleType === "email" ? identity.email : domain;
  const isOwner = await claimOwnerAccess(env, identity);
  const isWorkspaceViewer = isOwner
    ? false
    : await claimWorkspaceViewerAccess(env, identity);
  const hasGrant = await validArtifactGrant(
    env.DB,
    artifact.id,
    identity.userId,
    sharedWith,
    sharedDomains
  );
  if (
    artifact.isPublic !== 1 &&
    !isOwner &&
    !isWorkspaceViewer &&
    !hasGrant &&
    !ruleType
  ) {
    return { status: "unavailable" };
  }
  if (isArtifactExpired(artifact.expiresAt ?? "")) {
    return { status: "expired", expiredAt: artifact.expiresAt! };
  }

  if (!isOwner && !isWorkspaceViewer && !hasGrant && ruleType) {
    await env.DB
      .prepare(
        `insert into "artifactGrants" ("id", "artifactId", "userId", "ruleType", "ruleValue")
         values (?, ?, ?, ?, ?)
         on conflict ("artifactId", "userId") do update set
           "ruleType" = excluded."ruleType",
           "ruleValue" = excluded."ruleValue"`
      )
      .bind(crypto.randomUUID(), artifact.id, identity.userId, ruleType, ruleValue)
      .run();
  }
  return { status: "accepted" };
}

export async function publishArtifact(
  env: Bindings,
  input: PublishInput,
  ownerId: string
): Promise<PublishResult> {
  await removeExpiredArtifacts(env.DB);
  const configuredOwners = ownerEmails(env);
  const configuredViewers = workspaceViewerEmails(env, configuredOwners);
  const implicitAccessEmails = [...configuredOwners, ...configuredViewers];
  const artifact = input.artifactId
    ? await artifactById(env.DB, input.artifactId)
    : null;
  if (input.artifactId && !artifact) {
    throw new AppError("Artifact not found.", 404);
  }

  const requestedSharedWith = artifact
    ? input.sharedWith ?? parseSharedEmails(artifact.sharedWith)
    : input.sharedWith ?? [];
  const requestedSharedDomains = artifact
    ? input.sharedDomains ?? parseSharedEmails(artifact.sharedDomains)
    : input.sharedDomains ?? [];
  const validated = validatePublishInput(
    {
      ...input,
      sharedWith: requestedSharedWith,
      sharedDomains: requestedSharedDomains
    },
    implicitAccessEmails
  );
  const slugMatch = await artifactBySlugRow(env.DB, validated.slug);
  if (slugMatch && slugMatch.id !== artifact?.id) {
    throw new AppError("That slug is already in use.", 409);
  }

  if (artifact) {
    await requireArtifactCapacity(env.DB, validated.sizeBytes, artifact.id);
    const isPublic = input.isPublic ?? artifact.isPublic === 1;
    const now = new Date().toISOString();
    await env.DB
      .prepare(
        `update "artifacts" set
          "title" = ?, "slug" = ?, "sharedWith" = ?, "sharedDomains" = ?,
          "isPublic" = ?, "expiresAt" = ?, "sizeBytes" = ?, "html" = ?,
          "updatedAt" = ?
         where "id" = ?`
      )
      .bind(
        validated.title,
        validated.slug,
        JSON.stringify(validated.sharedWith),
        JSON.stringify(validated.sharedDomains),
        isPublic ? 1 : 0,
        validated.expiresAt,
        validated.sizeBytes,
        validated.html,
        now,
        artifact.id
      )
      .run();
    await pruneArtifactGrants(
      env.DB,
      artifact.id,
      validated.sharedWith,
      validated.sharedDomains
    );
    return {
      id: artifact.id,
      slug: validated.slug,
      expiresAt: validated.expiresAt,
      isPublic
    };
  }

  await requireArtifactCapacity(env.DB, validated.sizeBytes);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const isPublic = input.isPublic === true;
  await env.DB
    .prepare(
      `insert into "artifacts" (
        "id", "slug", "title", "ownerId", "ownerEmail", "sharedWith",
        "sharedDomains", "isPublic", "expiresAt", "sizeBytes", "html",
        "createdAt", "updatedAt"
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      validated.slug,
      validated.title,
      ownerId,
      configuredOwners[0],
      JSON.stringify(validated.sharedWith),
      JSON.stringify(validated.sharedDomains),
      isPublic ? 1 : 0,
      validated.expiresAt,
      validated.sizeBytes,
      validated.html,
      now,
      now
    )
    .run();
  return { id, slug: validated.slug, expiresAt: validated.expiresAt, isPublic };
}

export async function publishAsSignedInOwner(
  env: Bindings,
  identity: Identity | null,
  input: PublishInput
): Promise<PublishResult> {
  const owner = await requireOwner(env, identity);
  return publishArtifact(env, input, owner.userId);
}

export async function setArtifactExpiration(
  env: Bindings,
  identity: Identity | null,
  artifactId: string,
  expiresInSeconds: number | null
): Promise<{ expiresAt: string | null }> {
  await requireOwner(env, identity);
  const artifact = await artifactById(env.DB, artifactId);
  if (!artifact || isArtifactExpired(artifact.expiresAt ?? "")) {
    throw new AppError("Artifact not found.", 404);
  }
  const expiresAt = expirationTimestamp(expiresInSeconds) || null;
  await env.DB
    .prepare('update "artifacts" set "expiresAt" = ?, "updatedAt" = ? where "id" = ?')
    .bind(expiresAt, new Date().toISOString(), artifactId)
    .run();
  return { expiresAt };
}

export async function setArtifactAccess(
  env: Bindings,
  identity: Identity | null,
  artifactId: string,
  access: ArtifactAccess
): Promise<ArtifactAccess> {
  await requireOwner(env, identity);
  const artifact = await artifactById(env.DB, artifactId);
  if (!artifact) throw new AppError("Artifact not found.", 404);
  if (!Array.isArray(access.emails) || access.emails.length > MAX_SHARED_EMAILS) {
    throw new AppError(`At most ${MAX_SHARED_EMAILS} people can be added.`);
  }
  if (!Array.isArray(access.domains) || access.domains.length > MAX_SHARED_DOMAINS) {
    throw new AppError(`At most ${MAX_SHARED_DOMAINS} domains can be added.`);
  }

  const configuredOwners = ownerEmails(env);
  const implicitAccessEmails = [
    ...configuredOwners,
    ...workspaceViewerEmails(env, configuredOwners)
  ];
  const sharedWith = normalizeSharedEmails(access.emails, implicitAccessEmails);
  const sharedDomains = normalizeSharedDomains(access.domains);
  const isPublic = access.isPublic === true;
  await env.DB
    .prepare(
      `update "artifacts" set
        "sharedWith" = ?, "sharedDomains" = ?, "isPublic" = ?, "updatedAt" = ?
       where "id" = ?`
    )
    .bind(
      JSON.stringify(sharedWith),
      JSON.stringify(sharedDomains),
      isPublic ? 1 : 0,
      new Date().toISOString(),
      artifactId
    )
    .run();
  await pruneArtifactGrants(env.DB, artifactId, sharedWith, sharedDomains);
  return { emails: sharedWith, domains: sharedDomains, isPublic };
}

export async function deleteArtifact(
  env: Bindings,
  identity: Identity | null,
  artifactId: string
): Promise<void> {
  await requireOwner(env, identity);
  const result = await env.DB
    .prepare('delete from "artifacts" where "id" = ?')
    .bind(artifactId)
    .run();
  if (!result.meta.changes) throw new AppError("Artifact not found.", 404);
}

export async function removeExpiredArtifacts(db: D1Database): Promise<number> {
  const result = await db
    .prepare(
      'delete from "artifacts" where "expiresAt" is not null and "expiresAt" <= ?'
    )
    .bind(new Date().toISOString())
    .run();
  return result.meta.changes ?? 0;
}
