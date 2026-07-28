import { NextRequest, NextResponse } from "next/server";
import {
  clearGraderPrompt,
  getGraderPrompt,
  getOrg,
  setGraderPrompt,
} from "@/lib/db";
import { loadCases } from "@/lib/runner";
import {
  buildGroundTruth,
  DEFAULT_JUDGE_TEMPLATE,
  JUDGE_PLACEHOLDERS,
  renderJudgePrompt,
} from "@/lib/runner/judge";
import { nowString } from "@/lib/runner/bland";
import { GraderPrompt } from "@/lib/types";

// GET/PUT/DELETE /api/orgs/:orgId/cases/:caseId/prompt — the grader prompt for
// one test case. DELETE resets it to the shared default by removing the
// override row, so the case tracks the default if the default later changes.
export const dynamic = "force-dynamic";

const PLACEHOLDERS = JUDGE_PLACEHOLDERS.map((p) => ({ ...p }));

/** 404 unless the org exists and actually defines this case. Without the second
 * check a typo'd case id would happily store an override that never runs. */
function resolve(orgId: string, caseId: string): string | null {
  if (!getOrg(orgId)) return "org not found";
  try {
    if (!loadCases(orgId).some((c) => c.id === caseId)) {
      return `no test case "${caseId}" for org "${orgId}"`;
    }
  } catch (e: any) {
    return String(e?.message ?? e);
  }
  return null;
}

function body(orgId: string, caseId: string): GraderPrompt {
  const override = getGraderPrompt(orgId, caseId);
  const effective = override ?? DEFAULT_JUDGE_TEMPLATE;

  const org = getOrg(orgId)!;
  const testCase = loadCases(orgId).find((c) => c.id === caseId)!;
  // Ground truth is per-variant for payment_due cases; variant 1 is
  // representative and is what the preview labels itself as showing.
  const truth = buildGroundTruth(testCase, testCase.variants[0]);
  // Stand-in transcript built from the case's own first phrasing, so the
  // preview reads like a real graded conversation without inventing an answer.
  const conversation =
    testCase.variants[0].turns
      .map((t) => `Caller: ${t}\nAgent: <the agent's reply from this run>`)
      .join("\n");

  const values = {
    org: org.org_name,
    today: nowString(),
    expected: testCase.expected,
    ground_truth: truth.join("\n"),
    conversation,
  };

  return {
    org_id: orgId,
    case_id: caseId,
    effective,
    default: DEFAULT_JUDGE_TEMPLATE,
    is_default: override === undefined,
    placeholders: PLACEHOLDERS,
    values,
    rendered: renderJudgePrompt(effective, {
      org: values.org,
      today: values.today,
      expected: values.expected,
      conversation: values.conversation,
      groundTruth: truth.length ? values.ground_truth : null,
    }),
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { orgId: string; caseId: string } }
) {
  const err = resolve(params.orgId, params.caseId);
  if (err) return NextResponse.json({ error: err }, { status: 404 });
  return NextResponse.json(body(params.orgId, params.caseId));
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { orgId: string; caseId: string } }
) {
  const err = resolve(params.orgId, params.caseId);
  if (err) return NextResponse.json({ error: err }, { status: 404 });

  const payload = await req.json().catch(() => null);
  const template = (payload as { template?: unknown } | null)?.template;
  if (typeof template !== "string" || !template.trim()) {
    return NextResponse.json(
      { error: "body must be { template: string }" },
      { status: 400 }
    );
  }
  // Without the transcript the judge has nothing to grade and would pass or
  // fail every case at random, so this one placeholder is required.
  if (!template.includes("{{conversation}}")) {
    return NextResponse.json(
      { error: "template must include {{conversation}} — the judge cannot grade without the transcript" },
      { status: 400 }
    );
  }

  setGraderPrompt(params.orgId, params.caseId, template);
  const result = body(params.orgId, params.caseId);
  // Advisory only: dropping {{expected}} is unusual but legitimate if the
  // rubric has been inlined, so it warns rather than rejecting.
  const warning = template.includes("{{expected}}")
    ? undefined
    : "template omits {{expected}}, so the case's expected outcome will not reach the judge";
  return NextResponse.json(warning ? { ...result, warning } : result);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { orgId: string; caseId: string } }
) {
  const err = resolve(params.orgId, params.caseId);
  if (err) return NextResponse.json({ error: err }, { status: 404 });
  clearGraderPrompt(params.orgId, params.caseId);
  return NextResponse.json(body(params.orgId, params.caseId));
}
