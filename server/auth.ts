import { betterAuth } from "better-auth";
import type { Fetcher } from "@cloudflare/workers-types";

export type Bindings = {
  ASSETS: Fetcher;
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  OWNER_EMAILS: string;
  WORKSPACE_VIEWER_EMAILS?: string;
  PUBLISH_TOKEN?: string;
};

export type Identity = {
  userId: string;
  email: string;
};

export function createAuth(env: Bindings) {
  return betterAuth({
    appName: "Codex Artifacts",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET
      }
    },
    advanced: {
      database: {
        generateId: "uuid"
      }
    }
  });
}

export async function authenticatedIdentity(
  request: Request,
  env: Bindings
): Promise<Identity | null> {
  const session = await createAuth(env).api.getSession({
    headers: request.headers
  });
  if (!session?.user.email || session.user.emailVerified !== true) {
    return null;
  }
  return {
    userId: session.user.id,
    email: session.user.email.trim().toLowerCase()
  };
}
