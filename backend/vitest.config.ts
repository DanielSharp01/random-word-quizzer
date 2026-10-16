import "dotenv/config";
import { defineConfig } from "vitest/config";

/**
 * Tests run against a throwaway database, recreated on every run. Each TEST_DB_* overrides its
 * DB_* counterpart, so the tests can use a local server while development points elsewhere.
 */
function testDatabase() {
  const pick = (key: string, fallback?: string) => process.env[`TEST_DB_${key}`] ?? process.env[`DB_${key}`] ?? fallback;
  return {
    DB_HOST: pick("HOST")!,
    DB_PORT: pick("PORT", "5432")!,
    DB_USER: pick("USER")!,
    DB_PASSWORD: pick("PASSWORD")!,
    DB_NAME: process.env.TEST_DB_NAME ?? "quizzer_test",
  };
}

export default defineConfig({
  test: {
    projects: [
      // Pure logic, so it runs without the database or Redis.
      { test: { name: "unit", include: ["test/unit/**/*.test.ts"] } },
      {
        test: {
          name: "e2e",
          include: ["test/e2e/**/*.test.ts"],
          globalSetup: ["./test/support/globalSetup.ts"],
          env: {
            ...testDatabase(),
            API_HOST: "http://localhost:5173",
            REDIS_URL: process.env.TEST_REDIS_URL ?? `${process.env.REDIS_URL ?? "redis://localhost:6379"}/15`,
          },
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
