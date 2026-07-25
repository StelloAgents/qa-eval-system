import { NextRequest, NextResponse } from "next/server";
import { getOrg } from "@/lib/mock-data";

export async function GET(
  _req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  const org = getOrg(params.orgId);
  if (!org) return NextResponse.json({ error: "org not found" }, { status: 404 });
  const { org_name, bland_pathway_id, bland_kb_id, is_active } = org;
  return NextResponse.json({ org_name, bland_pathway_id, bland_kb_id, is_active });
}
