// Initialize / bootstrap the database. The schema is self-bootstrapping in
// client.ts, so importing it creates tables and seeds defaults. Useful as a
// standalone `npm run db:migrate` to provision the DB ahead of first start.
import { DB_PATH } from "./../paths";

async function main() {
  await import("./client");
  console.log(`[mcp-manage] database ready at ${DB_PATH}`);
}

main().catch((err) => {
  console.error("[mcp-manage] db init failed:", err);
  process.exit(1);
});
