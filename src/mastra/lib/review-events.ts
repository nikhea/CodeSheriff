import { getRedisConnection } from "./redis";

export type ReviewEvent =
  | { type: "started"; pr: number }
  | { type: "file"; path: string }
  | { type: "analysis"; message: string }
  | { type: "finding"; severity: "info" | "warning" | "error"; message: string }
  | { type: "tool"; name: string; status: "started" | "completed" }
  | { type: "completed"; summary: string };

export const progressKey = (owner: string, repo: string, pullNumber: number): string =>
  `review-progress:${owner}/${repo}#${pullNumber}`;

const bufferKey = (owner: string, repo: string, pullNumber: number): string =>
  `${progressKey(owner, repo, pullNumber)}:buffer`;

const MAX_BUFFER = 100;

/**
 * Publish a progress event. Best-effort by design: progress must never break
 * reviews. Fans out over Redis pub/sub (worker and dev-server are separate
 * processes) and keeps a replayable buffer per PR.
 */
export async function publishProgress(
  owner: string,
  repo: string,
  pullNumber: number,
  event: ReviewEvent
): Promise<void> {
  try {
    const redis = getRedisConnection();
    const payload = JSON.stringify(event);
    const buf = bufferKey(owner, repo, pullNumber);
    await redis.publish(progressKey(owner, repo, pullNumber), payload);
    await redis.rpush(buf, payload);
    await redis.ltrim(buf, -MAX_BUFFER, -1);
    await redis.expire(buf, 3600);
  } catch {
    /* progress is advisory only */
  }
}

/** Buffered events for late joiners (oldest first). */
export async function readProgressBuffer(
  owner: string,
  repo: string,
  pullNumber: number
): Promise<ReviewEvent[]> {
  try {
    const items = await getRedisConnection().lrange(bufferKey(owner, repo, pullNumber), 0, -1);
    const out: ReviewEvent[] = [];
    for (const item of items) {
      try {
        out.push(JSON.parse(item) as ReviewEvent);
      } catch {
        /* skip corrupt entries */
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Live subscription. Returns an unsubscribe function (also disconnects). */
export function subscribeProgress(
  owner: string,
  repo: string,
  pullNumber: number,
  onEvent: (event: ReviewEvent) => void
): () => void {
  const sub = getRedisConnection().duplicate();
  const key = progressKey(owner, repo, pullNumber);
  sub.subscribe(key).catch(() => {});
  sub.on("message", (_channel: string, message: string) => {
    try {
      onEvent(JSON.parse(message) as ReviewEvent);
    } catch {
      /* skip corrupt entries */
    }
  });
  return () => {
    sub.unsubscribe(key).catch(() => {});
    sub.disconnect();
  };
}

/**
 * Dual emit for workflow steps. `writer` is Mastra's native step stream —
 * objects written here surface as `workflow-step-output` chunks in
 * `run.stream()`/Studio/`POST /api/workflows/:id/stream`, and is undefined
 * under `run.start()` (safe to ignore). Redis covers the cross-process path
 * (worker owns the run; dev-server serves browsers).
 */
export async function emitProgress(
  writer: { write: (chunk: unknown) => unknown | Promise<unknown> } | undefined,
  owner: string,
  repo: string,
  pullNumber: number,
  event: ReviewEvent
): Promise<void> {
  if (writer) {
    try {
      await writer.write(event);
    } catch {
      /* native stream is advisory only */
    }
  }
  await publishProgress(owner, repo, pullNumber, event);
}
