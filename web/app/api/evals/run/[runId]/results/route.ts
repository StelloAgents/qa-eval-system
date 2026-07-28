import { NextRequest, NextResponse } from "next/server";
import { getResults, getRun } from "@/lib/db";

// GET /api/evals/run/:run_id/results (SPEC.md).
export async function GET(
  _req: NextRequest,
  { params }: { params: { runId: string } }
) {
  const run = await getRun(params.runId);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  return NextResponse.json(await getResults(params.runId));
}
