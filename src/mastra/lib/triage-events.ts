import { getRedisConnection } from "./redis";

export type TriageEvent =
  | { type: "started"; issue: number; kind: "triage" | "followup" }
  | { type: "stage"; message: string }
  | { type: "tool"; name: string; status: "started" | "completed" }
  | { type: "text"; delta: string }
  | { type: "completed"; summary: string };

export const triageProgressKey = (owner: string, repo: string, issueNumber: number): string =>
  `triage-progress:${owner}/${repo}#${issueNumber}`;

const triageBufferKey = (owner: string, repo: string, issueNumber: number): string =>
  `${triageProgressKey(owner, repo, issueNumber)}:buffer`;

const MAX_BUFFER = 100;

/**
 * Publish a triage progress event. Best-effort by design: progress must
 * never break triage. Same pattern as review-events: Redis pub/sub across
 * the worker/dev-server process boundary + replayable buffer per issue.
 */
export async function publishTriageProgress(
  owner: string,
  repo: string,
  issueNumber: number,
  event: TriageEvent
): Promise<void> {
  try {
    const redis = getRedisConnection();
    const payload = JSON.stringify(event);
    const buf = triageBufferKey(owner, repo, issueNumber);
    await redis.publish(triageProgressKey(owner, repo, issueNumber), payload);
    await redis.rpush(buf, payload);
    await redis.ltrim(buf, -MAX_BUFFER, -1);
    await redis.expire(buf, 3600);
  } catch {
    /* progress is advisory only */
  }
}

/** Buffered events for late joiners (oldest first). */
export async function readTriageBuffer(
  owner: string,
  repo: string,
  issueNumber: number
): Promise<TriageEvent[]> {
  try {
    const items = await getRedisConnection().lrange(triageBufferKey(owner, repo, issueNumber), 0, -1);
    const out: TriageEvent[] = [];
    for (const item of items) {
      try {
        out.push(JSON.parse(item) as TriageEvent);
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
export function subscribeTriage(
  owner: string,
  repo: string,
  issueNumber: number,
  onEvent: (event: TriageEvent) => void
): () => void {
  const sub = getRedisConnection().duplicate();
  const key = triageProgressKey(owner, repo, issueNumber);
  sub.subscribe(key).catch(() => {});
  sub.on("message", (_channel: string, message: string) => {
    try {
      onEvent(JSON.parse(message) as TriageEvent);
    } catch {
      /* skip corrupt entries */
    }
  });
  return () => {
    sub.unsubscribe(key).catch(() => {});
    sub.disconnect();
  };
}
