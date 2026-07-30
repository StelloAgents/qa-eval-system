-- Drafted answers for KB questions that came back unanswered.
--
-- These cost real money to generate (one batched LLM call per 8 questions,
-- each carrying the whole KB document), so they must survive a page reload.
-- Keyed by (org_id, run_id, case_id): one draft per question per run, which
-- makes re-drafting an idempotent upsert rather than a duplicate.
--
-- edited_answer is deliberately separate from answer. The model's draft stays
-- intact so "revert to draft" keeps working after a reload, and a null edit
-- means "not touched by a human yet" — which is the distinction the review
-- workflow is built on.

create table if not exists qa_eval.kb_drafts (
  org_id        text not null,
  run_id        uuid not null references qa_eval.eval_runs(run_id) on delete cascade,
  case_id       text not null,
  question      text not null,
  -- drafted | unverified | no_source | error
  status        text not null,
  answer        text not null default '',
  -- The KB sentence the model quoted, verified against the file before storing.
  source        text not null default '',
  note          text,
  -- The user's wording, when they have edited it. Null = untouched.
  edited_answer text,
  model         text,
  -- Spend attributed to the batch that produced this row, divided evenly across
  -- it: per-question cost is not separable from a batched call.
  cost          double precision not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (org_id, run_id, case_id)
);

create index if not exists idx_kb_drafts_run on qa_eval.kb_drafts (org_id, run_id);

-- The app connects as qa_eval_app, which has USAGE on the schema but not
-- CREATE, so it cannot grant these to itself — this must run as the owner.
grant select, insert, update, delete on qa_eval.kb_drafts to qa_eval_app;
