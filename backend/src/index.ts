import { createApp, onError } from "./app";
import { env } from "./config/env";
import { runMigrations } from "./db/migrate";
import { initializeRedis } from "./providers/redis";

const app = createApp();

await initializeRedis();
if (env.MIGRATE_ON_START) await runMigrations();

const server = await app.mount({
  onError,
  port: env.PORT,
  hostname: env.HOST,
});

console.info(`Server running at http://${env.HOST}:${env.PORT}/api`);
console.info(`Docs at http://${env.HOST}:${env.PORT}/api/docs`);

for (const event of ["SIGTERM", "SIGINT"] as const) {
  process.on(event, async () => {
    server.close();
    process.exit(0);
  });
}
