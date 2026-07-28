import { NextRequest, NextResponse } from "next/server";
import { getGraderPrompt, getJudgeModel, getOrg } from "@/lib/db";
import { loadCases } from "@/lib/runner";
import {
  buildGroundTruth,
  DEFAULT_JUDGE_MODEL,
  DEFAULT_JUDGE_TEMPLATE,
  renderJudgePrompt,
} from "@/lib/runner/judge";
import { nowString } from "@/lib/runner/bland";
import { JudgeModel, ModelCatalogue } from "@/lib/types";

// GET /api/models?org=<org_id> — grader models available on OpenRouter, with a
// cost-per-run estimate for that org's suite.
export const dynamic = "force-dynamic";

const OPENROUTER_MODELS = "https://openrouter.ai/api/v1/models";

// The catalogue is ~370 models and changes rarely; refetching per keystroke in
// the picker would be wasteful and rate-limited.
let cache: { at: number; data: any[] } | null = null;
const TTL_MS = 10 * 60 * 1000;

async function fetchModels(): Promise<any[]> {
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

/** Rough token count. The judge prompt is English prose plus a transcript, for
 * which ~4 characters per token is a standard approximation — good enough to
 * rank models by cost, and labelled as an estimate in the UI. */
const estTokens = (s: string) => Math.ceil(s.length / 4);

/** Completion is one short JSON verdict; observed runs land near 30 tokens and
 * max_tokens caps it at 200. */
const EST_COMPLETION_TOKENS = 40;

/** Sum the prompt tokens this org would actually send: every pathway variant
 * gets one judge call, rendered from that case's own template and expected
 * outcome. KB-tier cases are excluded — they never call an LLM. */
async function estimateSuite(orgId: string, orgName: string) {
  let calls = 0;
  let promptTokens = 0;
  const today = nowString();
  for (const c of loadCases(orgId)) {
    if (c.untestable?.tier === "pathway") continue;
    const template = (await getGraderPrompt(orgId, c.id)) ?? DEFAULT_JUDGE_TEMPLATE;
    for (const variant of c.variants) {
      const truth = buildGroundTruth(c, variant);
      // Stand in for the agent's replies, which do not exist until the run.
      const conversation = variant.turns
        .map((t) => `Caller: ${t}\nAgent: ${"x".repeat(220)}`)
        .join("\n");
      promptTokens += estTokens(
        renderJudgePrompt(template, {
          org: orgName,
          today,
          expected: c.expected,
          conversation,
          groundTruth: truth.length ? truth.join("\n") : null,
        })
      );
      calls++;
    }
  }
  return { calls, promptTokens };
}

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get("org") ?? "";
  const org = await getOrg(orgId);
  if (!org) return NextResponse.json({ error: "unknown org" }, { status: 404 });

  let raw: any[];
  try {
    raw = await fetchModels();
  } catch (e: any) {
    return NextResponse.json(
      { error: `could not reach OpenRouter: ${e?.message ?? e}` },
      { status: 502 }
    );
  }

  let basis = { calls: 0, promptTokens: 0 };
  try {
    basis = await estimateSuite(orgId, org.org_name);
  } catch {
    // No case file yet — the picker still works, estimates just read as zero.
  }

  const models: JudgeModel[] = raw
    // Text in, text out, and honours temperature (the judge pins it to 0).
    // Matching on modalities rather than the exact "text->text" string keeps
    // multimodal models in — Claude, GPT-4o and Gemini all report something
    // like "text+image+file->text" and are perfectly good text judges.
    .filter((m) => {
      const a = m?.architecture ?? {};
      return (
        (a.input_modalities ?? []).includes("text") &&
        (a.output_modalities ?? []).includes("text") &&
        (m.supported_parameters ?? []).includes("temperature") &&
        m?.pricing?.prompt !== undefined
      );
    })
    .map((m) => {
      const prompt = Number(m.pricing.prompt) || 0;
      const completion = Number(m.pricing.completion) || 0;
      return {
        id: m.id,
        name: m.name ?? m.id,
        prompt_price: prompt,
        completion_price: completion,
        context_length: m.top_provider?.context_length ?? m.context_length ?? 0,
        intelligence:
          m.benchmarks?.artificial_analysis?.intelligence_index ?? null,
        est_cost_per_run:
          basis.promptTokens * prompt +
          basis.calls * EST_COMPLETION_TOKENS * completion,
        is_free: prompt === 0 && completion === 0,
      };
    })
    .sort((a, b) => a.est_cost_per_run - b.est_cost_per_run);

  const selected = await getJudgeModel(orgId);
  const body: ModelCatalogue = {
    org_id: orgId,
    selected: selected ?? DEFAULT_JUDGE_MODEL,
    is_default: selected === undefined,
    default_model: DEFAULT_JUDGE_MODEL,
    estimate_basis: {
      graded_calls: basis.calls,
      est_prompt_tokens: basis.promptTokens,
      est_completion_tokens_per_call: EST_COMPLETION_TOKENS,
    },
    models,
  };
  return NextResponse.json(body);
}
