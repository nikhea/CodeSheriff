import { registerApiRoute } from "@mastra/core/server";
import {
  readTriageBuffer,
  subscribeTriage,
  type TriageEvent,
} from "../lib/triage-events";

/**
 * Live triage progress as Server-Sent Events.
 * GET /triage/progress/:owner/:repo/:issueNumber[?replay=0]
 *
 * Replays buffered events (unless replay=0), then tails the Redis channel
 * the worker publishes to. Carries stage/tool events plus live text deltas.
 */
export const triageProgressRoute = registerApiRoute("/triage/progress/:owner/:repo/:issueNumber", {
  method: "GET",
  requiresAuth: false,
  handler: async (c) => {
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    const issueNumber = Number(c.req.param("issueNumber"));
    if (!owner || !repo || !Number.isFinite(issueNumber)) {
      return c.json({ error: "expected /triage/progress/:owner/:repo/:issueNumber" }, 400);
    }

    const history =
      c.req.query("replay") === "0" ? [] : await readTriageBuffer(owner, repo, issueNumber);

    let unsubscribe: () => void = () => {};
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        const send = (e: TriageEvent) => {
          try {
            controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
          } catch {
            /* client gone */
          }
        };
        for (const e of history) send(e);
        unsubscribe = subscribeTriage(owner, repo, issueNumber, send);
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
