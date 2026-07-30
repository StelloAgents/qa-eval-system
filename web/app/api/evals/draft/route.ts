import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getJudgeModel, getOrg, saveDrafts, StoredDraft } from "@/lib/db";
import { DEFAULT_JUDGE_MODEL } from "@/lib/runner/judge";
import { estTokens, fetchModels, pricingFor } from "@/lib/openrouter";
import { DraftAnswer, DraftEstimate, DraftResponse } from "@/lib/types";

// POST /api/evals/draft — draft a KB answer for each supplied question, grounded
// in the org's knowledge base document.
//
// The whole safety of this feature rests on one rule: a draft must quote a line
// that already exists in the KB. The model is told to return found:false when it
// cannot, and — because a model asked to cite will happily invent a citation —
// every returned quote is verified against the file before the draft is allowed
// through. An unverifiable draft is downgraded to a content gap for a human,
// never surfaced as a ready-to-paste answer.
//
// Cost shape: the KB document dominates every prompt (~15k tokens against ~300
// for a question), so the two things that matter are how many times it is sent
// and how many of those are billed at full price. Questions are therefore
// BATCHED — one send of the KB serves several questions — and the first batch
// goes out alone so its identical prefix populates DeepSeek's automatic prompt
// cache, which OpenRouter bills at 10% of input price for every later batch.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";
/** Questions per call. Large enough that the KB cost is amortised, small enough
 * that the model is not juggling so many tasks that answers get terse and
 * citations sloppy — and so one malformed reply cannot lose the whole page. */
const BATCH_SIZE = 8;
/** Output budget per question: 1-3 sentences plus a quoted source line. */
const DRAFT_COMPLETION = 160;

/** Locate the org's KB document. Mirrors loadCases' two-location lookup so the
 * repo copy wins in local dev and the bundled copy works on Vercel. */
function loadKbDoc(orgId: string): { text: string; file: string } | null {
  const dirs = [
    path.resolve(process.cwd(), "..", orgId, "kb"),
    path.resolve(process.cwd(), "kb", orgId),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    // Newest .md wins, so uploading a v4 alongside v3 drafts from v4 without
    // anyone having to remember to change a path.
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    if (files.length) {
      return { text: fs.readFileSync(path.join(dir, files[0].f), "utf8"), file: files[0].f };
    }
  }
  return null;
}

/** Normalise for citation matching. Beyond collapsing whitespace this strips
 * punctuation, because a model quoting a sentence routinely reflows it: the KB
 * writes "...Field Level; it is a private room", the model quotes "...Field
 * Level." and a literal substring check then rejects a perfectly grounded
 * answer. Dropping punctuation also makes the match immune to straight-vs-curly
 * quotes, which bit us once already on 3" vs 3”. Word order and wording still
 * have to match exactly, so an invented citation is still caught. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

type Item = { case_id: string; question: string; expected?: string | null };

// The KB and the rules sit at the FRONT and never vary between calls. That
// shared prefix is what the prompt cache keys on, so nothing question-specific
// may appear above the QUESTIONS block.
const PREFIX = `You are preparing answers to add to a voice agent's knowledge base for {ORG}.

The knowledge base document is below. Callers asked the questions at the end and
retrieval returned nothing — but the answers may well already be in the document
and simply failed to surface.

Your job is to write the answer that SHOULD have come back for each question.

RULES:
- Use ONLY facts stated in the document below. Never add a number, phone number,
  section, price, date, or policy that is not written there.
- Answer in 1-3 plain sentences, the way a phone agent would say it. No markdown,
  no bullet points, no preamble.
- For each answer you MUST quote one sentence from the document, copied EXACTLY
  character for character, that supports it.
- If the document does not contain a given answer, return found:false for that
  question with empty answer and source. Do not guess.
- Answer every question you are given, once each, keyed by its exact id.

Return ONLY a minified JSON array, one object per question, no other text:
[{"id":"<id>","found":true,"answer":"...","source":"..."}]

--- KNOWLEDGE BASE DOCUMENT ---
{KB}
--- END DOCUMENT ---
`;

function buildPrompt(org: string, kb: string, batch: Item[]): string {
  const qs = batch
    .map(
      (i) =>
        `- id: ${i.case_id}\n  question: ${i.question}` +
        (i.expected ? `\n  expected outcome on file (context only): ${i.expected}` : "")
    )
    .join("\n");
  return PREFIX.replace("{ORG}", org).replace("{KB}", kb) + `\nQUESTIONS:\n${qs}\n`;
}

function chunk<T>(items: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const orgId = body?.org_id as string | undefined;
  const items = body?.items as Item[];
  const runId = body?.run_id as string | undefined;
  if (!orgId || !Array.isArray(items) || !items.length) {
    return NextResponse.json(
      { error: "body must be { org_id, items: [{ case_id, question }] }" },
      { status: 400 }
    );
  }
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return NextResponse.json({ error: "OPENROUTER_API_KEY is not set" }, { status: 500 });

  const org = await getOrg(orgId);
  if (!org) return NextResponse.json({ error: "unknown org" }, { status: 404 });

  const kb = loadKbDoc(orgId);
  if (!kb) {
    return NextResponse.json(
      { error: `no knowledge base document found at ${orgId}/kb/*.md` },
      { status: 404 }
    );
  }
  const kbNorm = norm(kb.text);
  const model = (await getJudgeModel(orgId)) ?? DEFAULT_JUDGE_MODEL;
  const batches = chunk(items, BATCH_SIZE);

  // Pre-flight estimate: the same prompts, priced without calling the model.
  if (body?.dry_run) {
    const promptTokens = batches.reduce(
      (n, b) => n + estTokens(buildPrompt(org.org_name, kb.text, b)),
      0
    );
    const completionTokens = items.length * DRAFT_COMPLETION;
    let estCost: number | null = null;
    try {
      const p = pricingFor(await fetchModels(), model);
      if (p) {
        // Batch 1 pays full input price and writes the cache; later batches read
        // the shared KB prefix at 10%. Their question blocks are new tokens, but
        // they are a rounding error next to the document.
        const perBatch = promptTokens / batches.length;
        const cachedReads = Math.max(0, batches.length - 1) * perBatch * 0.1;
        estCost = (perBatch + cachedReads) * p.prompt + completionTokens * p.completion;
      }
    } catch {
      /* OpenRouter unreachable — return token counts without a dollar figure */
    }
    const est: DraftEstimate = {
      org_id: orgId,
      kb_file: kb.file,
      model,
      questions: items.length,
      est_prompt_tokens: promptTokens,
      est_completion_tokens: completionTokens,
      est_cost: estCost,
    };
    return NextResponse.json(est);
  }

  let cost = 0;
  const collected = new Map<string, DraftAnswer>();

  function record(item: Item, v: any) {
    if (!v || v.found === false || !v.answer) {
      collected.set(item.case_id, {
        case_id: item.case_id,
        status: "no_source",
        answer: "",
        source: "",
        note: "The KB does not contain this answer — it is a real content gap, not a retrieval miss.",
      });
      return;
    }
    // Verify the citation instead of trusting it. A quote the model invented
    // means the answer is not actually grounded, whatever it claims.
    const verified = norm(String(v.source ?? "")).length >= 15 && kbNorm.includes(norm(String(v.source)));
    collected.set(item.case_id, {
      case_id: item.case_id,
      status: verified ? "drafted" : "unverified",
      answer: String(v.answer),
      source: String(v.source ?? ""),
      note: verified
        ? null
        : "Citation could not be found in the KB document — treat this draft as unverified and check it by hand.",
    });
  }

  async function runBatch(batch: Item[]) {
    try {
      const res = await fetch(OPENROUTER_API, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0,
          reasoning: { enabled: false },
          max_tokens: batch.length * DRAFT_COMPLETION * 3,
          messages: [{ role: "user", content: buildPrompt(org!.org_name, kb!.text, batch) }],
          usage: { include: true },
        }),
      });
      if (!res.ok) throw new Error(`openrouter ${res.status}`);
      const d = await res.json();
      cost += Number(d?.usage?.cost ?? 0) || 0;
      const raw = d?.choices?.[0]?.message?.content ?? "";
      const m = raw.match(/\[[\s\S]*\]/);
      if (!m) throw new Error("unparseable model reply");
      const arr = JSON.parse(m[0]);
      if (!Array.isArray(arr)) throw new Error("model did not return an array");
      const byId = new Map(arr.map((v: any) => [String(v?.id ?? ""), v]));
      for (const item of batch) record(item, byId.get(item.case_id));
    } catch (e: any) {
      // A failed batch fails only its own questions, never the whole page.
      for (const item of batch) {
        collected.set(item.case_id, {
          case_id: item.case_id,
          status: "error",
          answer: "",
          source: "",
          note: String(e?.message ?? e),
        });
      }
    }
  }

  // First batch alone: its response populates the prompt cache for the shared
  // KB prefix. Firing everything at once would have every batch miss the cache,
  // since none of them would have written it yet.
  await runBatch(batches[0]);
  if (batches.length > 1) await Promise.all(batches.slice(1).map(runBatch));

  // Split the batch cost evenly: per-question spend is not separable from a
  // batched call, and an even split at least keeps the total honest.
  const perQuestion = items.length ? cost / items.length : 0;
  let persisted = false;
  if (runId) {
    persisted = await saveDrafts(
      items.map<StoredDraft>((i) => {
        const d = collected.get(i.case_id);
        return {
          org_id: orgId,
          run_id: runId,
          case_id: i.case_id,
          question: i.question,
          status: d?.status ?? "error",
          answer: d?.answer ?? "",
          source: d?.source ?? "",
          note: d?.note ?? null,
          edited_answer: null,
          model,
          cost: perQuestion,
        };
      })
    );
  }

  const resp: DraftResponse = {
    org_id: orgId,
    kb_file: kb.file,
    model,
    cost,
    persisted,
    // Preserve the caller's ordering so the UI does not reshuffle on refresh.
    drafts: items.map(
      (i) =>
        collected.get(i.case_id) ?? {
          case_id: i.case_id,
          status: "error" as const,
          answer: "",
          source: "",
          note: "The model did not return an entry for this question.",
        }
    ),
  };
  return NextResponse.json(resp);
}
