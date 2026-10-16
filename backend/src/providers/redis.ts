import { createClient } from "redis";
import { createRedisConnection } from "@danielsharp/redis";
import { logger } from "./logger";
import { env } from "../config/env";

const redisClient = createClient({
  url: env.REDIS_URL,
});

export const redis = createRedisConnection(redisClient, {
  onError: (err) => {
    logger.error("Redis error:", err);
  },
});

export async function initializeRedis() {
  await redisClient.connect();
}

export async function closeRedis() {
  await redisClient.close();
}
