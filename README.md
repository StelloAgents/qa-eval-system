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
