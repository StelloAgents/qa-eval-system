import { NextRequest, NextResponse } from "next/server";
import { listRuns } from "@/lib/mock-data";

// GET /api/evals/runs/:org_id?limit=10 — run history (SPEC.md).
export async function GET(
  req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 10);
  const runs = listRuns(params.orgId, Number.isFinite(limit) ? limit : 10);
  return NextResponse.json(runs);
}
