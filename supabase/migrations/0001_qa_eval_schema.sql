-- QA eval system schema.
--
-- Lives in a dedicated `qa_eval` schema rather than `public`: the target
-- Supabase project is production for another application, so this keeps the
-- two sets of tables from colliding and makes the whole thing droppable in one
-- statement if it ever moves to its own project.
--
-- Mirrors SPEC.md (eval_orgs / eval_runs / eval_results) plus the two tables
-- added since: grader_prompts and org_settings. Timestamps are timestamptz
-- rather than the text SQLite stored, which removes a whole class of
-- timezone bug the SQLite version had to work around by hand.

create schema if not exists qa_eval;

-- --- org configuration -------------------------------------------------------
-- The Bland API key itself is never stored: bland_api_key_env names the
-- environment variable that holds it.

create table if not exists qa_eval.eval_orgs (
  id                 uuid primary key default gen_random_uuid(),
  org_id             text not null unique,
  org_name           text not null,
  bland_pathway_id   text not null,
  bland_api_key_env  text not null,
  bland_kb_id        text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- --- runs --------------------------------------------------------------------

create table if not exists qa_eval.eval_runs (
  run_id        uuid primary key,
  org_id        text not null references qa_eval.eval_orgs(org_id),
  run_tier      text not null check (run_tier in ('kb', 'pathway', 'both')),
  status        text not null check (status in ('queued', 'running', 'completed', 'failed')),
  total_cases   integer not null default 0,
  passed_cases  integer not null default 0,
  started_at    timestamptz,
  completed_at  timestamptz,
  error_message text,
  -- Pinned per run so historical spend stays attributable after an org
  -- changes its grader model.
  judge_model   text,
  created_at    timestamptz not null default now()
);

-- --- results -----------------------------------------------------------------
-- One row per case per tier per variant. judge_* columns carry the real cost
-- OpenRouter reported for that call; KB-tier rows never call an LLM and stay
-- at zero.

create table if not exists qa_eval.eval_results (
  id                      text primary key,
  run_id                  uuid not null references qa_eval.eval_runs(run_id) on delete cascade,
  org_id                  text not null,
  case_id                 text not null,
  case_name               text,
  category                text,
  variant_num             integer,
  tier                    text check (tier in ('kb', 'pathway')),
  question                text,
  answer                  text,
  passed                  boolean not null default false,
  notes                   jsonb not null default '[]'::jsonb,
  chat_id                 text,
  exchanges               jsonb not null default '[]'::jsonb,
  judge_model             text,
  judge_cost              double precision not null default 0,
  judge_prompt_tokens     integer not null default 0,
  judge_completion_tokens integer not null default 0,
  created_at              timestamptz not null default now()
);

create index if not exists idx_results_run on qa_eval.eval_results (run_id);
create index if not exists idx_runs_org    on qa_eval.eval_runs (org_id, created_at desc);
-- Cost reporting groups by model over rows that actually cost something.
create index if not exists idx_results_cost on qa_eval.eval_results (judge_model)
  where judge_cost > 0;

-- --- grader configuration ----------------------------------------------------
-- Absence means "use the built-in default", for both tables. Reset deletes the
-- row rather than storing a copy of the default, so a case or org keeps
-- tracking the default as it evolves.

create table if not exists qa_eval.grader_prompts (
  org_id     text not null,
  case_id    text not null,
  template   text not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, case_id)
);

create table if not exists qa_eval.org_settings (
  org_id      text primary key,
  judge_model text not null,
  updated_at  timestamptz not null default now()
);

-- --- seed --------------------------------------------------------------------
-- Matches the SQLite seed. Compugen stays inactive until its real pathway
-- exists; the id below is a placeholder.

insert into qa_eval.eval_orgs (org_id, org_name, bland_pathway_id, bland_api_key_env, bland_kb_id, is_active)
values
  ('texans',   'Houston Texans', '513c8d58-4499-4801-9d05-c84dbf30a740', 'BLAND_API_KEY_TEXANS',   'KB-0b66eefe-6f48-4891-b905-2126f720c89e', true),
  ('compugen', 'Compugen',       '7a1f2c90-3b4e-4d21-9c8f-1e2a3b4c5d6e', 'BLAND_API_KEY_COMPUGEN', 'KB-9d4c2a11-8f3b-4c7e-b2a1-5f6e7d8c9b0a', false)
on conflict (org_id) do nothing;
