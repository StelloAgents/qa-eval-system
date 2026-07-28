import { NextRequest, NextResponse } from "next/server";
import { clearJudgeModel, getJudgeModel, getOrg, setJudgeModel } from "@/lib/db";
import { DEFAULT_JUDGE_MODEL } from "@/lib/runner/judge";

// GET/PUT/DELETE /api/orgs/:orgId/model — which OpenRouter model grades this
// org. DELETE reverts to the built-in default by removing the row.
export const dynamic = "force-dynamic";

function body(orgId: string) {
  const selected = getJudgeModel(orgId);
  return {
    org_id: orgId,
    model: selected ?? DEFAULT_JUDGE_MODEL,
    is_default: selected === undefined,
    default_model: DEFAULT_JUDGE_MODEL,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  if (!getOrg(params.orgId)) {
    return NextResponse.json({ error: "org not found" }, { status: 404 });
  }
  return NextResponse.json(body(params.orgId));
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  if (!getOrg(params.orgId)) {
    return NextResponse.json({ error: "org not found" }, { status: 404 });
  }
  const payload = await req.json().catch(() => null);
  const model = (payload as { model?: unknown } | null)?.model;
  if (typeof model !== "string" || !model.includes("/")) {
    return NextResponse.json(
      { error: "body must be { model: string } using an OpenRouter id like 'vendor/model'" },
      { status: 400 }
    );
  }
  setJudgeModel(params.orgId, model);
  return NextResponse.json(body(params.orgId));
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  if (!getOrg(params.orgId)) {
    return NextResponse.json({ error: "org not found" }, { status: 404 });
  }
  clearJudgeModel(params.orgId);
  return NextResponse.json(body(params.orgId));
}
