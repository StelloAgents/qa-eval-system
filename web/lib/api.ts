import {
  CompareResult,
  EvalOrg,
  EvalResult,
  CostSummary,
  EvalRun,
  GraderPrompt,
  ModelCatalogue,
  OrgCases,
  RunStatusResponse,
  RunTier,
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
  startRun: async (
    orgId: string,
    tier: RunTier,
    maxTurns?: number
  ): Promise<{ run_id: string; status: string }> => {
    const res = await fetch("/api/evals/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org_id: orgId, tier, max_turns: maxTurns }),
    });
    if (!res.ok) throw new Error(`start run → ${res.status}`);
    return res.json();
  },
};
