# QA Eval System

Automated regression testing and quality evaluation for multi-org AI customer service agents.

## What This Does

Tests KB behavior and agent responses against a suite of test scenarios. Catches regressions when prompts, knowledge bases, or pathways change.

**Two-tier testing:**
1. **KB Tier** — Does the knowledge base return expected content for a query?
2. **Pathway Tier** — Does the agent answer correctly using that KB content?

## Quick Start

### Prerequisites

- Python 3.8+
- Bland API key(s)
- KB ID (for KB tier testing)
- Pathway ID (for pathway tier testing)

### Run Evals

```bash
python eval.py \
  --org houston-texans \
  --pathway-id "513c8d58-4499-4801-9d05-c84dbf30a740" \
  --kb-id "KB-0b66eefe-6f48-4891-b905-2126f720c89e" \
  --bland-api-key "sk-bland-..." \
  --tier both \
  --reps 2
```

**Output:**
- `houston-texans/evals/results/run-YYYY-MM-DDTHH-mm-ss.md` — human-readable report
- `houston-texans/evals/results/run-YYYY-MM-DDTHH-mm-ss.json` — raw results

## Project Structure

```
.
├── README.md                    ← this file
├── SPEC.md                      ← system design document
├── eval.py                      ← main eval harness
├── <org>/
│   ├── evals/
│   │   ├── cases.json          ← test scenarios (format below)
│   │   └── results/
│   │       ├── run-*.md        ← latest report
│   │       └── run-*.json      ← raw data
│   └── kb-entries.md           ← knowledge base content reference
```

## Test Case Format

Each org stores test cases in `<org>/evals/cases.json`:

```json
[
  {
    "id": "mascot",
    "name": "Team Mascot",
    "category": "Team Knowledge",
    "kb_expect": ["Toro", "blue bull"],
    "expected": "Agent should respond with mascot name and description",
    "variants": [
      {"turns": ["Who's the team mascot?"]},
      {"turns": ["What's your mascot's name?"]},
      {"turns": ["Tell me about the mascot"]}
    ],
    "graders": [
      {"type": "contains", "any": ["Toro", "toro"]},
      {"type": "forbidden", "any": ["I don't know"]},
      {"type": "judge"}
    ]
  }
]
```

**Grader Types:**
- `contains` — substring match (advisory, doesn't fail alone)
- `forbidden` — if any of these appear, fail (hard gate)
- `judge` — LLM judge decides pass/fail (authoritative)

## Grading Logic

Each test runs through graders in order:

1. **Advisory checks** (`contains`, `payment_due`) — flag warnings but don't fail
2. **Hard gates** (`forbidden`, `forbidden_regex`) — fail if triggered
3. **LLM judge** (`judge`) — authoritative pass/fail via OpenRouter API

A test passes only if:
- All hard gates pass
- AND LLM judge passes

## Understanding Non-Determinism

The same query sometimes returns different KB results or agent responses. The system detects this by running each test variant multiple times (default: 2 reps).

**Reported as:**
```
Non-deterministic intents: alcohol-cutoff, training-camp, opt-out
```

If a test passes 2/3 times, it's logged but doesn't fail the suite. Investigate with:
```bash
python eval.py ... --reps 5  # Run 5 times instead of default
```

## Environment Variables

Create a `.env` file (or set in shell):

```
BLAND_API_KEY_TEXANS=sk-bland-...
BLAND_API_KEY_COMPUGEN=sk-bland-...
OPENROUTER_API_KEY=sk-or-...  # for LLM judge
```

Or pass via CLI flags.

## Adding a New Organization

1. Create the org folder:
   ```bash
   mkdir -p <org>/evals/results
   ```

2. Add test cases:
   ```bash
   cp houston-texans/evals/cases.json <org>/evals/cases.json
   # Edit for your org's scenarios
   ```

3. Run evals:
   ```bash
   python eval.py \
     --org <org> \
     --pathway-id "..." \
     --kb-id "..." \
     --bland-api-key "sk-bland-..."
   ```

## Web UI

A Next.js dashboard for running evals and browsing results lives in `web/`
(dark theme, Tailwind + shadcn/ui). It runs **live**: clicking "Run Evals"
executes the same two-tier eval as `eval.py` against the real Bland and
OpenRouter APIs (`web/lib/runner/`) and stores every result.

```bash
cd web
npm install
npm run dev    # http://localhost:3000
```

The dashboard reads the same repo-root `.env` as `eval.py`, so no separate
config is needed. Per-org keys are resolved through the org's
`bland_api_key_env` column (e.g. `BLAND_API_KEY_TEXANS`), falling back to
`BLAND_API_KEY`.

### Storage

Results persist to SQLite at `web/data/qa-eval.db` (gitignored, created on
first use) using the exact `eval_orgs` / `eval_runs` / `eval_results` schema
from SPEC.md, so the Supabase migration is a driver swap in `web/lib/db.ts`.
Org config is seeded on first run; Compugen ships inactive until its pathway
exists.

Runs execute in the background of the Node server and the UI polls for
progress. That works for `next dev`/`next start`; a serverless deploy needs a
queue instead (see SPEC.md roadmap).

### API routes

All routes mirror SPEC.md §API Endpoints:

| Route | Purpose |
|---|---|
| `POST /api/evals/run` | trigger a run — `{ org_id, tier }` |
| `GET /api/evals/run/:id` | poll status + live progress |
| `GET /api/evals/run/:id/results` | per-case results |
| `GET /api/evals/runs/:org?limit=` | run history |
| `GET /api/evals/compare/:a/:b` | regressions vs. baseline A |
| `GET /api/orgs`, `GET /api/orgs/:org` | org config (never returns keys) |
| `PUT /api/orgs/:org` | `{ bland_api_key_env?, is_active? }` |
| `GET /api/orgs/:org/cases` | the org's test case catalogue |

Pages:
- **Dashboard** (`/`) — org selector, tier picker, Run Evals button with live
  progress, last-run summary, regression comparison vs. previous run, category
  breakdown, recent runs.
- **Test cases** (`/cases`) — every scenario the selected org is graded on:
  expected outcome, all prompt phrasings, KB assertions, and which graders
  apply. Read live from `<org>/evals/cases.json`, so it cannot drift from what
  the runner actually executes. Searchable by prompt text.
- **Run results** (`/runs/[runId]`) — filterable pass/fail table; click a row
  for the full transcript and grader notes.
- **Run history** (`/history`) — last 10 runs per org with two-run compare.

## Architecture

```
┌─────────────────────────────────┐
│ eval.py                         │
│ • Reads test cases              │
│ • Runs KB tier (if --kb-id)     │
│ • Runs pathway tier             │
│ • Grades with LLM judge         │
│ • Outputs JSON + markdown       │
└─────────────────────────────────┘
```

**Bland API:**
- `POST /v1/knowledge/chat` — query KB directly
- `POST /v1/pathway/chat/create` — start pathway conversation
- `POST /v1/pathway/chat/{id}` — send message to pathway

**LLM Judge:**
- Uses OpenRouter API (DeepSeek model by default)
- Structured prompt: "Does this answer match the expected outcome?"
- Returns: `{"pass": true/false, "reason": "..."}`

## Reports

### Markdown Report (`run-*.md`)

```
Pathway tier: 24 intents x variants x 3 rep(s) = 222 runs

PASS team-mascot#v1  Team Mascot
FAIL alcohol-cutoff#v3  Alcohol Cutoff Time  ← [advisory] warning; judge: Agent didn't provide...

=== 216/222 runs passed (97.3%) ===
Non-deterministic intents: alcohol-cutoff, training-camp
```

### JSON Report (`run-*.json`)

```json
{
  "org": "houston-texans",
  "tier": "pathway",
  "cases": 24,
  "variants_per_case": 3,
  "reps": 2,
  "total_runs": 222,
  "passed": 216,
  "pass_rate": 0.973,
  "results": [
    {
      "case_id": "mascot",
      "variant": 1,
      "rep": 1,
      "passed": true,
      "question": "Who's the team mascot?",
      "answer": "Toro is the team mascot...",
      "chat_id": "chat_abc123"
    }
  ]
}
```

## Troubleshooting

### "Bland 'check your twilio account' error"

Usually means invalid pathway ID, not Twilio. Check `--pathway-id` first.

### Non-deterministic failures

Same question, different answer. Run with more reps to see the pattern:
```bash
python eval.py ... --reps 5
```

Then check the KB content and agent prompt.

### "OPENROUTER_API_KEY not set"

The LLM judge needs an OpenRouter key. Get one at https://openrouter.ai and set it:
```bash
export OPENROUTER_API_KEY="sk-or-..."
```

### Results vary between runs

This is normal for LLM grading. The judge may interpret edge cases differently. Use `judge` graders only for high-level intent; use `contains` / `forbidden` for strict requirements.

## Further Reading

- **SPEC.md** — Full system design, roadmap, database schema
- **`<org>/kb-entries.md`** — Knowledge base content (reference)
- **`<org>/evals/cases.json`** — Test scenarios for your org

## License

Internal Stello tool.
