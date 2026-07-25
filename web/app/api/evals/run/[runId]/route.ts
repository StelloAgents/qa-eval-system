import { NextRequest, NextResponse } from "next/server";
import { getCompletedCount, getRun } from "@/lib/db";

// GET /api/evals/run/:run_id — poll status (SPEC.md).
export async function GET(
  _req: NextRequest,
  { params }: { params: { runId: string } }
) {
  const run = getRun(params.runId);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  return NextResponse.json({
    run_id: run.run_id,
    status: run.status,
    total_cases: run.total_cases,
    passed_cases: run.passed_cases,
    completed_cases: getCompletedCount(run.run_id),
    error_message: run.error_message,
  });
}
