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
