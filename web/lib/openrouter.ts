// Shared OpenRouter model-catalogue access: fetching the model list (cached),
// looking up a model's per-token pricing, and the token approximation used for
// cost estimates. Used by /api/models (the grader-model picker) and
// /api/evals/estimate (the pre-run cost estimate) so both agree on pricing.

const OPENROUTER_MODELS = "https://openrouter.ai/api/v1/models";

// The catalogue is ~370 models and changes rarely; refetching per keystroke or
// per estimate would be wasteful and rate-limited.
let cache: { at: number; data: any[] } | null = null;
const TTL_MS = 10 * 60 * 1000;

export async function fetchModels(): Promise<any[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  const res = await fetch(OPENROUTER_MODELS, {
    headers: { "user-agent": "qa-eval/1.0" },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`OpenRouter models ${res.status}`);
  const data = (await res.json())?.data ?? [];
  cache = { at: Date.now(), data };
  return data;
}

export interface ModelPricing {
  prompt: number;
  completion: number;
}

/** Per-token USD pricing for a model id, or null if it isn't in the catalogue. */
export function pricingFor(models: any[], id: string): ModelPricing | null {
  const m = models.find((x) => x.id === id);
  if (!m?.pricing) return null;
  return {
    prompt: Number(m.pricing.prompt) || 0,
    completion: Number(m.pricing.completion) || 0,
  };
}

/** Rough token count. The prompts are English prose plus a transcript, for which
 * ~4 characters per token is a standard approximation — good enough to estimate
 * cost, and always labelled as an estimate in the UI. */
export const estTokens = (s: string) => Math.ceil(s.length / 4);
