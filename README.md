# QA Eval System (archived)

This project was absorbed into
[bland-analytics](https://github.com/StelloAgents/bland-analytics) on 2026-07-31.

- UI: https://analytics.stelloagents.com/houston-texans/evals (internal sign-in)
- Tables: analytics.eval_* in the Bland Analytics Supabase project, keyed by organization UUID
- Test cases and KB docs live in the database (analytics.eval_cases / eval_kb_docs), not in git
- The qa_eval schema was copied and dropped by migration 20260731000200_eval_data_copy.sql

The full pre-merge history of this repo is preserved below this commit.
