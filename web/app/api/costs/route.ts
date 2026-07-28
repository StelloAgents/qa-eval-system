import { NextRequest, NextResponse } from "next/server";
import { costByModel, costByOrg, listRunCosts } from "@/lib/db";
import { CostSummary } from "@/lib/types";

// GET /api/costs?org=<org_id>&limit=100 — grader spend, from the cost figures
// OpenRouter returned on each judge call. Bland pathway/KB calls are not
// itemised here; Bland does not bill per request through this API.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get("org") || undefined;
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(limitParam) ? limitParam : 100;

  const [runs, byOrg, byModel] = await Promise.all([
    listRunCosts(orgId, limit),
    costByOrg(),
    costByModel(),
  ]);
  const body: CostSummary = {
    // Totals cover every run on record, not just the page being shown.
    total_cost: byOrg.reduce((n, r) => n + r.cost, 0),
    total_runs: byOrg.reduce((n, r) => n + r.runs, 0),
    total_graded_calls: byModel.reduce((n, m) => n + m.calls, 0),
    by_org: byOrg,
    by_model: byModel,
    runs,
  };
  return NextResponse.json(body);
}
