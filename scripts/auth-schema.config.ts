import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";

// Better Auth's schema generator needs a concrete SQLite connection. D1 uses
// the same generated schema, so an in-memory database keeps generation local.
export const auth = betterAuth({
  database: new DatabaseSync(":memory:"),
  socialProviders: {
    google: {
      clientId: "schema-generation-only",
      clientSecret: "schema-generation-only"
    }
  },
  advanced: {
    database: {
      generateId: "uuid"
    }
  }
});
