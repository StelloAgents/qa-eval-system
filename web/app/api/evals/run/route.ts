import { NextRequest, NextResponse } from "next/server";
import { getOrg, orgHasActiveRun } from "@/lib/db";
import { startRun } from "@/lib/runner";
import { RunTier } from "@/lib/types";

// POST /api/evals/run — manual trigger (SPEC.md). Creates a queued run and
// executes it in the background against the live Bland/OpenRouter APIs.
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
  // One active run per org — concurrent runs trip Bland's rate gate.
  if (await orgHasActiveRun(orgId)) {
    return NextResponse.json(
      { error: "a run is already in progress for this org" },
      { status: 409 }
    );
  }
  const runId = await startRun(orgId, tier);
  return NextResponse.json({ run_id: runId, status: "queued" });
}
