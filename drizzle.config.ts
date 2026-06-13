import { defineConfig } from "drizzle-kit";
import { DB_PATH } from "./lib/paths";

// The runtime self-bootstraps its schema (see lib/db/client.ts); this config is
// only for `drizzle-kit` introspection / generating SQL during development.
export default defineConfig({
  dialect: "sqlite",
  schema: "./lib/db/schema.ts",
  out: "./db/migrations",
  dbCredentials: { url: DB_PATH },
});
