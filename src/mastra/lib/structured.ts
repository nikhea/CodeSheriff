import { z } from "zod";

/** Pull model prose out of Mastra structured-output errors (details.value holds it). */
function extractModelText(err: any): string | null {
  const candidates = [err?.details?.value, err?.details?.data, err?.cause?.details?.value];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c;
  }
  return null;
}

/** Try to find a ```json fenced block in prose and validate it against the schema. */
function salvageJson<T>(text: string, schema: z.ZodTypeAny): T | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fence?.[1], text].filter(Boolean) as string[];
  for (const raw of candidates) {
    try {
      const parsed = JSON.parse(raw.trim());
      const checked = (schema as z.ZodTypeAny).safeParse(parsed);
      if (checked.success) return checked.data as T;
    } catch {
      /* not JSON — try next */
    }
  }
  return null;
}
/**
 * Resilient structured generation.
 * `agent.generate(..., { structuredOutput })` THROWS when the model returns
 * prose instead of JSON — so `?? fallback` on `response.object` never runs.
 * This helper retries once with a strict JSON-only instruction, then tries to
 * salvage (fenced-JSON extract, or caller-provided prose mapper), and only
 * then degrades to `fallback` instead of failing the step.
 */
export async function generateStructured<T>(
  agent: { generate: (prompt: string, opts?: any) => Promise<{ object?: T }> },
  prompt: string,
  schema: z.ZodTypeAny,
  fallback: T,
  label: string,
  logger?: { warn?: (...a: any[]) => void },
  salvageProse?: (text: string) => T | null
): Promise<T> {
  const strict = `${prompt}\n\nReturn ONLY valid JSON matching the required schema. No markdown fences, no prose, no explanation.`;
  let lastErr: any = null;
  for (const attemptPrompt of [
    strict,
    `OUTPUT JSON ONLY. No markdown. No commentary.\n\n${prompt}`,
  ]) {
    try {
      const res = await agent.generate(attemptPrompt, { structuredOutput: { schema } });
      if (res.object !== undefined && res.object !== null) return res.object;
      lastErr = new Error("empty structured output");
    } catch (err: any) {
      lastErr = err;
      logger?.warn?.(`[structured] ${label} attempt failed, ${attemptPrompt === strict ? "retrying" : "salvaging"}: ${err?.message ?? err}`);
    }
  }
  // Last resort: the model's prose may contain fenced JSON or usable text.
  const prose = extractModelText(lastErr);
  if (prose) {
    const json = salvageJson<T>(prose, schema);
    if (json !== null) {
      logger?.warn?.(`[structured] ${label} salvaged fenced JSON from prose`);
      return json;
    }
    if (salvageProse) {
      const mapped = salvageProse(prose);
      if (mapped !== null) {
        logger?.warn?.(`[structured] ${label} salvaged prose as fallback content`);
        return mapped;
      }
    }
  }
  return fallback;
}
