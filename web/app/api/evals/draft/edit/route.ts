import { NextRequest, NextResponse } from "next/server";
import { saveDraftEdit } from "@/lib/db";

// PUT /api/evals/draft/edit — persist a human's rewrite of a draft, or clear it
// with edited_answer: null to revert to the model's wording.
//
// Separate from the draft route because it must never cost anything: editing is
// the cheap, frequent action and should not sit behind a route that can spend.
export const dynamic = "force-dynamic";

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { org_id, run_id, case_id } = body ?? {};
  const edited = body?.edited_answer;
  if (
    typeof org_id !== "string" ||
    typeof run_id !== "string" ||
    typeof case_id !== "string" ||
    (edited != null && typeof edited !== "string")
  ) {
    return NextResponse.json(
      { error: "body must be { org_id, run_id, case_id, edited_answer: string | null }" },
      { status: 400 }
    );
  }
  const saved = await saveDraftEdit(org_id, run_id, case_id, edited ?? null);
  // `saved: false` means there was no row to update — either the draft was
  // never persisted or migration 0002 has not run. The UI keeps the edit in
  // local state either way, so this is reported, not thrown.
  return NextResponse.json({ saved });
}
