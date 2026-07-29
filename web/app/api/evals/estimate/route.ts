import { NextRequest, NextResponse } from "next/server";
import { getGraderPrompt, getJudgeModel, getOrg } from "@/lib/db";
import { loadCases } from "@/lib/runner";
import {
  buildGroundTruth,
  DEFAULT_JUDGE_MODEL,
  DEFAULT_JUDGE_TEMPLATE,
  renderJudgePrompt,
} from "@/lib/runner/judge";
import { buildCallerPrompt } from "@/lib/runner/sim";
import { nowString } from "@/lib/runner/bland";
import { estTokens, fetchModels, pricingFor } from "@/lib/openrouter";
import { EstimateResponse, Exchange, RunTier } from "@/lib/types";

// POST /api/evals/estimate — an upper-bound LLM cost estimate for a chosen scope
// (selected cases × tier × turns), mirroring exactly what the runner will send:
// one judge call per pathway variant plus one caller-simulator call per turn.
export const dynamic = "force-dynamic";

// Stand-ins for text that does not exist until the run: an agent reply and a
// caller follow-up, sized to typical lengths so token estimates are realistic.
const AGENT_REPLY = "x".repeat(280);
const CALLER_REPLY = "x".repeat(90);
// Completion is short: a JSON verdict (judge) or a 1-2 sentence caller line.
const JUDGE_COMPLETION = 40;
const SIM_COMPLETION = 50;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const orgId = body?.org_id as string | undefined;
  const tier = (body?.tier as RunTier) ?? "pathway";
  const maxTurns = Number.isInteger(body?.max_turns)
    ? Math.max(0, Math.min(20, body.max_turns))
    : 6;
  const caseIds: string[] | null = Array.isArray(body?.case_ids) ? body.case_ids : null;

  if (!orgId) return NextResponse.json({ error: "org_id required" }, { status: 400 });
  const org = await getOrg(orgId);
  if (!org) return NextResponse.json({ error: "unknown org" }, { status: 404 });

  let cases;
  try {
    cases = loadCases(orgId);
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 404 });
  }
  const wanted = caseIds && caseIds.length ? new Set(caseIds) : null;
  if (wanted) cases = cases.filter((c) => wanted.has(c.id));

  const judgeModel = (await getJudgeModel(orgId)) ?? DEFAULT_JUDGE_MODEL;
  const today = nowString();
  const runsPathway = tier !== "kb"; // the KB tier makes no LLM calls

  let selectedCases = 0;
  let variants = 0;
  let gradedCalls = 0;
  let simCalls = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let blandCalls = 0;

  if (runsPathway) {
    for (const c of cases) {
      if (c.untestable?.tier === "pathway") continue;
      selectedCases++;
      const template = (await getGraderPrompt(orgId, c.id)) ?? DEFAULT_JUDGE_TEMPLATE;
      for (const variant of c.variants) {
        variants++;
        // Reconstruct the transcript pathwaySim would build: opener + up to
        // maxTurns follow-ups. Upper bound — real conversations stop early once
        // the agent wraps up or hands off.
        const exchanges: Exchange[] = [
          { user: variant.turns[0], assistant: AGENT_REPLY, node: null },
        ];
        for (let i = 0; i < maxTurns; i++) {
          simCalls++;
          promptTokens += estTokens(buildCallerPrompt(c, exchanges));
          completionTokens += SIM_COMPLETION;
          exchanges.push({ user: CALLER_REPLY, assistant: AGENT_REPLY, node: null });
        }
        gradedCalls++;
        const truth = buildGroundTruth(c, variant);
        const conversation = exchanges
          .map((e) => `Caller: ${e.user}\nAgent: ${e.assistant}`)
          .join("\n");
        promptTokens += estTokens(
          renderJudgePrompt(template, {
            org: org.org_name,
            today,
            expected: c.expected,
            conversation,
            groundTruth: truth.length ? truth.join("\n") : null,
          })
        );
        completionTokens += JUDGE_COMPLETION;
        blandCalls += 2 + maxTurns; // hello + opener + follow-ups
      }
    }
  } else {
    for (const c of cases) {
      if (c.untestable?.tier === "kb") continue;
      if (c.kb_expect?.length) {
        selectedCases++;
        blandCalls++;
      }
    }
  }

  let pricingKnown = false;
  let estCost: number | null = null;
  try {
    const p = pricingFor(await fetchModels(), judgeModel);
    if (p) {
      pricingKnown = true;
      estCost = promptTokens * p.prompt + completionTokens * p.completion;
    }
  } catch {
    // OpenRouter unreachable — return the call/token counts without a dollar figure.
  }

  const resp: EstimateResponse = {
    org_id: orgId,
    tier,
    max_turns: maxTurns,
    judge_model: judgeModel,
    pricing_known: pricingKnown,
    selected_cases: selectedCases,
    variants,
    graded_calls: gradedCalls,
    sim_calls: simCalls,
    est_prompt_tokens: promptTokens,
    est_completion_tokens: completionTokens,
    est_cost: estCost,
    is_upper_bound: runsPathway && maxTurns > 0,
    bland_calls: blandCalls,
  };
  return NextResponse.json(resp);
}
