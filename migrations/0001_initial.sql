create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);

create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

create table "account" ("id" text not null primary key, "issuer" text not null, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create index "session_userId_idx" on "session" ("userId");

create index "account_userId_idx" on "account" ("userId");

create index "verification_identifier_idx" on "verification" ("identifier");

create unique index "account_issuer_accountId_uidx" on "account" ("issuer", "accountId");

create table "artifacts" (
  "id" text not null primary key,
  "slug" text not null unique,
  "title" text not null,
  "ownerId" text not null,
  "ownerEmail" text not null,
  "sharedWith" text not null default '[]',
  "sharedDomains" text not null default '[]',
  "isPublic" integer not null default 0,
  "expiresAt" text,
  "sizeBytes" integer not null,
  "html" text not null,
  "createdAt" text not null,
  "updatedAt" text not null
);

create index "artifacts_createdAt_idx" on "artifacts" ("createdAt" desc);

create table "ownerBindings" (
  "userId" text not null primary key references "user" ("id") on delete cascade,
  "invitedEmail" text not null unique
);

create table "workspaceViewerBindings" (
  "userId" text not null primary key references "user" ("id") on delete cascade,
  "invitedEmail" text not null unique
);

create table "artifactGrants" (
  "id" text not null primary key,
  "artifactId" text not null references "artifacts" ("id") on delete cascade,
  "userId" text not null references "user" ("id") on delete cascade,
  "ruleType" text not null check ("ruleType" in ('email', 'domain')),
  "ruleValue" text not null,
  unique ("artifactId", "userId")
);

create index "artifactGrants_artifactId_idx" on "artifactGrants" ("artifactId");
