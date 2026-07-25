// TypeScript port of the grading logic from eval.py: deterministic graders
// (contains / forbidden / forbidden_regex / payment_due) plus the LLM judge
// via OpenRouter. Keep behavior aligned with eval.py — SPEC.md success
// criterion: "Results match what Texans eval script would return."

import { Exchange, ResultNote } from "../types";
import { nowString, post } from "./bland";

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";
const JUDGE_MODEL = "deepseek/deepseek-chat";

export interface TestVariant {
  turns: string[];
  plan?: string;
}

export interface TestCase {
  id: string;
  scenario_id?: string;
  name: string;
  category: string;
  expected: string;
  kb_expect?: string[];
  variants: TestVariant[];
  graders?: { type: string; any?: string[]; all?: string[]; pattern?: string; scope?: string }[];
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

async function judge(
  expected: string,
  exchanges: Exchange[],
  groundTruth: string | null,
  openrouterKey: string
): Promise<[boolean | null, string]> {
  const convo = exchanges.map((e) => `Caller: ${e.user}\nAgent: ${e.assistant}`).join("\n");
  const prompt =
    "You grade a customer-service voice agent for the Houston Texans.\n\n" +
    "EXPECTED OUTCOME describes the ground truth for this caller intent. Decide " +
    "whether the agent handled the caller's actual question correctly.\n\n" +
    "PASS if:\n" +
    "- The agent conveys the parts of the expected outcome that are relevant to " +
    "what the caller actually asked. Paraphrase is fine; judge substance, not wording.\n" +
    "- The agent adds extra context that is plausible and does not contradict the " +
    "expected outcome. Additional accurate detail is good service, not a failure.\n" +
    "- The agent omits parts of the expected outcome the caller did not ask about. " +
    "(If the caller asks only about away games, the agent need not also recite the " +
    "policy for home games.)\n" +
    "- The agent offers to transfer/connect to a human where the expected outcome " +
    "says to, even if worded differently.\n\n" +
    "FAIL if:\n" +
    "- The agent contradicts the expected outcome.\n" +
    "- The agent fabricates a specific commitment the expected outcome does not " +
    "support: an exact date, dollar amount, deadline, or eligibility requirement. " +
    "This is the most serious failure. It is especially a failure when the expected " +
    "outcome says the answer depends on the caller's account or should be handled " +
    "by a human, and the agent answers with a concrete specific instead.\n" +
    "- The agent says it does not know, or deflects, when the expected outcome shows " +
    "it should have been able to answer.\n" +
    "- The caller's question squarely calls for several enumerated points and the " +
    "agent gives only some of them.\n\n" +
    `TODAY'S DATE IS: ${nowString()}\n\n` +
    (groundTruth
      ? `VERIFIED GROUND TRUTH (already computed -- trust this over your own arithmetic):\n${groundTruth}\n\n`
      : "") +
    `EXPECTED OUTCOME:\n${expected}\n\n` +
    `ACTUAL CONVERSATION:\n${convo}\n\n` +
    'Reply with ONLY compact JSON: {"pass": true|false, "reason": "<one short sentence>"}';

  const d = await post(
    OPENROUTER_API,
    {
      model: JUDGE_MODEL,
      temperature: 0,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    },
    { authorization: `Bearer ${openrouterKey}` }
  );
  const raw = (d?.choices?.[0]?.message?.content as string ?? "").trim();
  const m = raw.match(/\{.*\}/s);
  if (!m) return [null, `unparseable judge reply: ${raw.slice(0, 120)}`];
  const v = JSON.parse(m[0]);
  return [!!v.pass, String(v.reason ?? "").slice(0, 200)];
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
  openrouterKey: string
): Promise<{ ok: boolean; notes: ResultNote[] }> {
  const answers = exchanges.map((e) => e.assistant).join(" ");
  const low = answers.toLowerCase();
  let ok = true;
  const notes: ResultNote[] = [];
  const truth: string[] = [];

  for (const g of testCase.graders ?? []) {
    if (g.type === "contains") {
      const want = g.any ?? g.all ?? [];
      truth.push(
        `The answer is expected to convey one of these, in any wording: ${JSON.stringify(want)}`
      );
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
      const plan = variant?.plan;
      const today = new Date();
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
      const [good, note] = gradePaymentDue(plan, answers, today);
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
      const m = scope.match(new RegExp(g.pattern));
      if (m) {
        ok = false;
        notes.push({ type: "hard_gate", message: `forbidden pattern matched '${m[0]}'` });
      }
    }
  }

  const [verdict, reason] = await judge(
    testCase.expected,
    exchanges,
    truth.length ? truth.join("\n") : null,
    openrouterKey
  );
  if (verdict === null) {
    ok = false;
    notes.push({ type: "error", message: `judge error: ${reason}` });
  } else if (!verdict) {
    ok = false;
    notes.push({ type: "judge", message: reason });
  }

  return { ok, notes };
}
