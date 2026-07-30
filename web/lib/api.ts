import {
  CompareResult,
  CostSummary,
  DraftEstimate,
  DraftResponse,
  EstimateResponse,
  EvalOrg,
  EvalResult,
  EvalRun,
  GraderPrompt,
  ModelCatalogue,
  OrgCases,
  RunStatusResponse,
  RunTier,
  UnansweredResponse,
} from "./types";

// Thin client over the Next.js API routes. The routes mirror SPEC.md §API
// Endpoints; when the real backend lands these calls stay identical.

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

/** For endpoints that must return an array. A route that forgets to await a
 * database call serialises a Promise as `{}` and still returns 200 — the UI
 * then dies on `.map is not a function`, which points nowhere near the cause.
 * Failing here turns that into a caught, named error instead. */
async function getArray<T>(url: string): Promise<T[]> {
  const data = await getJson<unknown>(url);
  if (!Array.isArray(data)) {
    throw new Error(`${url} returned ${typeof data}, expected an array`);
  }
  return data as T[];
}

export const api = {
  listOrgs: () => getArray<EvalOrg>("/api/orgs"),
  getOrg: (orgId: string) => getJson<EvalOrg>(`/api/orgs/${orgId}`),
  getOrgCases: (orgId: string) => getJson<OrgCases>(`/api/orgs/${orgId}/cases`),
  getGraderPrompt: (orgId: string, caseId: string) =>
    getJson<GraderPrompt>(`/api/orgs/${orgId}/cases/${caseId}/prompt`),
  saveGraderPrompt: async (orgId: string, caseId: string, template: string) => {
    const res = await fetch(`/api/orgs/${orgId}/cases/${caseId}/prompt`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ template }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error ?? `save failed (${res.status})`);
    return json as GraderPrompt & { warning?: string };
  },
  listModels: (orgId: string) =>
    getJson<ModelCatalogue>(`/api/models?org=${orgId}`),
  setJudgeModel: async (orgId: string, model: string) => {
    const res = await fetch(`/api/orgs/${orgId}/model`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model }),
    });
    if (!res.ok) throw new Error(`set model → ${res.status}`);
    return res.json();
  },
  resetJudgeModel: async (orgId: string) => {
    const res = await fetch(`/api/orgs/${orgId}/model`, { method: "DELETE" });
    if (!res.ok) throw new Error(`reset model → ${res.status}`);
    return res.json();
  },
  getCosts: (orgId?: string) =>
    getJson<CostSummary>(`/api/costs${orgId ? `?org=${orgId}` : ""}`),
  resetGraderPrompt: async (orgId: string, caseId: string) => {
    const res = await fetch(`/api/orgs/${orgId}/cases/${caseId}/prompt`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`reset failed (${res.status})`);
    return (await res.json()) as GraderPrompt;
  },
  listRuns: (orgId: string, limit = 10) =>
    getArray<EvalRun>(`/api/evals/runs/${orgId}?limit=${limit}`),
  getRun: (runId: string) => getJson<RunStatusResponse>(`/api/evals/run/${runId}`),
  getRunResults: (runId: string) =>
    getArray<EvalResult>(`/api/evals/run/${runId}/results`),
  compare: (runA: string, runB: string) =>
    getJson<CompareResult>(`/api/evals/compare/${runA}/${runB}`),
  unanswered: (orgId: string, runId?: string) =>
    getJson<UnansweredResponse>(
      `/api/evals/unanswered?org=${encodeURIComponent(orgId)}` +
        (runId ? `&run=${encodeURIComponent(runId)}` : "")
    ),
  draftAnswers: async (
    orgId: string,
    items: { case_id: string; question: string; expected?: string | null }[],
    runId?: string
  ): Promise<DraftResponse> => {
    const res = await fetch("/api/evals/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org_id: orgId, items, run_id: runId }),
    });
    if (!res.ok) throw new Error(`draft → ${res.status}`);
    return res.json();
  },
  draftEstimate: async (
    orgId: string,
    items: { case_id: string; question: string; expected?: string | null }[]
  ): Promise<DraftEstimate> => {
    const res = await fetch("/api/evals/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org_id: orgId, items, dry_run: true }),
    });
    if (!res.ok) throw new Error(`draft estimate → ${res.status}`);
    return res.json();
  },
  saveDraftEdit: async (
    orgId: string,
    runId: string,
    caseId: string,
    editedAnswer: string | null
  ): Promise<{ saved: boolean }> => {
    const res = await fetch("/api/evals/draft/edit", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        org_id: orgId,
        run_id: runId,
        case_id: caseId,
        edited_answer: editedAnswer,
      }),
    });
    if (!res.ok) throw new Error(`save edit → ${res.status}`);
    return res.json();
  },
  estimate: async (
    orgId: string,
    tier: RunTier,
    maxTurns: number,
    caseIds: string[],
    variantNums?: number[]
  ): Promise<EstimateResponse> => {
    const res = await fetch("/api/evals/estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        org_id: orgId,
        tier,
        max_turns: maxTurns,
        case_ids: caseIds,
        variant_nums: variantNums,
      }),
    });
    if (!res.ok) throw new Error(`estimate → ${res.status}`);
    return res.json();
  },
  startRun: async (
    orgId: string,
    tier: RunTier,
    maxTurns?: number,
    caseIds?: string[],
    variantNums?: number[]
  ): Promise<{ run_id: string; status: string }> => {
    const res = await fetch("/api/evals/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        org_id: orgId,
        tier,
        max_turns: maxTurns,
        case_ids: caseIds,
        variant_nums: variantNums,
      }),
    });
    if (!res.ok) throw new Error(`start run → ${res.status}`);
    return res.json();
  },
};
