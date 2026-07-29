// Run orchestration: executes a full eval run against the live Bland APIs and
// records results in Postgres as they complete (so the poll endpoint shows real
// progress). Port of eval.py's main() with the reporting swapped for DB writes.

import fs from "node:fs";
import path from "node:path";
import "../env";
import {
  createRun,
  getGraderPrompt,
  getJudgeModel,
  getOrg,
  insertResult,
  setRunStatus,
} from "../db";
import { EvalResult, RunTier } from "../types";
import { kbChat, pathwayRun } from "./bland";
import { DEFAULT_JUDGE_MODEL, grade, TestCase } from "./judge";
import { pathwaySim } from "./sim";

// Bland trips Cloudflare's rate gate (429 / "error code: 1015") at 6+ workers.
const WORKERS = 4;

export function loadCases(orgId: string): TestCase[] {
  // Two locations, in this order:
  //   1. <repo>/<org>/evals/cases.json — the source of truth, used in local
  //      dev so an edit takes effect on the next request with no rebuild.
  //   2. web/evals/<org>/cases.json — the build-time copy made by
  //      scripts/collect-cases.mjs. The only one that exists on Vercel, where
  //      the repo root sits outside the deployment.
  const candidates = [
    path.resolve(process.cwd(), "..", orgId, "evals", "cases.json"),
    path.resolve(process.cwd(), "evals", orgId, "cases.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  }
  throw new Error(`no test cases found at ${orgId}/evals/cases.json`);
}

async function blandKeyFor(orgId: string): Promise<string> {
  const org = await getOrg(orgId);
  const key =
    (org && process.env[org.bland_api_key_env]) || process.env.BLAND_API_KEY;
  if (!key) throw new Error(`no Bland API key for org ${orgId} (check .env)`);
  return key;
}

/** Max caller-simulator follow-up turns for a pathway variant. 0 = single-turn
 * (send only the opening line — the cheap baseline that mostly catches guardrail
 * leaks); >0 drives a multi-turn conversation via the caller-simulator. */
export const DEFAULT_MAX_TURNS = 6;

/** Insert a queued run row and fire the execution in the background.
 * Returns the run_id once the row exists; the frontend polls for status. */
export async function startRun(
  orgId: string,
  tier: RunTier,
  maxTurns: number = DEFAULT_MAX_TURNS
): Promise<string> {
  const runId = crypto.randomUUID();
  await createRun({
    run_id: runId,
    org_id: orgId,
    run_tier: tier,
    status: "queued",
    total_cases: 0,
    passed_cases: 0,
    started_at: new Date().toISOString(),
    completed_at: null,
    error_message: null,
    created_at: new Date().toISOString(),
    // Pinned at start so historical spend stays attributable if the org's
    // model setting is changed later.
    judge_model: (await getJudgeModel(orgId)) ?? DEFAULT_JUDGE_MODEL,
  });
  const work = executeRun(runId, orgId, tier, maxTurns).catch(async (e) => {
    await setRunStatus(runId, "failed", {
      completed_at: new Date().toISOString(),
      error_message: String(e?.message ?? e),
    }).catch(() => {
      /* the run already failed; a failed status write must not mask it */
    });
  });

  // A long-lived `next dev`/`next start` process keeps the promise alive on its
  // own. Serverless does not: the function is frozen the moment the response is
  // sent, so the run would never leave `queued`. waitUntil asks the platform to
  // keep the invocation alive until the work settles, bounded by the route's
  // maxDuration. Outside Vercel it is a no-op, hence the guard.
  if (process.env.VERCEL) {
    const { waitUntil } = await import("@vercel/functions");
    waitUntil(work);
  }
  return runId;
}

async function executeRun(
  runId: string,
  orgId: string,
  tier: RunTier,
  maxTurns: number
) {
  const org = await getOrg(orgId);
  if (!org) throw new Error(`unknown org ${orgId}`);
  const blandKey = await blandKeyFor(orgId);
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (tier !== "kb" && !openrouterKey) {
    throw new Error("OPENROUTER_API_KEY is not set (required for pathway grading)");
  }

  const judgeModel = (await getJudgeModel(orgId)) ?? DEFAULT_JUDGE_MODEL;
  const allCases = loadCases(orgId);

  // Cases that can't be graded on this channel are excluded, not failed --
  // leaving them in parks a permanent false FAIL that masks real regressions.
  const testable = allCases.filter((c) => c.untestable?.tier !== tier);

  const pathwayJobs: { c: TestCase; variantIdx: number }[] = [];
  const kbJobs: TestCase[] = [];
  if (tier !== "kb") {
    for (const c of testable) {
      c.variants.forEach((_, i) => pathwayJobs.push({ c, variantIdx: i }));
    }
  }
  if (tier !== "pathway") {
    kbJobs.push(...testable.filter((c) => c.kb_expect?.length));
  }

  const total = pathwayJobs.length + kbJobs.length;
  await setRunStatus(runId, "running", { total_cases: total });

  let seq = 0;
  const base = (c: TestCase) => ({
    run_id: runId,
    org_id: orgId,
    case_id: c.id,
    case_name: c.name,
    category: c.category,
  });
  // Awaited at every call site: an unawaited insert would let the run be
  // marked completed before its results were written.
  const save = (r: Omit<EvalResult, "id" | "created_at">) =>
    insertResult({
      ...r,
      id: `${runId}-${++seq}`,
      created_at: new Date().toISOString(),
    });

  await Promise.all([
    workerPool(kbJobs, WORKERS, async (c) => {
      const question = c.variants[0].turns[c.variants[0].turns.length - 1];
      try {
        const ans = await kbChat(org.bland_kb_id!, question, blandKey);
        const miss = (c.kb_expect ?? []).filter(
          (s) => !ans.toLowerCase().includes(s.toLowerCase())
        );
        await save({
          ...base(c),
          variant_num: 1,
          tier: "kb",
          question,
          answer: ans,
          passed: miss.length === 0,
          notes: miss.length
            ? [{ type: "advisory", message: `missing ${JSON.stringify(miss)}` }]
            : [],
          chat_id: null,
          exchanges: [],
        });
      } catch (e: any) {
        await save({
          ...base(c),
          variant_num: 1,
          tier: "kb",
          question,
          answer: "",
          passed: false,
          notes: [{ type: "error", message: `${e?.name ?? "Error"}: ${e?.message ?? e}` }],
          chat_id: null,
          exchanges: [],
        });
      }
    }),
    workerPool(pathwayJobs, WORKERS, async ({ c, variantIdx }) => {
      const variant = c.variants[variantIdx];
      try {
        // maxTurns > 0 drives a multi-turn conversation with the caller-simulator
        // so the agent can actually work the problem; 0 sends only the opening
        // line (single-turn baseline). The simulator plays the caller for the
        // follow-ups after the opener, hence variant.turns[0] as the opener.
        const { chatId, exchanges, simUsage } =
          maxTurns > 0
            ? await pathwaySim(
                org.bland_pathway_id,
                c,
                variant.turns[0],
                blandKey,
                openrouterKey!,
                judgeModel,
                maxTurns
              )
            : { ...(await pathwayRun(org.bland_pathway_id, variant.turns, blandKey)), simUsage: null };
        // Read the override per job rather than once up front, so a prompt
        // edited mid-run applies to cases that have not been graded yet.
        const { ok, notes, usage } = await grade(
          c,
          exchanges,
          variant,
          openrouterKey!,
          org.org_name,
          await getGraderPrompt(orgId, c.id),
          judgeModel
        );
        // Fold the caller-simulator's OpenRouter spend into the grading cost:
        // both are grading-side spend on the same model, and the schema has no
        // separate column for it. Cost dashboards then reflect true spend.
        await save({
          ...base(c),
          variant_num: variantIdx + 1,
          tier: "pathway",
          question: variant.turns[variant.turns.length - 1],
          answer: exchanges.map((e) => e.assistant).join(" "),
          passed: ok,
          notes,
          chat_id: chatId,
          exchanges,
          judge_model: usage?.model ?? judgeModel,
          judge_cost: (usage?.cost ?? 0) + (simUsage?.cost ?? 0),
          judge_prompt_tokens: (usage?.prompt_tokens ?? 0) + (simUsage?.prompt_tokens ?? 0),
          judge_completion_tokens:
            (usage?.completion_tokens ?? 0) + (simUsage?.completion_tokens ?? 0),
        });
      } catch (e: any) {
        await save({
          ...base(c),
          variant_num: variantIdx + 1,
          tier: "pathway",
          question: variant.turns[variant.turns.length - 1],
          answer: "",
          passed: false,
          notes: [{ type: "error", message: `${e?.name ?? "Error"}: ${e?.message ?? e}` }],
          chat_id: null,
          exchanges: [],
        });
      }
    }),
  ]);

  await setRunStatus(runId, "completed", { completed_at: new Date().toISOString() });
}

// Renamed from `pool` to avoid reading as the database connection pool.
async function workerPool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift()!);
    })
  );
}
