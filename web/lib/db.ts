import "./env";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  CompareEntry,
  CompareResult,
  EvalOrg,
  EvalResult,
  EvalRun,
} from "./types";

// SQLite implementation of the SPEC.md schema (eval_orgs / eval_runs /
// eval_results). Column names match the spec; SQLite types stand in for
// Postgres types until the Supabase migration. Run IDs double as PKs
// (spec uses UUIDs; we store the id in run_id for readability).

const globalForDb = globalThis as unknown as { __qaEvalDb?: Database.Database };

// next dev/start run with cwd = web/, so the file lands in web/data (gitignored).
const DATA_DIR = process.env.QA_EVAL_DATA_DIR ?? path.resolve(process.cwd(), "data");

function open(): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, "qa-eval.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS eval_orgs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL UNIQUE,
      org_name TEXT NOT NULL,
      bland_pathway_id TEXT NOT NULL,
      bland_api_key_env TEXT NOT NULL,
      bland_kb_id TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS eval_runs (
      run_id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES eval_orgs(org_id),
      run_tier TEXT NOT NULL,
      status TEXT NOT NULL,
      total_cases INTEGER NOT NULL DEFAULT 0,
      passed_cases INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      completed_at TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS eval_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES eval_runs(run_id),
      org_id TEXT NOT NULL,
      case_id TEXT NOT NULL,
      case_name TEXT,
      category TEXT,
      variant_num INTEGER,
      tier TEXT,
      question TEXT,
      answer TEXT,
      passed INTEGER NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '[]',
      chat_id TEXT,
      exchanges TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_results_run ON eval_results(run_id);
    CREATE INDEX IF NOT EXISTS idx_runs_org ON eval_runs(org_id, created_at DESC);
  `);
  return db;
}

// Lazy singleton: route modules are imported during `next build` page-data
// collection, which must not open (or lock) the database file.
function getDb(): Database.Database {
  const db = (globalForDb.__qaEvalDb ??= open());
  seedOrgs(db);
  return db;
}

// --- seed -------------------------------------------------------------------
// Org config per SPEC.md §Org Onboarding. The Texans row carries the real
// pathway/KB IDs (from the repo README); its API key lives in the env var
// named by bland_api_key_env — never in the DB. Compugen is a placeholder
// until its pathway exists, so it stays inactive.

let seeded = false;
export function seedOrgs(db: Database.Database) {
  if (seeded) return;
  seeded = true;
  const insert = db.prepare(`
    INSERT INTO eval_orgs (id, org_id, org_name, bland_pathway_id, bland_api_key_env, bland_kb_id, is_active)
    VALUES (@id, @org_id, @org_name, @bland_pathway_id, @bland_api_key_env, @bland_kb_id, @is_active)
    ON CONFLICT(org_id) DO NOTHING
  `);
  insert.run({
    id: crypto.randomUUID(),
    org_id: "texans",
    org_name: "Houston Texans",
    bland_pathway_id: "513c8d58-4499-4801-9d05-c84dbf30a740",
    bland_api_key_env: "BLAND_API_KEY_TEXANS",
    bland_kb_id: "KB-0b66eefe-6f48-4891-b905-2126f720c89e",
    is_active: 1,
  });
  insert.run({
    id: crypto.randomUUID(),
    org_id: "compugen",
    org_name: "Compugen",
    bland_pathway_id: "7a1f2c90-3b4e-4d21-9c8f-1e2a3b4c5d6e",
    bland_api_key_env: "BLAND_API_KEY_COMPUGEN",
    bland_kb_id: "KB-9d4c2a11-8f3b-4c7e-b2a1-5f6e7d8c9b0a",
    is_active: 0,
  });
}

// --- row mapping -------------------------------------------------------------

interface OrgRow {
  id: string;
  org_id: string;
  org_name: string;
  bland_pathway_id: string;
  bland_api_key_env: string;
  bland_kb_id: string | null;
  is_active: number;
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
    is_active: !!r.is_active,
    bland_api_key_env: r.bland_api_key_env,
  };
}

function toResult(r: any): EvalResult {
  return {
    ...r,
    passed: !!r.passed,
    notes: JSON.parse(r.notes ?? "[]"),
    exchanges: JSON.parse(r.exchanges ?? "[]"),
  };
}

// --- queries used by the API routes ------------------------------------------

export function listOrgs(): StoredOrg[] {
  const rows = getDb()
    .prepare("SELECT * FROM eval_orgs ORDER BY org_name")
    .all() as OrgRow[];
  return rows.map(toOrg);
}

export function getOrg(orgId: string): StoredOrg | undefined {
  const row = getDb()
    .prepare("SELECT * FROM eval_orgs WHERE org_id = ?")
    .get(orgId) as OrgRow | undefined;
  return row && toOrg(row);
}

/** PUT /api/orgs/:org_id (SPEC.md). Only the two mutable fields are settable;
 * pathway/KB ids are seeded config, and the API key itself never touches the
 * DB — bland_api_key_env only names the env var that holds it. */
export function updateOrg(
  orgId: string,
  patch: { bland_api_key_env?: string; is_active?: boolean }
): StoredOrg | undefined {
  if (!getOrg(orgId)) return undefined;
  getDb()
    .prepare(`
      UPDATE eval_orgs SET
        bland_api_key_env = COALESCE(@bland_api_key_env, bland_api_key_env),
        is_active = COALESCE(@is_active, is_active),
        updated_at = datetime('now')
      WHERE org_id = @org_id
    `)
    .run({
      org_id: orgId,
      bland_api_key_env: patch.bland_api_key_env ?? null,
      is_active: patch.is_active === undefined ? null : patch.is_active ? 1 : 0,
    });
  return getOrg(orgId);
}

export function createRun(run: EvalRun) {
  // created_at is written explicitly (not left to the column's datetime('now')
  // default): SQLite emits UTC as "YYYY-MM-DD HH:MM:SS" with no zone marker,
  // which `new Date()` in the UI reads as *local* time and renders hours off.
  getDb().prepare(`
    INSERT INTO eval_runs (run_id, org_id, run_tier, status, total_cases, passed_cases, started_at, created_at)
    VALUES (@run_id, @org_id, @run_tier, @status, @total_cases, @passed_cases, @started_at, @created_at)
  `).run(run);
}

export function setRunStatus(
  runId: string,
  status: string,
  extra: Partial<Pick<EvalRun, "total_cases" | "completed_at" | "error_message">> = {}
) {
  getDb().prepare(`
    UPDATE eval_runs SET status = @status,
      total_cases = COALESCE(@total_cases, total_cases),
      completed_at = COALESCE(@completed_at, completed_at),
      error_message = COALESCE(@error_message, error_message)
    WHERE run_id = @run_id
  `).run({
    run_id: runId,
    status,
    total_cases: extra.total_cases ?? null,
    completed_at: extra.completed_at ?? null,
    error_message: extra.error_message ?? null,
  });
}

export function insertResult(r: EvalResult) {
  const db = getDb();
  db.prepare(`
    INSERT INTO eval_results
      (id, run_id, org_id, case_id, case_name, category, variant_num, tier,
       question, answer, passed, notes, chat_id, exchanges, created_at)
    VALUES
      (@id, @run_id, @org_id, @case_id, @case_name, @category, @variant_num, @tier,
       @question, @answer, @passed, @notes, @chat_id, @exchanges, @created_at)
  `).run({
    ...r,
    passed: r.passed ? 1 : 0,
    notes: JSON.stringify(r.notes),
    exchanges: JSON.stringify(r.exchanges),
  });
  // Keep the run's passed count current so polling shows live progress.
  db.prepare(
    "UPDATE eval_runs SET passed_cases = passed_cases + ? WHERE run_id = ?"
  ).run(r.passed ? 1 : 0, r.run_id);
}

export function listRuns(orgId: string, limit = 10): EvalRun[] {
  return getDb()
    .prepare(
      "SELECT * FROM eval_runs WHERE org_id = ? ORDER BY created_at DESC LIMIT ?"
    )
    .all(orgId, limit) as EvalRun[];
}

export function getRun(runId: string): EvalRun | undefined {
  return getDb().prepare("SELECT * FROM eval_runs WHERE run_id = ?").get(runId) as
    | EvalRun
    | undefined;
}

export function getResults(runId: string): EvalResult[] {
  const rows = getDb()
    .prepare("SELECT * FROM eval_results WHERE run_id = ? ORDER BY created_at")
    .all(runId);
  return rows.map(toResult);
}

export function getCompletedCount(runId: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM eval_results WHERE run_id = ?")
    .get(runId) as { n: number };
  return row.n;
}

export function orgHasActiveRun(orgId: string): boolean {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS n FROM eval_runs WHERE org_id = ? AND status IN ('queued','running')"
    )
    .get(orgId) as { n: number };
  return row.n > 0;
}

export function compareRuns(runAId: string, runBId: string): CompareResult | null {
  const a = getResults(runAId);
  const b = getResults(runBId);
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
