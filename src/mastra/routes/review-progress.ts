import { registerApiRoute } from "@mastra/core/server";
import {
  readProgressBuffer,
  subscribeProgress,
  type ReviewEvent,
} from "../lib/review-events";

/**
 * Live review progress as Server-Sent Events.
 * GET /reviews/progress/:owner/:repo/:pullNumber[?replay=0]
 *
 * Replays buffered events (unless replay=0), then tails the Redis channel the
 * worker publishes to. Event shape matches ReviewEvent.
 */
export const reviewProgressRoute = registerApiRoute("/reviews/progress/:owner/:repo/:pullNumber", {
  method: "GET",
  requiresAuth: false,
  handler: async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const pullNumber = Number(c.req.param("pullNumber"));
    if (!owner || !repo || !Number.isFinite(pullNumber)) {
      return c.json({ error: "expected /reviews/progress/:owner/:repo/:pullNumber" }, 400);
    }

    const history =
      c.req.query("replay") === "0" ? [] : await readProgressBuffer(owner, repo, pullNumber);

    let unsubscribe: () => void = () => {};
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        const send = (e: ReviewEvent) => {
          try {
            controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
          } catch {
            /* client gone */
          }
        };
        for (const e of history) send(e);
        unsubscribe = subscribeProgress(owner, repo, pullNumber, send);
      },
      cancel() {
        unsubscribe();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  },
});
