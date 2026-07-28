import { NextRequest, NextResponse } from "next/server";
import { compareRuns } from "@/lib/db";

// GET /api/evals/compare/:run_id_a/:run_id_b — A is the baseline, B the
// current run (SPEC.md). Returns new_passes / regressions / stable.
export async function GET(
  _req: NextRequest,
  { params }: { params: { runA: string; runB: string } }
) {
  const cmp = await compareRuns(params.runA, params.runB);
  if (!cmp) {
    return NextResponse.json(
      { error: "one or both runs not found or empty" },
      { status: 404 }
    );
  }
  return NextResponse.json(cmp);
}
