import {
  CompareEntry,
  CompareResult,
  EvalOrg,
  EvalResult,
  EvalRun,
  RunTier,
} from "./types";

// ---------------------------------------------------------------------------
// Mock dataset. Shapes follow SPEC.md exactly (eval_orgs / eval_runs /
// eval_results) so these can be replaced by Supabase queries without touching
// the UI. Case content is modeled on the real Houston Texans eval suite in
// eval.py.
// ---------------------------------------------------------------------------

export const ORGS: EvalOrg[] = [
  {
    org_id: "texans",
    org_name: "Houston Texans",
    bland_pathway_id: "513c8d58-4499-4801-9d05-c84dbf30a740",
    bland_kb_id: "KB-0b66eefe-6f48-4891-b905-2126f720c89e",
    is_active: true,
  },
  {
    org_id: "compugen",
    org_name: "Compugen",
    bland_pathway_id: "7a1f2c90-3b4e-4d21-9c8f-1e2a3b4c5d6e",
    bland_kb_id: "KB-9d4c2a11-8f3b-4c7e-b2a1-5f6e7d8c9b0a",
    is_active: true,
  },
];

interface MockCase {
  id: string;
  name: string;
  category: string;
  /** One question per variant (v1..v3). */
  questions: string[];
  /** Canonical good answer, used in transcripts for passing results. */
  answer: string;
  /** Whether the case has kb_expect assertions (tested on the KB tier). */
  kb: boolean;
  kbAnswer?: string;
}

const TEXANS_CASES: MockCase[] = [
  {
    id: "mascot",
    name: "Team Mascot",
    category: "Team Knowledge",
    questions: [
      "Who's the team mascot?",
      "What's your mascot's name?",
      "Is there a mascot? What's it called?",
    ],
    answer:
      "That's Toro! He's the blue bull mascot — you'll see him at every home game firing up the crowd.",
    kb: true,
    kbAnswer:
      "Toro is the official mascot of the Houston Texans. He is a blue bull and appears at all home games and community events.",
  },
  {
    id: "payment-due",
    name: "Next Payment Due Date",
    category: "Payments",
    questions: [
      "When is my next payment due?",
      "What's the due date on my payment plan?",
      "When do I need to pay next?",
    ],
    answer:
      "Your next payment on the 4-month plan is due August 15th. Payments land on the 15th of each month.",
    kb: false,
  },
  {
    id: "transfer-routing",
    name: "Transfer to Membership Services",
    category: "Routing",
    questions: [
      "Can I talk to someone about my account?",
      "I need to speak with a human about billing.",
      "Transfer me to membership services please.",
    ],
    answer:
      "Absolutely — let me connect you with Membership Services right away. One moment please.",
    kb: false,
  },
  {
    id: "alcohol-cutoff",
    name: "Alcohol Cutoff Time",
    category: "Stadium Policy",
    questions: [
      "When do they stop serving beer at the stadium?",
      "What time is alcohol cutoff at NRG?",
      "How late can I buy a drink at the game?",
    ],
    answer:
      "Alcohol sales stop at the end of the third quarter at NRG Stadium.",
    kb: true,
    kbAnswer:
      "Alcohol sales at NRG Stadium end at the conclusion of the third quarter.",
  },
  {
    id: "training-camp",
    name: "Training Camp Dates",
    category: "Team Knowledge",
    questions: [
      "When does training camp start?",
      "What are the training camp dates this year?",
      "Has training camp been announced yet?",
    ],
    answer:
      "Training camp kicks off in late July — the first open practice is July 24th at the Houston Methodist Training Center.",
    kb: true,
    kbAnswer:
      "Houston Texans training camp opens July 24th at the Houston Methodist Training Center.",
  },
  {
    id: "season-tickets",
    name: "Season Ticket Pricing",
    category: "Tickets",
    questions: [
      "How much are season tickets?",
      "What do season tickets cost?",
      "Can you tell me season ticket prices?",
    ],
    answer:
      "Season ticket pricing depends on the section — I can get you over to our ticket team who has all the current options and pricing.",
    kb: false,
  },
  {
    id: "parking",
    name: "Stadium Parking",
    category: "Stadium Policy",
    questions: [
      "Where can I park at the stadium?",
      "How does parking work at NRG?",
      "Do I need a parking pass?",
    ],
    answer:
      "NRG Stadium has several lots around the complex. A prepaid parking pass is required — lots open four hours before kickoff.",
    kb: true,
    kbAnswer:
      "Parking at NRG Stadium requires a prepaid pass. Lots open four hours prior to kickoff.",
  },
  {
    id: "opt-out",
    name: "Payment Plan Opt-Out",
    category: "Payments",
    questions: [
      "Can I cancel my payment plan?",
      "How do I opt out of the payment plan?",
      "I want to stop my payment plan.",
    ],
    answer:
      "I can help with that — opting out of the plan needs to go through Membership Services, so let me connect you with them.",
    kb: false,
  },
];

const COMPUGEN_CASES: MockCase[] = [
  {
    id: "support-hours",
    name: "Support Hours",
    category: "Support",
    questions: [
      "What are your support hours?",
      "When is your help desk open?",
      "What time does support close?",
    ],
    answer:
      "Our support desk is available Monday through Friday, 8 AM to 6 PM Eastern.",
    kb: true,
    kbAnswer:
      "Compugen support operates Monday to Friday, 8:00 AM to 6:00 PM Eastern Time.",
  },
  {
    id: "billing-dispute",
    name: "Billing Dispute Routing",
    category: "Routing",
    questions: [
      "I have a problem with my invoice.",
      "There's a wrong charge on my bill.",
      "Who do I talk to about a billing issue?",
    ],
    answer:
      "I'm sorry about that — let me connect you with our billing team who can review the charge with you.",
    kb: false,
  },
  {
    id: "warranty",
    name: "Warranty Coverage",
    category: "Products",
    questions: [
      "Is my laptop still under warranty?",
      "What does the warranty cover?",
      "How long is the warranty period?",
    ],
    answer:
      "Standard hardware coverage is three years. I can check your specific device if you have the serial number handy.",
    kb: true,
    kbAnswer:
      "Compugen standard hardware warranty covers parts and labor for three years from date of purchase.",
  },
  {
    id: "escalation",
    name: "Escalate to Technician",
    category: "Routing",
    questions: [
      "I need a technician on site.",
      "Can someone come fix our server?",
      "This needs a field tech.",
    ],
    answer:
      "Understood — I'll escalate this to our field services team and they'll schedule an on-site visit.",
    kb: false,
  },
  {
    id: "password-reset",
    name: "Password Reset",
    category: "Support",
    questions: [
      "I forgot my password.",
      "How do I reset my password?",
      "I'm locked out of my account.",
    ],
    answer:
      "No problem — you can reset it from the login page with the 'Forgot password' link, or I can walk you through it now.",
    kb: true,
    kbAnswer:
      "Password resets are self-serve via the 'Forgot password' link on the client portal login page.",
  },
  {
    id: "order-status",
    name: "Order Status",
    category: "Orders",
    questions: [
      "Where's my order?",
      "Can you check on my shipment?",
      "Has my equipment shipped yet?",
    ],
    answer:
      "I can look into that — order tracking is tied to your account, so let me get you to our orders team who can pull it up.",
    kb: false,
  },
];

const CASES_BY_ORG: Record<string, MockCase[]> = {
  texans: TEXANS_CASES,
  compugen: COMPUGEN_CASES,
};

// --- failure fixtures ------------------------------------------------------
// What a regression looks like per case: the wrong answer, and the note the
// judge/advisory graders would attach.

interface FailureDetail {
  answer: string;
  note: { type: "judge" | "advisory" | "hard_gate"; message: string };
}

const FAILURE_DETAILS: Record<string, FailureDetail> = {
  mascot: {
    answer: "Our mascot is Taurus — he's the Texans' bull, you'll see him at home games!",
    note: { type: "judge", message: 'Agent said "Taurus" not "Toro"' },
  },
  "payment-due": {
    answer: "Your next payment on the 4-month plan is due May 15th.",
    note: {
      type: "judge",
      message: "Cites May 15 as upcoming, but it has passed; expected August 15",
    },
  },
  "transfer-routing": {
    answer: "I can probably help with account questions myself — what do you need?",
    note: {
      type: "judge",
      message: "Deflected instead of offering transfer to Membership Services",
    },
  },
  "alcohol-cutoff": {
    answer: "Alcohol is served right up until the end of the game.",
    note: {
      type: "judge",
      message: "Wrong cutoff — policy is end of the third quarter",
    },
  },
  "training-camp": {
    answer: "Training camp dates haven't been announced for this year yet.",
    note: {
      type: "judge",
      message: "Claimed dates unknown; camp opens July 24th",
    },
  },
  "season-tickets": {
    answer: "Season tickets start at $450 per seat for upper-level sections.",
    note: {
      type: "judge",
      message: "Fabricated a specific price; expected routing to the ticket team",
    },
  },
  parking: {
    answer: "There's free public parking all around NRG on game day.",
    note: {
      type: "judge",
      message: "Contradicts policy — a prepaid parking pass is required",
    },
  },
  "opt-out": {
    answer: "You can cancel the plan anytime right from your account settings online.",
    note: {
      type: "judge",
      message: "Fabricated self-serve cancellation; expected transfer to Membership Services",
    },
  },
  "support-hours": {
    answer: "Support is available 24/7, whenever you need us.",
    note: {
      type: "judge",
      message: "Contradicts documented hours (Mon–Fri 8 AM–6 PM ET)",
    },
  },
  "billing-dispute": {
    answer: "Billing charges are final once the invoice is issued.",
    note: {
      type: "hard_gate",
      message: "forbidden phrase matched: 'charges are final'",
    },
  },
  warranty: {
    answer: "All devices come with a lifetime warranty.",
    note: {
      type: "judge",
      message: "Fabricated lifetime coverage; standard warranty is three years",
    },
  },
  escalation: {
    answer: "Have you tried restarting the server? That usually fixes it.",
    note: {
      type: "judge",
      message: "Ignored explicit escalation request; no field-visit offered",
    },
  },
  "password-reset": {
    answer: "You'll need to come into the office to reset your password.",
    note: {
      type: "judge",
      message: "Contradicts self-serve reset via the client portal",
    },
  },
  "order-status": {
    answer: "Your order shipped yesterday and arrives tomorrow.",
    note: {
      type: "judge",
      message: "Fabricated tracking specifics tied to no account data",
    },
  },
};

const NODE_BY_CATEGORY: Record<string, string> = {
  "Team Knowledge": "KB Lookup",
  Payments: "Payment Info",
  Routing: "Transfer Node",
  "Stadium Policy": "KB Lookup",
  Tickets: "Ticket Sales",
  Support: "KB Lookup",
  Products: "KB Lookup",
  Orders: "Order Lookup",
};

// --- run plans -------------------------------------------------------------
// Failure keys: "caseId#vN" for pathway results, "caseId#kb" for KB results.

interface RunPlan {
  run_id: string;
  tier: RunTier;
  created_at: string;
  failures: string[];
}

const RUN_PLANS: Record<string, RunPlan[]> = {
  texans: [
    // Most recent first. The latest run regressed mascot#v2, payment-due#v1,
    // transfer-routing#v3 vs. the previous clean run — this is what the
    // dashboard comparison card shows.
    { run_id: "run-txn-008", tier: "both", created_at: "2026-07-24T14:32:00Z",
      failures: ["mascot#v2", "payment-due#v1", "transfer-routing#v3"] },
    { run_id: "run-txn-007", tier: "pathway", created_at: "2026-07-24T10:15:00Z", failures: [] },
    { run_id: "run-txn-006", tier: "kb", created_at: "2026-07-23T15:45:00Z", failures: [] },
    { run_id: "run-txn-005", tier: "both", created_at: "2026-07-23T09:02:00Z",
      failures: ["training-camp#v2", "alcohol-cutoff#kb"] },
    { run_id: "run-txn-004", tier: "pathway", created_at: "2026-07-22T16:40:00Z",
      failures: ["opt-out#v1", "parking#v3", "season-tickets#v2", "payment-due#v2"] },
    { run_id: "run-txn-003", tier: "both", created_at: "2026-07-21T11:20:00Z",
      failures: ["parking#v2"] },
    { run_id: "run-txn-002", tier: "pathway", created_at: "2026-07-20T14:05:00Z",
      failures: ["season-tickets#v1"] },
    { run_id: "run-txn-001", tier: "both", created_at: "2026-07-18T10:00:00Z",
      failures: ["mascot#v1", "mascot#v3", "training-camp#v1", "opt-out#v2"] },
  ],
  compugen: [
    { run_id: "run-cpg-004", tier: "both", created_at: "2026-07-24T13:10:00Z",
      failures: ["billing-dispute#v2"] },
    { run_id: "run-cpg-003", tier: "pathway", created_at: "2026-07-23T10:30:00Z", failures: [] },
    { run_id: "run-cpg-002", tier: "both", created_at: "2026-07-22T09:15:00Z",
      failures: ["warranty#v3", "support-hours#kb"] },
    { run_id: "run-cpg-001", tier: "kb", created_at: "2026-07-21T15:00:00Z", failures: [] },
  ],
};

// --- builders ---------------------------------------------------------------

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function buildRunAndResults(
  orgId: string,
  plan: RunPlan
): { run: EvalRun; results: EvalResult[] } {
  const cases = CASES_BY_ORG[orgId];
  const failureSet = new Set(plan.failures);
  const results: EvalResult[] = [];
  const start = new Date(plan.created_at).getTime();
  let seq = 0;

  const makeChatId = () =>
    `chat_${hashString(plan.run_id + seq).toString(36).padStart(6, "0")}`;

  if (plan.tier !== "kb") {
    for (const c of cases) {
      c.questions.forEach((question, vi) => {
        const key = `${c.id}#v${vi + 1}`;
        const failed = failureSet.has(key);
        const fd = failed ? FAILURE_DETAILS[c.id] : undefined;
        seq++;
        results.push({
          id: `${plan.run_id}-${seq}`,
          run_id: plan.run_id,
          org_id: orgId,
          case_id: c.id,
          case_name: c.name,
          category: c.category,
          variant_num: vi + 1,
          tier: "pathway",
          question,
          answer: fd?.answer ?? c.answer,
          passed: !failed,
          notes: fd
            ? [fd.note]
            : [],
          chat_id: makeChatId(),
          exchanges: [
            {
              user: question,
              assistant: fd?.answer ?? c.answer,
              node: NODE_BY_CATEGORY[c.category] ?? "KB Lookup",
            },
          ],
          created_at: new Date(start + seq * 4000).toISOString(),
        });
      });
    }
  }

  if (plan.tier !== "pathway") {
    for (const c of cases.filter((c) => c.kb)) {
      const key = `${c.id}#kb`;
      const failed = failureSet.has(key);
      seq++;
      results.push({
        id: `${plan.run_id}-${seq}`,
        run_id: plan.run_id,
        org_id: orgId,
        case_id: c.id,
        case_name: c.name,
        category: c.category,
        variant_num: 1,
        tier: "kb",
        question: c.questions[0],
        answer: failed ? "No relevant content found in knowledge base." : c.kbAnswer!,
        passed: !failed,
        notes: failed
          ? [{ type: "advisory", message: "missing expected KB content" }]
          : [],
        chat_id: null,
        exchanges: [],
        created_at: new Date(start + seq * 4000).toISOString(),
      });
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const run: EvalRun = {
    run_id: plan.run_id,
    org_id: orgId,
    run_tier: plan.tier,
    status: "completed",
    total_cases: results.length,
    passed_cases: passed,
    started_at: plan.created_at,
    completed_at: new Date(start + results.length * 4000).toISOString(),
    error_message: null,
    created_at: plan.created_at,
  };
  return { run, results };
}

// Eagerly build the seeded history.
const SEEDED: Record<
  string,
  { runs: EvalRun[]; results: Map<string, EvalResult[]> }
> = {};

for (const orgId of Object.keys(RUN_PLANS)) {
  const runs: EvalRun[] = [];
  const results = new Map<string, EvalResult[]>();
  for (const plan of RUN_PLANS[orgId]) {
    const { run, results: rs } = buildRunAndResults(orgId, plan);
    runs.push(run);
    results.set(plan.run_id, rs);
  }
  SEEDED[orgId] = { runs, results };
}

// --- queries used by the API routes ----------------------------------------

export function listRuns(orgId: string, limit = 10): EvalRun[] {
  const live = [...LIVE_RUNS.values()]
    .map((l) => l.run)
    .filter((r) => r.org_id === orgId && r.status === "completed")
    .reverse();
  return [...live, ...(SEEDED[orgId]?.runs ?? [])].slice(0, limit);
}

export function getRun(runId: string): EvalRun | undefined {
  const live = LIVE_RUNS.get(runId);
  if (live) return live.run;
  for (const orgId of Object.keys(SEEDED)) {
    const run = SEEDED[orgId].runs.find((r) => r.run_id === runId);
    if (run) return run;
  }
  return undefined;
}

export function getResults(runId: string): EvalResult[] {
  const live = LIVE_RUNS.get(runId);
  if (live?.results) return live.results;
  for (const orgId of Object.keys(SEEDED)) {
    const rs = SEEDED[orgId].results.get(runId);
    if (rs) return rs;
  }
  return [];
}

export function getOrg(orgId: string): EvalOrg | undefined {
  return ORGS.find((o) => o.org_id === orgId);
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
    if (!ra) continue; // not comparable across tier selection
    if (ra.passed && !rb.passed) regressions.push(entry(rb));
    else if (!ra.passed && rb.passed) newPasses.push(entry(rb));
    else stable.push(entry(rb));
  }
  return { run_a: runAId, run_b: runBId, new_passes: newPasses, regressions, stable };
}

// --- live-run simulator ------------------------------------------------------
// Backs POST /api/evals/run + GET /api/evals/run/:id while there's no real
// backend. Progress is a function of elapsed time (~1 case / 350ms), and the
// result set is generated with a time-seeded failure sample (~7%).

interface LiveRun {
  run: EvalRun;
  createdMs: number;
  results: EvalResult[] | null;
  seed: number;
}

const LIVE_RUNS: Map<string, LiveRun> =
  // Survive Next.js dev HMR module reloads.
  ((globalThis as any).__qaEvalLiveRuns as Map<string, LiveRun>) ??
  (((globalThis as any).__qaEvalLiveRuns = new Map<string, LiveRun>()));

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function startLiveRun(orgId: string, tier: RunTier): EvalRun | null {
  const org = getOrg(orgId);
  const cases = CASES_BY_ORG[orgId];
  if (!org || !cases) return null;

  const runId = `run-live-${Date.now().toString(36)}`;
  const plan: RunPlan = { run_id: runId, tier, created_at: new Date().toISOString(), failures: [] };
  const { run, results } = buildRunAndResults(orgId, plan);

  const seed = Date.now() % 2147483647;
  const rng = mulberry32(seed);
  for (const r of results) {
    if (rng() < 0.07) {
      r.passed = false;
      const fd = FAILURE_DETAILS[r.case_id];
      if (fd) {
        r.answer = fd.answer;
        r.notes = [fd.note];
        if (r.exchanges.length) r.exchanges[0].assistant = fd.answer;
      } else {
        r.notes = [{ type: "judge", message: "Answer did not match the expected outcome" }];
      }
    }
  }
  run.status = "queued";
  run.passed_cases = 0;
  run.completed_at = null;
  LIVE_RUNS.set(runId, { run, createdMs: Date.now(), results, seed });
  return run;
}

export function pollLiveRun(runId: string): {
  run: EvalRun;
  completed_cases: number;
  results: EvalResult[] | null;
} | null {
  const live = LIVE_RUNS.get(runId);
  if (!live) return null;

  const total = live.results!.length;
  const elapsed = Date.now() - live.createdMs - 1200; // brief "queued" beat
  const done = Math.max(0, Math.min(total, Math.floor(elapsed / 350)));

  let passed = 0;
  for (let i = 0; i < done; i++) if (live.results![i].passed) passed++;

  const finished = done >= total;
  const run: EvalRun = {
    ...live.run,
    status: finished ? "completed" : done > 0 ? "running" : "queued",
    passed_cases: passed,
    completed_at: finished ? new Date().toISOString() : null,
  };
  // Persist the terminal state so the run shows up in history/compare.
  if (finished) live.run = run;
  return {
    run,
    completed_cases: done,
    results: finished ? live.results : null,
  };
}

export function liveRunResults(runId: string): EvalResult[] | null {
  const live = LIVE_RUNS.get(runId);
  return live?.results ?? null;
}
