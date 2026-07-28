import { NextRequest, NextResponse } from "next/server";
import { getOrg, listCustomisedCaseIds } from "@/lib/db";
import { loadCases } from "@/lib/runner";
import { OrgCases, TestCaseSummary } from "@/lib/types";

// GET /api/orgs/:org_id/cases — the org's test case catalogue, read straight
// from <org>/evals/cases.json (the same file the runner executes), so the UI
// can never drift from what actually runs.
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  const org = await getOrg(params.orgId);
  if (!org) return NextResponse.json({ error: "org not found" }, { status: 404 });

  let raw;
  try {
    raw = loadCases(params.orgId);
  } catch (e: any) {
    return NextResponse.json(
      { error: String(e?.message ?? e) },
      { status: 404 }
    );
  }

  const customised = await listCustomisedCaseIds(params.orgId);

  const cases: TestCaseSummary[] = raw.map((c) => {
    // Mirrors the runner's job selection: a case runs on the pathway tier
    // unless excluded, and on the KB tier only if it asserts KB content.
    const tiers: ("kb" | "pathway")[] = [];
    if (c.untestable?.tier !== "pathway") tiers.push("pathway");
    if (c.kb_expect?.length && c.untestable?.tier !== "kb") tiers.push("kb");
    return {
      id: c.id,
      name: c.name,
      category: c.category,
      application: c.application ?? null,
      expected: c.expected,
      kb_expect: c.kb_expect ?? null,
      variants: c.variants,
      graders: c.graders ?? [],
      tiers,
      untestable_reason: c.untestable?.reason ?? null,
      grader_prompt_customised: customised.has(c.id),
    };
  });

  const body: OrgCases = {
    org_id: org.org_id,
    org_name: org.org_name,
    total_cases: cases.length,
    pathway_runs: cases
      .filter((c) => c.tiers.includes("pathway"))
      .reduce((n, c) => n + c.variants.length, 0),
    kb_checks: cases.filter((c) => c.tiers.includes("kb")).length,
    cases,
  };
  return NextResponse.json(body);
}
