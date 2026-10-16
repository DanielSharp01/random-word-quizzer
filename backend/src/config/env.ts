import "dotenv/config";
import { z } from "zod";
import { zodStringify } from "@danielsharp/zod";

export const env = zodStringify(
  z.object({
    GOOGLE_CLIENT_ID: z.string(),
    GOOGLE_CLIENT_SECRET: z.string(),
    PORT: z.number().default(4000),
    /** 0.0.0.0 inside a container, so the published port reaches the server. */
    HOST: z.string().default("localhost"),
    REDIS_URL: z.string(),
    DB_HOST: z.string(),
    DB_PORT: z.number().default(5432),
    DB_USER: z.string(),
    DB_PASSWORD: z.string(),
    DB_NAME: z.string(),
    /** The origin the browser sees, e.g. https://quizzer.example.com; sign-in redirects back to it. */
    API_HOST: z.url().transform((u) => u.replace(/\/+$/, "")),
    /** The public origin for invite links, for when the invite script runs where API_HOST is a dev address. */
    INVITE_ORIGIN: z
      .url()
      .transform((u) => u.replace(/\/+$/, ""))
      .optional(),
    /** The built frontend (frontend/dist); unset in development, where Vite serves it. */
    FRONTEND_DIR: z.string().optional(),
    /** Overrides the drizzle folder, which the bundled server can't find next to its source. */
    MIGRATIONS_DIR: z.string().optional(),
    MIGRATE_ON_START: z.boolean().default(false),
    /**
     * 32 random bytes, base64, sealing the shared ChatGPT tokens at rest; AI features are off
     * without it. Make one with: openssl rand -base64 32
     */
    AI_TOKEN_KEY: z
      .string()
      .transform((key) => Buffer.from(key, "base64"))
      .refine((key) => key.length === 32, "AI_TOKEN_KEY must be 32 bytes, base64-encoded")
      .optional(),
  }),
).parse(process.env);
