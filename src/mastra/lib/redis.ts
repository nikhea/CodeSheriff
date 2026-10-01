import IORedis from "ioredis";

let redis: IORedis | null = null;

function redisUrl(): string {
  return process.env.REDIS_URL ?? "redis://localhost:6379";
}

/** Shared Redis connection (BullMQ requires maxRetriesPerRequest: null). */
export function getRedisConnection(): IORedis {
  if (!redis) {
    redis = new IORedis(redisUrl(), { maxRetriesPerRequest: null });
    redis.on("error", (err) => console.error("[redis] error", err?.message ?? err));
  }
  return redis;
}
