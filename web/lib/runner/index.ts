// Run orchestration: executes a full eval run against the live Bland APIs and
// records results in SQLite as they complete (so the poll endpoint shows real
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

// Bland trips Cloudflare's rate gate (429 / "error code: 1015") at 6+ workers.
const WORKERS = 4;

export function loadCases(orgId: string): TestCase[] {
  // Test cases live in the repo per SPEC.md: <org>/evals/cases.json
  const p = path.resolve(process.cwd(), "..", orgId, "evals", "cases.json");
  if (!fs.existsSync(p)) {
    throw new Error(`no test cases found at ${orgId}/evals/cases.json`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function blandKeyFor(orgId: string): string {
  const org = getOrg(orgId);
  const key =
    (org && process.env[org.bland_api_key_env]) || process.env.BLAND_API_KEY;
  if (!key) throw new Error(`no Bland API key for org ${orgId} (check .env)`);
  return key;
}

/** Insert a queued run row and fire the execution in the background.
 * Returns the run_id immediately; the frontend polls for status. */
export function startRun(orgId: string, tier: RunTier): string {
  const runId = crypto.randomUUID();
  createRun({
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
    judge_model: getJudgeModel(orgId) ?? DEFAULT_JUDGE_MODEL,
  });
  // Fire-and-forget: the dev/prod Node process outlives the request, and the
  // poll endpoint reads progress from the DB. (On serverless this would need
  // a queue — see SPEC.md roadmap.)
  executeRun(runId, orgId, tier).catch(async (e) => {
    setRunStatus(runId, "failed", {
      completed_at: new Date().toISOString(),
      error_message: String(e?.message ?? e),
    });
  });
  return runId;
}

async function executeRun(runId: string, orgId: string, tier: RunTier) {
  const org = getOrg(orgId);
  if (!org) throw new Error(`unknown org ${orgId}`);
  const blandKey = blandKeyFor(orgId);
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (tier !== "kb" && !openrouterKey) {
    throw new Error("OPENROUTER_API_KEY is not set (required for pathway grading)");
  }

  const judgeModel = getJudgeModel(orgId) ?? DEFAULT_JUDGE_MODEL;
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
  setRunStatus(runId, "running", { total_cases: total });

  let seq = 0;
  const base = (c: TestCase) => ({
    run_id: runId,
    org_id: orgId,
    case_id: c.id,
    case_name: c.name,
    category: c.category,
  });
  const save = (r: Omit<EvalResult, "id" | "created_at">) =>
    insertResult({
      ...r,
      id: `${runId}-${++seq}`,
      created_at: new Date().toISOString(),
    });

  await Promise.all([
    pool(kbJobs, WORKERS, async (c) => {
      const question = c.variants[0].turns[c.variants[0].turns.length - 1];
      try {
        const ans = await kbChat(org.bland_kb_id!, question, blandKey);
        const miss = (c.kb_expect ?? []).filter(
          (s) => !ans.toLowerCase().includes(s.toLowerCase())
        );
        save({
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
        save({
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
    pool(pathwayJobs, WORKERS, async ({ c, variantIdx }) => {
      const variant = c.variants[variantIdx];
      try {
        const { chatId, exchanges } = await pathwayRun(
          org.bland_pathway_id,
          variant.turns,
          blandKey
        );
        // Read the override per job rather than once up front, so a prompt
        // edited mid-run applies to cases that have not been graded yet.
        const { ok, notes, usage } = await grade(
          c,
          exchanges,
          variant,
          openrouterKey!,
          org.org_name,
          getGraderPrompt(orgId, c.id),
          judgeModel
        );
        save({
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
          judge_cost: usage?.cost ?? 0,
          judge_prompt_tokens: usage?.prompt_tokens ?? 0,
          judge_completion_tokens: usage?.completion_tokens ?? 0,
        });
      } catch (e: any) {
        save({
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

  setRunStatus(runId, "completed", { completed_at: new Date().toISOString() });
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift()!);
    })
  );
}
