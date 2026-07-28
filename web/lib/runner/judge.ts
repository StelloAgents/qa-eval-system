// TypeScript port of the grading logic from eval.py: deterministic graders
// (contains / forbidden / forbidden_regex / payment_due) plus the LLM judge
// via OpenRouter. Keep behavior aligned with eval.py — SPEC.md success
// criterion: "Results match what Texans eval script would return."

import { Exchange, ResultNote } from "../types";
import { nowString, post } from "./bland";

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";
/** Default grader model. Cheap, deterministic at temperature 0, and what
 * eval.py used — per-org overrides are stored in org_settings. */
export const DEFAULT_JUDGE_MODEL = "deepseek/deepseek-chat";

/** What one judge call actually cost, read from OpenRouter's usage block
 * rather than estimated, so spend tracking reflects real billing. */
export interface JudgeUsage {
  model: string;
  cost: number;
  prompt_tokens: number;
  completion_tokens: number;
}

export interface TestVariant {
  turns: string[];
  plan?: string;
}

export interface TestCase {
  id: string;
  scenario_id?: string;
  name: string;
  category: string;
  /** Optional finer-grained label than category (e.g. "Outlook mobile"). */
  application?: string;
  expected: string;
  kb_expect?: string[];
  variants: TestVariant[];
  graders?: {
    type: string;
    any?: string[];
    all?: string[];
    pattern?: string;
    /** RegExp flags for forbidden_regex; omitted means case-sensitive, as in eval.py. */
    flags?: string;
    scope?: string;
    /** Plain-language statement of what this grader enforces. Display only —
     * grading ignores it. Without one, the UI can only show a raw pattern. */
    description?: string;
  }[];
  untestable?: { tier: string; reason: string };
}

// --- payment schedule (deterministic; do NOT delegate this to the judge) ---
// Payments fall on the 15th of each month, except February's on the 13th.
// 4-month plan runs Feb-May (final deadline May 15).
// 8-month plan runs Feb-Sep (final deadline Sep 15).
const PLAN_MONTHS: Record<string, number[]> = {
  "4": [2, 3, 4, 5],
  "8": [2, 3, 4, 5, 6, 7, 8, 9],
};
const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Next due (month, day) for a plan, or null if the plan is fully paid up.
 * A payment due *today* still counts as the next one. */
function nextPayment(plan: string, today: Date): [number, number] | null {
  for (const m of PLAN_MONTHS[plan] ?? []) {
    const d = m === 2 ? 13 : 15;
    const tm = today.getMonth() + 1;
    const td = today.getDate();
    if (tm < m || (tm === m && td <= d)) return [m, d];
  }
  return null;
}

function gradePaymentDue(
  plan: string | undefined,
  answer: string,
  today: Date
): [boolean, string] {
  const low = answer.toLowerCase();
  if (plan) {
    const nxt = nextPayment(plan, today);
    if (!nxt) {
      const ok = ["paid up", "fully paid", "all paid", "paid in full", "all set"].some(
        (s) => low.includes(s)
      );
      return [ok, ok ? "" : `${plan}-month plan is fully paid up; agent did not say so`];
    }
    const [m, d] = nxt;
    const want = `${MONTH_NAMES[m].toLowerCase()} ${d}`;
    if (low.includes(want)) return [true, ""];
    return [false, `expected next due ${MONTH_NAMES[m]} ${d}; not stated`];
  }

  // No plan named: the agent must never present a date that has already passed
  // as the *upcoming* one. Checked per sentence, not across the whole answer --
  // naming a past date is correct when flagged as already passed.
  const pastMarkers = [
    "paid up", "fully paid", "all paid", "paid in full", "all set",
    "deadline was", "was back on", "already passed", "has passed",
    "final deadline", "ran through", "runs february through may",
  ];
  const tm = today.getMonth() + 1;
  const td = today.getDate();
  const stale: string[] = [];
  for (let m = 2; m <= 9; m++) {
    const d = m === 2 ? 13 : 15;
    if (m > tm || (m === tm && d >= td)) continue;
    const token = `${MONTH_NAMES[m].toLowerCase()} ${d}`;
    for (const sent of low.split(/(?<=[.!?])\s+|,\s+(?=if\b)/)) {
      if (sent.includes(token) && !pastMarkers.some((p) => sent.includes(p))) {
        stale.push(`${MONTH_NAMES[m]} ${d}`);
        break;
      }
    }
  }
  if (stale.length) return [false, `cites past date(s) as upcoming: ${stale}`];
  return [true, ""];
}

// --- LLM judge ----------------------------------------------------------------

/** The grader prompt every case uses unless it has been overridden.
 *
 * Placeholders are filled at grade time by renderJudgePrompt(). Editing this
 * template changes grading for every case that has not been customised, so the
 * wording is deliberately conservative — it encodes the pass/fail contract from
 * SPEC.md, not any one org's subject matter.
 *
 * {{ground_truth}} expands to the whole labelled block (or nothing), so a
 * template that keeps it inline reads correctly whether or not deterministic
 * ground truth was computed for the case. */
export const DEFAULT_JUDGE_TEMPLATE = `You grade a customer-service voice agent for {{org}}.

EXPECTED OUTCOME describes the ground truth for this caller intent. Decide whether the agent handled the caller's actual question correctly.

PASS if:
- The agent conveys the parts of the expected outcome that are relevant to what the caller actually asked. Paraphrase is fine; judge substance, not wording.
- The agent adds extra context that is plausible and does not contradict the expected outcome. Additional accurate detail is good service, not a failure.
- The agent omits parts of the expected outcome the caller did not ask about. (If the caller asks only about away games, the agent need not also recite the policy for home games.)
- The agent offers to transfer/connect to a human where the expected outcome says to, even if worded differently.

FAIL if:
- The agent contradicts the expected outcome.
- The agent fabricates a specific commitment the expected outcome does not support: an exact date, dollar amount, deadline, or eligibility requirement. This is the most serious failure. It is especially a failure when the expected outcome says the answer depends on the caller's account or should be handled by a human, and the agent answers with a concrete specific instead.
- The agent says it does not know, or deflects, when the expected outcome shows it should have been able to answer.
- The caller's question squarely calls for several enumerated points and the agent gives only some of them.

TODAY'S DATE IS: {{today}}

{{ground_truth}}EXPECTED OUTCOME:
{{expected}}

ACTUAL CONVERSATION:
{{conversation}}

Reply with ONLY compact JSON: {"pass": true|false, "reason": "<one short sentence>"}`;

/** Placeholders a grader template may use, for the editor's legend. */
export const JUDGE_PLACEHOLDERS = [
  { token: "{{org}}", label: "Organisation name" },
  { token: "{{today}}", label: "Today's date, as the agent hears it" },
  { token: "{{expected}}", label: "This case's expected outcome" },
  { token: "{{conversation}}", label: "The transcript being graded" },
  { token: "{{ground_truth}}", label: "Computed ground truth block, if any" },
] as const;

export interface JudgeVars {
  org: string;
  today: string;
  expected: string;
  conversation: string;
  groundTruth: string | null;
}

export function renderJudgePrompt(template: string, v: JudgeVars): string {
  const groundTruthBlock = v.groundTruth
    ? `VERIFIED GROUND TRUTH (already computed -- trust this over your own arithmetic):\n${v.groundTruth}\n\n`
    : "";
  // Replacement values are injected literally: a `$&` or `$1` inside a
  // transcript would otherwise be interpreted as a replacement pattern.
  const map: Record<string, string> = {
    org: v.org,
    today: v.today,
    expected: v.expected,
    conversation: v.conversation,
    ground_truth: groundTruthBlock,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    key in map ? map[key] : whole
  );
}

async function judge(
  expected: string,
  exchanges: Exchange[],
  groundTruth: string | null,
  openrouterKey: string,
  orgName: string,
  template: string,
  model: string,
  usageOut: { current?: JudgeUsage }
): Promise<[boolean | null, string]> {
  const convo = exchanges.map((e) => `Caller: ${e.user}\nAgent: ${e.assistant}`).join("\n");
  const prompt = renderJudgePrompt(template, {
    org: orgName,
    today: nowString(),
    expected,
    conversation: convo,
    groundTruth,
  });

  const d = await post(
    OPENROUTER_API,
    {
      model,
      temperature: 0,
      // Reasoning tokens are billed against max_tokens, so a reasoning model
      // can spend the entire budget thinking and return an empty or truncated
      // body. Measured on deepseek-v4-flash (default effort "high"): 107-179 of
      // 200 tokens went to reasoning and 3 of 5 calls came back unparseable.
      // Grading wants a one-line verdict, not chain-of-thought — and disabling
      // it is cheaper and faster besides.
      reasoning: { enabled: false },
      // Headroom for a model that ignores "compact" and writes a long reason.
      // Typical use is ~35 tokens, so this costs effectively nothing.
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
      // Ask OpenRouter to include the billed cost alongside token counts.
      usage: { include: true },
    },
    { authorization: `Bearer ${openrouterKey}` }
  );
  const u = d?.usage ?? {};
  usageOut.current = {
    model: (d?.model as string) ?? model,
    cost: Number(u.cost ?? 0) || 0,
    prompt_tokens: Number(u.prompt_tokens ?? 0) || 0,
    completion_tokens: Number(u.completion_tokens ?? 0) || 0,
  };
  const choice = d?.choices?.[0];
  const raw = ((choice?.message?.content as string) ?? "").trim();
  const finish = choice?.finish_reason as string | undefined;

  const m = raw.match(/\{.*\}/s);
  if (m) {
    try {
      const v = JSON.parse(m[0]);
      return [!!v.pass, String(v.reason ?? "").slice(0, 200)];
    } catch {
      // Fall through to the salvage path below — a truncated object still
      // parses as text even when JSON.parse rejects it.
    }
  }

  // Salvage a verdict from a reply that was cut off mid-object. Better to
  // record what the judge decided than to fail the case on a formatting slip.
  const pass = raw.match(/"pass"\s*:\s*(true|false)/i);
  if (pass) {
    const reason = raw.match(/"reason"\s*:\s*"([^"]*)/i);
    return [
      pass[1].toLowerCase() === "true",
      `${(reason?.[1] ?? "reply truncated").slice(0, 200)}${finish === "length" ? " [truncated]" : ""}`,
    ];
  }

  // Nothing usable. Report why, since an empty body and a chatty non-JSON body
  // have very different causes (token budget vs the model ignoring the format).
  const why =
    finish === "length"
      ? "hit the token limit"
      : raw
        ? "no JSON in reply"
        : "empty reply";
  return [null, `unparseable judge reply (${why}, finish=${finish}): ${raw.slice(0, 120)}`];
}

/** The ground-truth lines fed to the judge as {{ground_truth}}, derived from a
 * case's own deterministic graders. Pure and side-effect free so the UI can
 * preview exactly what a case will send without running anything — grade()
 * calls this same function, so preview and grading cannot drift apart.
 *
 * `today` is injectable purely so callers can render a stable preview; grading
 * always passes the real current date. */
export function buildGroundTruth(
  testCase: TestCase,
  variant: TestVariant | undefined,
  today: Date = new Date()
): string[] {
  const truth: string[] = [];
  for (const g of testCase.graders ?? []) {
    if (g.type === "contains") {
      const want = g.any ?? g.all ?? [];
      truth.push(
        `The answer is expected to convey one of these, in any wording: ${JSON.stringify(want)}`
      );
    } else if (g.type === "payment_due") {
      const plan = variant?.plan;
      if (plan) {
        const nxt = nextPayment(plan, today);
        truth.push(
          `The caller is on the ${plan}-month plan. Computed from today, ` +
            (nxt
              ? `their next payment is ${MONTH_NAMES[nxt[0]]} ${nxt[1]}.`
              : "their plan is FULLY PAID UP (its final deadline has passed).") +
            " An answer naming any other date is wrong."
        );
      } else {
        const parts = (["4", "8"] as const).map((p) => {
          const n = nextPayment(p, today);
          return `${p}-month plan: ${n ? `${MONTH_NAMES[n[0]]} ${n[1]}` : "fully paid up"}`;
        });
        truth.push(
          `The caller did not say which plan they are on. Computed from today -- ${parts.join("; ")}. ` +
            "Naming a date that has already passed as the UPCOMING payment is wrong; " +
            "referring to a past date as already paid is correct."
        );
      }
    }
  }
  return truth;
}

// --- grade one run ------------------------------------------------------------
// The LLM judge is AUTHORITATIVE for pass/fail. Deterministic checks play two
// supporting roles and do not override it:
//   - `contains` / `payment_due` are ADVISORY (they feed ground truth to the
//     judge and report in the notes, but never fail a run the judge passed).
//   - `forbidden` / `forbidden_regex` are HARD GATES. The asymmetry with
//     `contains` is deliberate: "must not say X" is objectively checkable.

export async function grade(
  testCase: TestCase,
  exchanges: Exchange[],
  variant: TestVariant | undefined,
  openrouterKey: string,
  orgName: string,
  /** Per-case grader prompt override; falls back to the shared default. */
  template: string = DEFAULT_JUDGE_TEMPLATE,
  /** Per-org grader model override; falls back to the built-in default. */
  model: string = DEFAULT_JUDGE_MODEL
): Promise<{ ok: boolean; notes: ResultNote[]; usage?: JudgeUsage }> {
  const answers = exchanges.map((e) => e.assistant).join(" ");
  const low = answers.toLowerCase();
  let ok = true;
  const notes: ResultNote[] = [];
  // Shared with the prompt preview so the judge and the UI can never disagree
  // about what {{ground_truth}} contains.
  const truth = buildGroundTruth(testCase, variant);

  for (const g of testCase.graders ?? []) {
    if (g.type === "contains") {
      if (g.any && !g.any.some((s) => low.includes(s.toLowerCase()))) {
        notes.push({ type: "advisory", message: `none of ${JSON.stringify(g.any)} present verbatim` });
      }
      if (g.all) {
        const miss = g.all.filter((s) => !low.includes(s.toLowerCase()));
        if (miss.length) {
          notes.push({ type: "advisory", message: `missing verbatim ${JSON.stringify(miss)}` });
        }
      }
    } else if (g.type === "payment_due") {
      const [good, note] = gradePaymentDue(variant?.plan, answers, new Date());
      if (!good) notes.push({ type: "advisory", message: note });
    } else if (g.type === "forbidden") {
      const hit = (g.any ?? []).filter((s) => low.includes(s.toLowerCase()));
      if (hit.length) {
        ok = false;
        notes.push({ type: "hard_gate", message: `LEAKED ${JSON.stringify(hit)}` });
      }
    } else if (g.type === "forbidden_regex" && g.pattern) {
      const scope =
        g.scope === "last_turn" ? exchanges[exchanges.length - 1]?.assistant ?? "" : answers;
      const m = scope.match(new RegExp(g.pattern, g.flags ?? ""));
      if (m) {
        ok = false;
        notes.push({ type: "hard_gate", message: `forbidden pattern matched '${m[0]}'` });
      }
    }
  }

  const usageOut: { current?: JudgeUsage } = {};
  const [verdict, reason] = await judge(
    testCase.expected,
    exchanges,
    truth.length ? truth.join("\n") : null,
    openrouterKey,
    orgName,
    template,
    model,
    usageOut
  );
  if (verdict === null) {
    ok = false;
    notes.push({ type: "error", message: `judge error: ${reason}` });
  } else if (!verdict) {
    ok = false;
    notes.push({ type: "judge", message: reason });
  }

  return { ok, notes, usage: usageOut.current };
}
