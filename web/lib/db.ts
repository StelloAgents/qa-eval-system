import "./env";
import { Pool } from "pg";
import {
  CompareEntry,
  CompareResult,
  EvalOrg,
  EvalResult,
  EvalRun,
} from "./types";

// Postgres (Supabase) implementation of the SPEC.md schema. Tables live in the
// `qa_eval` schema — the target project is production for another application,
// so this keeps our tables from colliding with the raw call data alongside it.
// DDL lives in supabase/migrations/0001_qa_eval_schema.sql and is applied out
// of band; this module only reads and writes.
//
// Everything here is async: better-sqlite3 was synchronous, and no synchronous
// Postgres driver exists. Call sites are all route handlers or the runner, so
// they were already async.

const SCHEMA = "qa_eval";

const globalForDb = globalThis as unknown as { __qaEvalPool?: Pool };

function pool(): Pool {
  if (globalForDb.__qaEvalPool) return globalForDb.__qaEvalPool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set — add the Supabase connection string to the repo-root .env"
    );
  }
  const p = new Pool({
    connectionString,
    // Supabase terminates TLS with its own CA; the pooler hostname does not
    // match the certificate, so verification is relaxed rather than disabled.
    ssl: { rejectUnauthorized: false },
    // The transaction pooler multiplexes, so a large local pool buys nothing
    // and just holds connections open.
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
  // A pool error (e.g. the pooler dropping an idle socket) is emitted on the
  // pool, not a query, and would otherwise crash the process.
  p.on("error", (e) => console.error("[db] idle client error:", e.message));
  globalForDb.__qaEvalPool = p;
  return p;
}

async function query<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool().query(text, params as any[]);
  return res.rows as T[];
}

async function one<T = any>(text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await query<T>(text, params))[0];
}

// --- row mapping -------------------------------------------------------------

interface OrgRow {
  org_id: string;
  org_name: string;
  bland_pathway_id: string;
  bland_api_key_env: string;
  bland_kb_id: string | null;
  is_active: boolean;
}

export interface StoredOrg extends EvalOrg {
  bland_api_key_env: string;
}

function toOrg(r: OrgRow): StoredOrg {
  return {
    org_id: r.org_id,
    org_name: r.org_name,
    bland_pathway_id: r.bland_pathway_id,
    bland_kb_id: r.bland_kb_id,
    is_active: r.is_active,
    bland_api_key_env: r.bland_api_key_env,
  };
}

/** Postgres returns timestamptz as a Date; the API and UI speak ISO strings. */
const iso = (v: Date | string | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : v;

function toRun(r: any): EvalRun {
  return {
    ...r,
    started_at: iso(r.started_at),
    completed_at: iso(r.completed_at),
    created_at: iso(r.created_at)!,
  };
}

function toResult(r: any): EvalResult {
  return {
    ...r,
    // jsonb comes back already parsed, unlike the TEXT columns SQLite used.
    notes: r.notes ?? [],
    exchanges: r.exchanges ?? [],
    created_at: iso(r.created_at)!,
    judge_cost: Number(r.judge_cost ?? 0),
  };
}

// --- orgs --------------------------------------------------------------------

export async function listOrgs(): Promise<StoredOrg[]> {
  const rows = await query<OrgRow>(
    `SELECT * FROM ${SCHEMA}.eval_orgs ORDER BY org_name`
  );
  return rows.map(toOrg);
}

export async function getOrg(orgId: string): Promise<StoredOrg | undefined> {
  const row = await one<OrgRow>(
    `SELECT * FROM ${SCHEMA}.eval_orgs WHERE org_id = $1`,
    [orgId]
  );
  return row && toOrg(row);
}

/** PUT /api/orgs/:org_id (SPEC.md). Only the two mutable fields are settable;
 * pathway/KB ids are seeded config, and the API key itself never touches the
 * DB — bland_api_key_env only names the env var that holds it. */
export async function updateOrg(
  orgId: string,
  patch: { bland_api_key_env?: string; is_active?: boolean }
): Promise<StoredOrg | undefined> {
  const row = await one<OrgRow>(
    `UPDATE ${SCHEMA}.eval_orgs SET
       bland_api_key_env = COALESCE($2, bland_api_key_env),
       is_active         = COALESCE($3, is_active),
       updated_at        = now()
     WHERE org_id = $1
     RETURNING *`,
    [orgId, patch.bland_api_key_env ?? null, patch.is_active ?? null]
  );
  return row && toOrg(row);
}

// --- grader model + cost -----------------------------------------------------

export async function getJudgeModel(orgId: string): Promise<string | undefined> {
  const row = await one<{ judge_model: string }>(
    `SELECT judge_model FROM ${SCHEMA}.org_settings WHERE org_id = $1`,
    [orgId]
  );
  return row?.judge_model;
}

export async function setJudgeModel(orgId: string, model: string): Promise<void> {
  await query(
    `INSERT INTO ${SCHEMA}.org_settings (org_id, judge_model, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (org_id) DO UPDATE SET judge_model = $2, updated_at = now()`,
    [orgId, model]
  );
}

export async function clearJudgeModel(orgId: string): Promise<void> {
  await query(`DELETE FROM ${SCHEMA}.org_settings WHERE org_id = $1`, [orgId]);
}

export interface RunCost {
  run_id: string;
  org_id: string;
  run_tier: string;
  created_at: string;
  judge_model: string | null;
  graded_calls: number;
  cost: number;
  prompt_tokens: number;
  completion_tokens: number;
}

/** Per-run spend. Only pathway results carry a judge cost; KB results are
 * substring checks and cost nothing, so they contribute zero rather than
 * being excluded (the call count stays honest that way). */
export async function listRunCosts(orgId?: string, limit = 100): Promise<RunCost[]> {
  const rows = await query<any>(
    `SELECT r.run_id, r.org_id, r.run_tier, r.created_at, r.judge_model,
            COUNT(*) FILTER (WHERE e.judge_cost > 0)         AS graded_calls,
            COALESCE(SUM(e.judge_cost), 0)                   AS cost,
            COALESCE(SUM(e.judge_prompt_tokens), 0)          AS prompt_tokens,
            COALESCE(SUM(e.judge_completion_tokens), 0)      AS completion_tokens
     FROM ${SCHEMA}.eval_runs r
     LEFT JOIN ${SCHEMA}.eval_results e ON e.run_id = r.run_id
     ${orgId ? "WHERE r.org_id = $2" : ""}
     GROUP BY r.run_id
     ORDER BY r.created_at DESC
     LIMIT $1`,
    orgId ? [limit, orgId] : [limit]
  );
  // Postgres returns COUNT/SUM as strings to preserve bigint/numeric precision.
  return rows.map((r) => ({
    ...r,
    created_at: iso(r.created_at)!,
    graded_calls: Number(r.graded_calls),
    cost: Number(r.cost),
    prompt_tokens: Number(r.prompt_tokens),
    completion_tokens: Number(r.completion_tokens),
  }));
}

export async function costByModel(): Promise<
  { judge_model: string; calls: number; cost: number }[]
> {
  const rows = await query<any>(
    `SELECT COALESCE(judge_model, 'unknown') AS judge_model,
            COUNT(*) AS calls, COALESCE(SUM(judge_cost), 0) AS cost
     FROM ${SCHEMA}.eval_results WHERE judge_cost > 0
     GROUP BY judge_model ORDER BY cost DESC`
  );
  return rows.map((r) => ({
    judge_model: r.judge_model,
    calls: Number(r.calls),
    cost: Number(r.cost),
  }));
}

export async function costByOrg(): Promise<
  { org_id: string; runs: number; cost: number }[]
> {
  const rows = await query<any>(
    `SELECT r.org_id, COUNT(DISTINCT r.run_id) AS runs,
            COALESCE(SUM(e.judge_cost), 0) AS cost
     FROM ${SCHEMA}.eval_runs r
     LEFT JOIN ${SCHEMA}.eval_results e ON e.run_id = r.run_id
     GROUP BY r.org_id ORDER BY cost DESC`
  );
  return rows.map((r) => ({
    org_id: r.org_id,
    runs: Number(r.runs),
    cost: Number(r.cost),
  }));
}

// --- grader prompt overrides -------------------------------------------------

/** The stored override for a case, or undefined when it uses the default. */
export async function getGraderPrompt(
  orgId: string,
  caseId: string
): Promise<string | undefined> {
  const row = await one<{ template: string }>(
    `SELECT template FROM ${SCHEMA}.grader_prompts WHERE org_id = $1 AND case_id = $2`,
    [orgId, caseId]
  );
  return row?.template;
}

/** Case ids for one org that have an override, for badging the catalogue
 * without a request per case. */
export async function listCustomisedCaseIds(orgId: string): Promise<Set<string>> {
  const rows = await query<{ case_id: string }>(
    `SELECT case_id FROM ${SCHEMA}.grader_prompts WHERE org_id = $1`,
    [orgId]
  );
  return new Set(rows.map((r) => r.case_id));
}

export async function setGraderPrompt(
  orgId: string,
  caseId: string,
  template: string
): Promise<void> {
  await query(
    `INSERT INTO ${SCHEMA}.grader_prompts (org_id, case_id, template, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (org_id, case_id)
     DO UPDATE SET template = $3, updated_at = now()`,
    [orgId, caseId, template]
  );
}

/** Reset to default. Deletes the row so the case tracks the default template. */
export async function clearGraderPrompt(
  orgId: string,
  caseId: string
): Promise<boolean> {
  const res = await pool().query(
    `DELETE FROM ${SCHEMA}.grader_prompts WHERE org_id = $1 AND case_id = $2`,
    [orgId, caseId]
  );
  return (res.rowCount ?? 0) > 0;
}

// --- runs and results --------------------------------------------------------

export async function createRun(run: EvalRun): Promise<void> {
  await query(
    `INSERT INTO ${SCHEMA}.eval_runs
       (run_id, org_id, run_tier, status, total_cases, passed_cases, started_at, created_at, judge_model)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      run.run_id,
      run.org_id,
      run.run_tier,
      run.status,
      run.total_cases,
      run.passed_cases,
      run.started_at,
      run.created_at,
      run.judge_model ?? null,
    ]
  );
}

export async function setRunStatus(
  runId: string,
  status: string,
  extra: Partial<Pick<EvalRun, "total_cases" | "completed_at" | "error_message">> = {}
): Promise<void> {
  await query(
    `UPDATE ${SCHEMA}.eval_runs SET
       status        = $2,
       total_cases   = COALESCE($3, total_cases),
       completed_at  = COALESCE($4, completed_at),
       error_message = COALESCE($5, error_message)
     WHERE run_id = $1`,
    [
      runId,
      status,
      extra.total_cases ?? null,
      extra.completed_at ?? null,
      extra.error_message ?? null,
    ]
  );
}

export async function insertResult(r: EvalResult): Promise<void> {
  await query(
    `INSERT INTO ${SCHEMA}.eval_results
       (id, run_id, org_id, case_id, case_name, category, variant_num, tier,
        question, answer, passed, notes, chat_id, exchanges, created_at,
        judge_model, judge_cost, judge_prompt_tokens, judge_completion_tokens)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14::jsonb,$15,$16,$17,$18,$19)`,
    [
      r.id,
      r.run_id,
      r.org_id,
      r.case_id,
      r.case_name,
      r.category,
      r.variant_num,
      r.tier,
      r.question,
      r.answer,
      r.passed,
      JSON.stringify(r.notes),
      r.chat_id,
      JSON.stringify(r.exchanges),
      r.created_at,
      r.judge_model ?? null,
      r.judge_cost ?? 0,
      r.judge_prompt_tokens ?? 0,
      r.judge_completion_tokens ?? 0,
    ]
  );
  // Keep the run's passed count current so polling shows live progress.
  await query(
    `UPDATE ${SCHEMA}.eval_runs SET passed_cases = passed_cases + $2 WHERE run_id = $1`,
    [r.run_id, r.passed ? 1 : 0]
  );
}

export async function listRuns(orgId: string, limit = 10): Promise<EvalRun[]> {
  const rows = await query<any>(
    `SELECT * FROM ${SCHEMA}.eval_runs WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [orgId, limit]
  );
  return rows.map(toRun);
}

export async function getRun(runId: string): Promise<EvalRun | undefined> {
  const row = await one<any>(
    `SELECT * FROM ${SCHEMA}.eval_runs WHERE run_id = $1`,
    [runId]
  );
  return row && toRun(row);
}

export async function getResults(runId: string): Promise<EvalResult[]> {
  const rows = await query<any>(
    `SELECT * FROM ${SCHEMA}.eval_results WHERE run_id = $1 ORDER BY created_at`,
    [runId]
  );
  return rows.map(toResult);
}

export async function getCompletedCount(runId: string): Promise<number> {
  const row = await one<{ n: string }>(
    `SELECT COUNT(*) AS n FROM ${SCHEMA}.eval_results WHERE run_id = $1`,
    [runId]
  );
  return Number(row?.n ?? 0);
}

/** Marks runs that have been queued or running for too long as failed.
 *
 * A serverless invocation killed at its duration limit leaves its row stuck in
 * `running` forever, and orgHasActiveRun would then block every future run for
 * that org with no way to clear it from the UI. Sweeping first means a stuck
 * run is self-healing rather than permanent. Returns how many it reaped. */
export async function reapStaleRuns(
  orgId: string,
  olderThanMinutes = 20
): Promise<number> {
  const res = await pool().query(
    `UPDATE ${SCHEMA}.eval_runs
        SET status = 'failed',
            completed_at = now(),
            error_message = COALESCE(error_message,
              'run did not finish — the process was likely stopped mid-run')
      WHERE org_id = $1
        AND status IN ('queued','running')
        AND started_at < now() - ($2 || ' minutes')::interval`,
    [orgId, String(olderThanMinutes)]
  );
  return res.rowCount ?? 0;
}

export async function orgHasActiveRun(orgId: string): Promise<boolean> {
  const row = await one<{ n: string }>(
    `SELECT COUNT(*) AS n FROM ${SCHEMA}.eval_runs
     WHERE org_id = $1 AND status IN ('queued','running')`,
    [orgId]
  );
  return Number(row?.n ?? 0) > 0;
}

export async function compareRuns(
  runAId: string,
  runBId: string
): Promise<CompareResult | null> {
  const [a, b] = await Promise.all([getResults(runAId), getResults(runBId)]);
  if (!a.length || !b.length) return null;

  const key = (r: EvalResult) => `${r.case_id}#${r.tier}#v${r.variant_num}`;
  const entry = (r: EvalResult): CompareEntry => ({
    case_id: r.case_id,
    case_name: r.case_name,
    variant_num: r.variant_num,
    tier: r.tier,
  });

  const aMap = new Map(a.map((r) => [key(r), r]));
  const newPasses: CompareEntry[] = [];
  const regressions: CompareEntry[] = [];
  const stable: CompareEntry[] = [];

  for (const rb of b) {
    const ra = aMap.get(key(rb));
    if (!ra) continue;
    if (ra.passed && !rb.passed) regressions.push(entry(rb));
    else if (!ra.passed && rb.passed) newPasses.push(entry(rb));
    else stable.push(entry(rb));
  }
  return { run_a: runAId, run_b: runBId, new_passes: newPasses, regressions, stable };
}
