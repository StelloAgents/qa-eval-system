import { NextRequest, NextResponse } from "next/server";
import { getOrg, updateOrg } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  const org = await getOrg(params.orgId);
  if (!org) return NextResponse.json({ error: "org not found" }, { status: 404 });
  const { org_name, bland_pathway_id, bland_kb_id, is_active } = org;
  return NextResponse.json({ org_name, bland_pathway_id, bland_kb_id, is_active });
}

// PUT /api/orgs/:org_id — Body: { bland_api_key_env?, is_active? } (SPEC.md).
export async function PUT(
  req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const { bland_api_key_env, is_active } = body as Record<string, unknown>;
  if (bland_api_key_env !== undefined && typeof bland_api_key_env !== "string") {
    return NextResponse.json(
      { error: "bland_api_key_env must be a string" },
      { status: 400 }
    );
  }
  if (is_active !== undefined && typeof is_active !== "boolean") {
    return NextResponse.json(
      { error: "is_active must be a boolean" },
      { status: 400 }
    );
  }
  if (bland_api_key_env === undefined && is_active === undefined) {
    return NextResponse.json(
      { error: "nothing to update: pass bland_api_key_env and/or is_active" },
      { status: 400 }
    );
  }
  const updated = await updateOrg(params.orgId, { bland_api_key_env, is_active });
  if (!updated) {
    return NextResponse.json({ error: "org not found" }, { status: 404 });
  }
  const { bland_api_key_env: _omit, ...safe } = updated;
  return NextResponse.json(safe);
}
