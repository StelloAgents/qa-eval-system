import { NextRequest, NextResponse } from "next/server";
import { getResults, getRun, listDrafts, listRuns } from "@/lib/db";
import { isKbRefusal, loadCases } from "@/lib/runner";
import {
  DraftAnswer,
  DraftStatus,
  UnansweredItem,
  UnansweredResponse,
  UnansweredRun,
} from "@/lib/types";

// GET /api/evals/unanswered?org=<id>[&run=<runId>] — the questions the KB tier
// asked and got nothing back for, plus any answers already drafted for them.
//
// Read-only and LLM-free: it reports what the run recorded and what has been
// saved. Drafting is a separate, explicitly-triggered call, so opening the page
// never spends money.
export const dynamic = "force-dynamic";

/** Runs to offer in the switcher. Deep enough to reach a KB run after a burst
 * of pathway-only runs, shallow enough to stay one cheap query. */
const RUN_WINDOW = 25;

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get("org");
  const runParam = req.nextUrl.searchParams.get("run");
  if (!orgId) return NextResponse.json({ error: "org required" }, { status: 400 });

  const recent = await listRuns(orgId, RUN_WINDOW);
  // Only completed runs that exercised the KB tier can have unanswered
  // questions; a pathway-only run would render a misleading empty state.
  const kbRuns = recent.filter((r) => r.run_tier !== "pathway" && r.status === "completed");

  const empty = (runs: UnansweredRun[] = []): UnansweredResponse => ({
    org_id: orgId,
    run_id: null,
    items: [],
    answered: 0,
    drafts: {},
    spent: 0,
    runs,
  });

  // Summarise each KB run for the switcher, so the user can see where the work
  // is before clicking into it rather than hunting run by run.
  const summaries: UnansweredRun[] = [];
  for (const r of kbRuns) {
    const rows = await getResults(r.run_id);
    const unanswered = rows.filter((x) => x.tier === "kb" && isKbRefusal(x.answer ?? "")).length;
    const saved = await listDrafts(orgId, r.run_id);
    summaries.push({
      run_id: r.run_id,
      created_at: r.created_at,
      run_tier: r.run_tier,
      unanswered,
      drafted: saved.length,
    });
  }

  const run = runParam ? await getRun(runParam) : kbRuns[0];
  if (!run) return NextResponse.json(empty(summaries));

  const results = await getResults(run.run_id);
  const kbRows = results.filter((r) => r.tier === "kb");

  // The case file carries the expected outcome, which is grounding a draft can
  // use; results only store the question and the answer.
  let cases: ReturnType<typeof loadCases> = [];
  try {
    cases = loadCases(orgId);
  } catch {
    /* a missing case file must not break the list — expected just goes null */
  }
  const byId = new Map(cases.map((c) => [c.id, c]));

  const items: UnansweredItem[] = kbRows
    .filter((r) => isKbRefusal(r.answer ?? ""))
    .map((r) => ({
      case_id: r.case_id,
      case_name: r.case_name ?? r.case_id,
      category: r.category ?? "",
      question: r.question ?? "",
      kb_reply: r.answer ?? "",
      expected: byId.get(r.case_id)?.expected ?? null,
      kb_expect: byId.get(r.case_id)?.kb_expect ?? null,
    }));

  const saved = await listDrafts(orgId, run.run_id);
  const drafts: Record<string, DraftAnswer> = {};
  for (const d of saved) {
    drafts[d.case_id] = {
      case_id: d.case_id,
      status: d.status as DraftStatus,
      answer: d.answer,
      source: d.source,
      note: d.note,
      edited_answer: d.edited_answer,
    };
  }

  const resp: UnansweredResponse = {
    org_id: orgId,
    run_id: run.run_id,
    items,
    answered: kbRows.length - items.length,
    drafts,
    spent: saved.reduce((n, d) => n + (d.cost ?? 0), 0),
    runs: summaries,
  };
  return NextResponse.json(resp);
}
