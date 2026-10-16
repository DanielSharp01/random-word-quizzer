/**
 * `pnpm db:migrate`. Kept apart from migrate.ts: once the server is bundled, a "run as a script"
 * check in a module it imports matches the bundle itself, and ends the pool the server is using.
 */
import { pool } from "../providers/db";
import { runMigrations } from "./migrate";

await runMigrations();
await pool.end();
