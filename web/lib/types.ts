// Types mirroring the SPEC.md database schema and API responses.
// When Supabase is wired in, these map 1:1 onto eval_orgs / eval_runs / eval_results.

export type RunTier = "kb" | "pathway" | "both";
export type RunStatus = "queued" | "running" | "completed" | "failed";

export interface EvalOrg {
  org_id: string;
  org_name: string;
  bland_pathway_id: string;
  bland_kb_id: string | null;
  is_active: boolean;
}

export interface EvalRun {
  run_id: string;
  org_id: string;
  run_tier: RunTier;
  status: RunStatus;
  total_cases: number;
  passed_cases: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
  /** Grader model this run used, recorded so historical spend stays
   * attributable after the org's model setting changes. */
  judge_model?: string | null;
}

// --- grader model + cost ------------------------------------------------------

export interface JudgeModel {
  id: string;
  name: string;
  /** USD per token. */
  prompt_price: number;
  completion_price: number;
  context_length: number;
  /** Artificial Analysis intelligence index, when OpenRouter publishes one.
   * The only quality signal available; absent for most models. */
  intelligence: number | null;
  /** Estimated USD to grade one full run of the selected org's suite. */
  est_cost_per_run: number;
  is_free: boolean;
}

export interface ModelCatalogue {
  org_id: string;
  selected: string;
  is_default: boolean;
  default_model: string;
  /** How the estimate was built, so the number is not a black box. */
  estimate_basis: {
    graded_calls: number;
    est_prompt_tokens: number;
    est_completion_tokens_per_call: number;
  };
  models: JudgeModel[];
}

export interface CostSummary {
  total_cost: number;
  total_runs: number;
  total_graded_calls: number;
  by_org: { org_id: string; runs: number; cost: number }[];
  by_model: { judge_model: string; calls: number; cost: number }[];
  runs: {
    run_id: string;
    org_id: string;
    run_tier: string;
    created_at: string;
    judge_model: string | null;
    graded_calls: number;
    cost: number;
    prompt_tokens: number;
    completion_tokens: number;
  }[];
}

export interface Exchange {
  user: string;
  assistant: string;
  node?: string | null;
}

export type NoteType = "advisory" | "hard_gate" | "judge" | "error";

export interface ResultNote {
  type: NoteType;
  message: string;
}

export interface EvalResult {
  id: string;
  run_id: string;
  org_id: string;
  case_id: string;
  case_name: string;
  category: string;
  variant_num: number;
  tier: "kb" | "pathway";
  question: string;
  answer: string;
  passed: boolean;
  notes: ResultNote[];
  chat_id: string | null;
  exchanges: Exchange[];
  created_at: string;
  /** Grader spend for this result. Zero for KB-tier rows, which never call an
   * LLM. Read from OpenRouter's usage block, not estimated. */
  judge_model?: string | null;
  judge_cost?: number;
  judge_prompt_tokens?: number;
  judge_completion_tokens?: number;
}

// --- test case catalogue (read-only view of <org>/evals/cases.json) ---------

export interface GraderSummary {
  type: string;
  any?: string[];
  all?: string[];
  pattern?: string;
  flags?: string;
  scope?: string;
  description?: string;
}

export interface TestCaseSummary {
  id: string;
  name: string;
  category: string;
  application: string | null;
  expected: string;
  kb_expect: string[] | null;
  variants: { turns: string[]; plan?: string }[];
  graders: GraderSummary[];
  /** Tiers this case actually runs on, after `untestable` exclusions. */
  tiers: ("kb" | "pathway")[];
  untestable_reason: string | null;
  /** True when this case has a saved grader prompt override. */
  grader_prompt_customised: boolean;
}

export interface GraderPrompt {
  org_id: string;
  case_id: string;
  /** The template that will actually be used to grade this case. */
  effective: string;
  /** The shared default, for the reset action and for diffing. */
  default: string;
  is_default: boolean;
  placeholders: { token: string; label: string }[];
  /** What each placeholder resolves to for this case, so the editor can show
   * the values rather than just the slot names. `conversation` is a stand-in:
   * the real transcript only exists once a run has happened. */
  values: {
    org: string;
    today: string;
    expected: string;
    ground_truth: string;
    conversation: string;
  };
  /** The template with `values` substituted — the prompt the judge would
   * receive for this case, minus the real transcript. */
  rendered: string;
}

export interface OrgCases {
  org_id: string;
  org_name: string;
  total_cases: number;
  pathway_runs: number;
  kb_checks: number;
  cases: TestCaseSummary[];
}

export interface RunStatusResponse {
  run_id: string;
  status: RunStatus;
  total_cases: number;
  passed_cases: number;
  completed_cases: number;
}

export interface CompareEntry {
  case_id: string;
  case_name: string;
  variant_num: number;
  tier: "kb" | "pathway";
}

export interface CompareResult {
  run_a: string;
  run_b: string;
  new_passes: CompareEntry[];
  regressions: CompareEntry[];
  stable: CompareEntry[];
}
