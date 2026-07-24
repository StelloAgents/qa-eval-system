# KB Regression Testing System — Simplified Spec

**Version**: 1.0  
**Date**: 2026-07-24  
**Status**: Scoped down to core regression testing only

---

## Mission

**Ensure KB behavior stays consistent across agent versions.** 

Manual regression testing that answers one question: *"When we change the prompt, KB, or pathway, do the answers still hold up?"*

Two-tier evaluation (like existing Texans system):
1. **KB Tier**: Does the KB return the expected content?
2. **Pathway Tier**: Does the agent, using that KB content, answer correctly?

No live call processing. No daily workflows. No email alerts. Just: *Does the KB answer the test scenarios correctly?*

---

## What's Included

✅ Test scenario runner (per-org test cases)  
✅ Two-tier evaluation (KB retrieval + pathway response)  
✅ Manual trigger ("Run Evals" button)  
✅ Per-org API keys (Bland pathway + API key)  
✅ Simple web UI to view results  
✅ Store results in DB for history  

## What's NOT Included

❌ Live call processing  
❌ Daily cron/scheduled runs  
❌ Email alerts  
❌ Issue resolution workflow  
❌ Regression pattern tracking  
❌ Grading prompt evolution  

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│ Web UI (Next.js)                                │
│ • Org selector dropdown                         │
│ • Run Evals button (manual trigger)             │
│ • Results table (pass/fail per test case)       │
│ • Run history & comparison                      │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│ Backend (Node/Vercel Functions)                │
│ • Org config loader (pathway ID, API key)       │
│ • KB retrieval tier runner                      │
│ • Pathway tier runner (agent via Bland API)    │
│ • LLM judge grader                              │
│ • Result storage (Supabase)                     │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│ Supabase (source of truth)                      │
│ • eval_orgs (org config: pathway ID, KB ID)     │
│ • eval_runs (one per manual trigger)            │
│ • eval_results (per test case result)           │
└─────────────────────────────────────────────────┘
```

---

## Database Schema

### `eval_orgs` — Org configuration

```sql
CREATE TABLE eval_orgs (
  id UUID PRIMARY KEY,
  org_id TEXT NOT NULL UNIQUE,  -- "texans", "compugen", etc.
  org_name TEXT NOT NULL,
  
  -- Bland integration
  bland_pathway_id TEXT NOT NULL,
  bland_api_key_env TEXT NOT NULL,  -- e.g., 'BLAND_API_KEY_TEXANS'
  bland_kb_id TEXT,  -- optional, for KB-tier testing
  
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### `eval_runs` — One run per manual trigger

```sql
CREATE TABLE eval_runs (
  id UUID PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES eval_orgs(org_id),
  run_tier TEXT NOT NULL,  -- 'kb' | 'pathway' | 'both'
  status TEXT NOT NULL,  -- 'queued' | 'running' | 'completed' | 'failed'
  
  total_cases INT,
  passed_cases INT,
  
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  error_message TEXT,
  
  created_at TIMESTAMP DEFAULT NOW()
);
```

### `eval_results` — One per test case per run

```sql
CREATE TABLE eval_results (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES eval_runs(id),
  org_id TEXT NOT NULL REFERENCES eval_orgs(org_id),
  
  -- Test case identity
  case_id TEXT NOT NULL,
  case_name TEXT,
  variant_num INT,  -- v1, v2, v3
  
  -- Execution
  tier TEXT,  -- 'kb' or 'pathway'
  question TEXT,
  answer TEXT,
  
  -- Grading
  passed BOOLEAN,
  notes JSONB,  -- [{type: "advisory"|"hard_gate", message: "..."}]
  
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Test Case Format

Each org stores test cases in their repo (like Texans already does):

```
texans/evals/cases.json
compugen/evals/cases.json
```

Format is **identical to existing Texans**:

```json
[
  {
    "id": "mascot",
    "scenario_id": "uuid-...",
    "name": "Team Mascot",
    "category": "Team Knowledge",
    "expected": "Agent should respond 'Toro, the blue bull mascot'",
    "kb_expect": ["Toro", "blue bull"],
    "variants": [
      {"turns": ["Who's the team mascot?"]},
      {"turns": ["What's your mascot's name?"]},
      {"turns": ["Is there a mascot? What's it called?"]}
    ],
    "graders": [
      {"type": "contains", "any": ["Toro", "toro"]},
      {"type": "judge"}
    ]
  }
]
```

**Grader types:**
- `contains` (advisory): substring must appear verbatim
- `forbidden` (hard gate): if these strings appear, fail
- `judge` (authoritative): LLM judge decides pass/fail

---

## Workflow

### 1. Click "Run Evals" button on the dashboard

1. User selects org (dropdown)
2. User selects tier: "KB only" | "Pathway only" | "Both"
3. User clicks "Run Evals"

### 2. Backend executes

**For each test case in `<org>/evals/cases.json`:**

**KB Tier (if selected):**
```
POST /v1/knowledge/chat
  knowledge_base_id: org.bland_kb_id
  question: variant.turns[-1]
  
Check if expected content appears in response
Store result
```

**Pathway Tier (if selected):**
```
POST /v1/pathway/chat/create
  pathway_id: org.bland_pathway_id
  
POST /v1/pathway/chat/{chat_id}
  message: "hello"  (consume greeting)
  
For each turn in variant.turns:
  POST /v1/pathway/chat/{chat_id}
    message: turn
    
Collect all agent responses
Run LLM judge against expected outcome
Store result
```

### 3. Store results in DB

Create one `eval_run` record.
Create one `eval_result` per case per tier.

### 4. Display on dashboard

Show:
- Pass/fail per test case
- Pass rate (%)
- Run history (last 10 runs)
- Diff vs. previous run (which tests regressed?)

---

## Frontend Pages

### 1. Dashboard

```
[Org Selector Dropdown]  [Run Evals Button ⚙️]

Status: Idle | Running (23/45 tests) | Completed

Last Run: 2026-07-24 14:32 UTC
  Results: 42/45 passed (93.3%)
  
Compare with: [Previous Run ▼]
  ✅ 42 passed
  ❌ 3 regressed:
    - mascot#v2 (was ✅)
    - payment-due#v1 (was ✅)
    - transfer-routing#v3 (was ✅)

[View Full Results Table]
```

### 2. Results Table

```
Case ID | Variant | Tier | Question | Pass | Notes | Chat ID
--------|---------|------|----------|------|-------|--------
mascot | v1 | pathway | "Who's the mascot?" | ✅ | | chat_123
mascot | v2 | pathway | "What's your mascot?" | ❌ | Judge: Agent said "Taurus" not "Toro" | chat_124
mascot | v3 | pathway | "Tell me about the mascot" | ✅ | | chat_125
...
```

(Clickable rows show transcript + flags)

### 3. Run History

```
Date | Tier | Total | Passed | Rate | Actions
-----|------|-------|--------|------|--------
2026-07-24 14:32 | both | 45 | 42 | 93.3% | View | Compare
2026-07-24 10:15 | pathway | 45 | 45 | 100% | View | Compare
2026-07-23 15:45 | kb | 45 | 44 | 97.8% | View | Compare
...
```

---

## API Endpoints

### Manual Trigger

```
POST /api/evals/run
  Body: { org_id, tier: "kb" | "pathway" | "both" }
  Response: { run_id, status: "queued" }
```

### Poll Status

```
GET /api/evals/run/:run_id
  Response: { status, total_cases, passed_cases, results: [...] }
```

### View Results

```
GET /api/evals/run/:run_id/results
  Response: [{ case_id, variant_num, tier, passed, notes, answer, question }]
```

### Compare Runs

```
GET /api/evals/runs/:org_id?limit=10
  Response: [{ run_id, tier, total, passed, created_at }]

GET /api/evals/compare/:run_id_a/:run_id_b
  Response: { 
    new_passes: [],
    regressions: [{case_id, variant, was_pass, now_pass}],
    stable: []
  }
```

### Org Config

```
GET /api/orgs/:org_id
  Response: { org_name, bland_pathway_id, bland_kb_id, is_active }

PUT /api/orgs/:org_id
  Body: { bland_api_key_env, is_active }
```

---

## Org Onboarding

### 1. Create Org Config

```sql
INSERT INTO eval_orgs (org_id, org_name, bland_pathway_id, bland_kb_id, bland_api_key_env)
VALUES ('compugen', 'Compugen', 'pathway-uuid', 'kb-uuid', 'BLAND_API_KEY_COMPUGEN');
```

### 2. Add Test Cases

Create: `compugen/evals/cases.json` (same format as Texans)

### 3. Set Bland API Key in Vercel

```bash
vercel env add BLAND_API_KEY_COMPUGEN production < <(echo -n "org_...")
```

### 4. Done

Click "Run Evals" on the dashboard for that org.

---

## Implementation Roadmap

### Phase 1: Core (Week 1)
- [ ] Supabase schema (eval_orgs, eval_runs, eval_results)
- [ ] Org config table + loader
- [ ] Bland API client (pathway + KB tiers)
- [ ] LLM judge grader (reuse Texans logic)
- [ ] Manual trigger endpoint
- [ ] Basic web UI (selector + Run button)

### Phase 2: Display (Week 2)
- [ ] Results table (pass/fail)
- [ ] Run history
- [ ] Comparison view (last run vs. current run)
- [ ] Full transcript viewer (clickable rows)

### Phase 3: Polish (Week 3)
- [ ] Keyboard shortcuts
- [ ] Export results as CSV
- [ ] Bulk run multiple orgs at once
- [ ] Dark/light theme

---

## Localized to Texans Eval Logic

This system reuses **all existing Texans eval code**:
- `pathway_run()` — Bland pathway chat with greeting consumption
- `kb_chat()` — KB retrieval tier
- `grade()` — Grader logic (contains, forbidden, judge)
- `judge()` — LLM judge via OpenRouter
- `grade_payment_due()` — Deterministic payment-date checks (Texans-specific)
- Test case format (Texans `cases.json` structure)

**Nothing new to learn. This is just:**
1. Extract the Python script into TypeScript functions
2. Add a web UI
3. Make it multi-org (org selector, per-org API keys, per-org test cases)
4. Store results instead of writing JSON/markdown reports
5. Add a results dashboard

---

## Why This Works

✅ **No live calls** — just test scenarios (already proven)  
✅ **No daily workflows** — manual trigger only (user controls when)  
✅ **No email alerts** — results visible on dashboard (push model, not pull)  
✅ **Multi-org ready** — org config table + per-org test cases  
✅ **Low scope** — reuses all Texans eval logic  
✅ **Fast to build** — no complex workflows or state machines  

---

## Success Criteria

1. **Functional**: Can click "Run Evals" and get results
2. **Multi-org**: Texans + Compugen both work via same UI
3. **Accurate**: Results match what Texans eval script would return
4. **Usable**: Can see pass/fail per test case + comparison to previous run
5. **Fast**: Full run completes in <5 minutes for 50 test cases
