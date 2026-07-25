import {
  CompareResult,
  EvalOrg,
  EvalResult,
  EvalRun,
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

export const api = {
  listOrgs: () => getJson<EvalOrg[]>("/api/orgs"),
  getOrg: (orgId: string) => getJson<EvalOrg>(`/api/orgs/${orgId}`),
  getOrgCases: (orgId: string) => getJson<OrgCases>(`/api/orgs/${orgId}/cases`),
  listRuns: (orgId: string, limit = 10) =>
    getJson<EvalRun[]>(`/api/evals/runs/${orgId}?limit=${limit}`),
  getRun: (runId: string) => getJson<RunStatusResponse>(`/api/evals/run/${runId}`),
  getRunResults: (runId: string) =>
    getJson<EvalResult[]>(`/api/evals/run/${runId}/results`),
  compare: (runA: string, runB: string) =>
    getJson<CompareResult>(`/api/evals/compare/${runA}/${runB}`),
  startRun: async (orgId: string, tier: RunTier): Promise<{ run_id: string; status: string }> => {
    const res = await fetch("/api/evals/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org_id: orgId, tier }),
    });
    if (!res.ok) throw new Error(`start run → ${res.status}`);
    return res.json();
  },
};
