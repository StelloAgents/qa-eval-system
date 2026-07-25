import { NextRequest, NextResponse } from "next/server";
import { startLiveRun } from "@/lib/mock-data";
import { RunTier } from "@/lib/types";

// POST /api/evals/run — manual trigger (SPEC.md). Stubbed: starts a simulated
// run that progresses over time; swap for the real Bland/OpenRouter runner.
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
  const run = startLiveRun(orgId, tier);
  if (!run) return NextResponse.json({ error: "unknown org" }, { status: 404 });
  return NextResponse.json({ run_id: run.run_id, status: "queued" });
}
