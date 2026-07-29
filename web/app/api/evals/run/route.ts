import { NextRequest, NextResponse } from "next/server";
import { getOrg, orgHasActiveRun, reapStaleRuns } from "@/lib/db";
import { startRun } from "@/lib/runner";
import { RunTier } from "@/lib/types";

// POST /api/evals/run — manual trigger (SPEC.md). Creates a queued run and
// executes it in the background against the live Bland/OpenRouter APIs.

// The run continues after the response via waitUntil, so the invocation must be
// allowed to live for the whole suite: measured ~2.5 min for the 74-variant
// Texans set and ~4 min for Compugen's 115. 800s leaves room for Bland's
// exponential backoff on a rate-limited run. Vercel caps this at the plan's
// ceiling, so a lower plan will simply cut it shorter — reapStaleRuns then
// clears the abandoned row rather than leaving the org blocked.
export const maxDuration = 800;
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const orgId = body?.org_id as string | undefined;
  const tier = body?.tier as RunTier | undefined;
  if (!orgId || !tier || !["kb", "pathway", "both"].includes(tier)) {
    return NextResponse.json(
      { error: "body must be { org_id, tier: 'kb' | 'pathway' | 'both' }" },
      { status: 400 }
    );
  }
  // Optional: max caller-simulator follow-up turns for pathway variants. 0 =
  // single-turn baseline. Ignored by the KB tier. Falls back to the runner
  // default when omitted; capped so a typo can't launch a runaway conversation.
  let maxTurns: number | undefined;
  if (body?.max_turns != null) {
    const n = Number(body.max_turns);
    if (!Number.isInteger(n) || n < 0 || n > 20) {
      return NextResponse.json(
        { error: "max_turns must be an integer between 0 and 20" },
        { status: 400 }
      );
    }
    maxTurns = n;
  }
  // Optional: run only these case ids. Absent/empty runs the whole suite.
  let caseIds: string[] | undefined;
  if (body?.case_ids != null) {
    if (!Array.isArray(body.case_ids) || body.case_ids.some((c: unknown) => typeof c !== "string")) {
      return NextResponse.json(
        { error: "case_ids must be an array of strings" },
        { status: 400 }
      );
    }
    caseIds = body.case_ids as string[];
  }
  const org = await getOrg(orgId);
  if (!org) return NextResponse.json({ error: "unknown org" }, { status: 404 });
  if (!org.is_active) {
    return NextResponse.json({ error: "org is not active" }, { status: 409 });
  }
  if (tier !== "pathway" && !org.bland_kb_id) {
    return NextResponse.json(
      { error: "org has no knowledge base configured" },
      { status: 409 }
    );
  }
  // Clear out runs abandoned by a killed process before deciding whether one is
  // genuinely in flight, so a timed-out run cannot block the org permanently.
  await reapStaleRuns(orgId);
  // One active run per org — concurrent runs trip Bland's rate gate.
  if (await orgHasActiveRun(orgId)) {
    return NextResponse.json(
      { error: "a run is already in progress for this org" },
      { status: 409 }
    );
  }
  const runId = await startRun(orgId, tier, maxTurns, caseIds);
  return NextResponse.json({ run_id: runId, status: "queued" });
}
