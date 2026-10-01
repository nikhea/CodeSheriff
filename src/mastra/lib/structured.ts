import { z } from "zod";

/**
 * Resilient structured generation.
 * `agent.generate(..., { structuredOutput })` THROWS when the model returns
 * prose instead of JSON (common with weaker fallback models) — so `?? fallback`
 * on `response.object` never runs. This helper retries once with a strict
 * JSON-only instruction, then degrades to `fallback` instead of failing the step.
 */
export async function generateStructured<T>(
  agent: { generate: (prompt: string, opts?: any) => Promise<{ object?: T }> },
  prompt: string,
  schema: z.ZodTypeAny,
  fallback: T,
  label: string,
  logger?: { warn?: (...a: any[]) => void }
): Promise<T> {
  const strict = `${prompt}\n\nReturn ONLY valid JSON matching the required schema. No markdown fences, no prose, no explanation.`;
  try {
    const res = await agent.generate(strict, { structuredOutput: { schema } });
    if (res.object !== undefined && res.object !== null) return res.object;
    throw new Error("empty structured output");
  } catch (firstErr: any) {
    logger?.warn?.(`[structured] ${label} first attempt failed, retrying: ${firstErr?.message ?? firstErr}`);
    try {
      const res = await agent.generate(
        `OUTPUT JSON ONLY. No markdown. No commentary.\n\n${prompt}`,
        { structuredOutput: { schema } }
      );
      if (res.object !== undefined && res.object !== null) return res.object;
    } catch (secondErr: any) {
      logger?.warn?.(`[structured] ${label} retry failed, using fallback: ${secondErr?.message ?? secondErr}`);
    }
    return fallback;
  }
}
