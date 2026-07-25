import { NextRequest, NextResponse } from "next/server";
import { getRun, pollLiveRun } from "@/lib/mock-data";

// GET /api/evals/run/:run_id — poll status (SPEC.md).
export async function GET(
  _req: NextRequest,
  { params }: { params: { runId: string } }
) {
  const { runId } = params;

  const live = pollLiveRun(runId);
  if (live) {
    return NextResponse.json({
      run_id: runId,
      status: live.run.status,
      total_cases: live.run.total_cases,
      passed_cases: live.run.passed_cases,
      completed_cases: live.completed_cases,
    });
  }

  const seeded = getRun(runId);
  if (!seeded) return NextResponse.json({ error: "run not found" }, { status: 404 });
  return NextResponse.json({
    run_id: runId,
    status: seeded.status,
    total_cases: seeded.total_cases,
    passed_cases: seeded.passed_cases,
    completed_cases: seeded.total_cases,
  });
}
