// Standalone Compugen pathway-tier eval runner.
//
// A dependency-free port of web/lib/runner (bland.ts + judge.ts). It runs the
// pathway tier only — no KB — against the live Bland pathway and grades each
// answer with the OpenRouter LLM judge, exactly as the web runner does. Kept
// standalone because the web runner reads the pathway id from the DB org row
// (still a placeholder for Compugen) and needs the Next server + Postgres; this
// script needs only the repo-root .env. Keep grading behaviour in sync with
// web/lib/runner/judge.ts.
//
// Usage:
//   node compugen/run-pathway-eval.mjs [--filter substr] [--variants N] [--workers 4]
//   node compugen/run-pathway-eval.mjs --pathway <uuid>   # override target pathway

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

// --- env (same loader as web/lib/env.ts: root .env, never override real env) ---
const envPath = path.join(ROOT, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// --- args --------------------------------------------------------------------
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const PATHWAY_ID = arg("pathway", "fde48a29-a826-462d-a416-202f21c661d8");
const FILTER = arg("filter", null);
const VARIANT_CAP = arg("variants", null) ? Number(arg("variants", null)) : null;
const WORKERS = Number(arg("workers", "4")); // 6+ trips Bland's Cloudflare rate gate
const ORG_NAME = "Compugen";
// "sim" drives a multi-turn conversation with an LLM caller-simulator so the
// troubleshooting agent can actually work the problem; "single" sends only the
// opening turn (a cheap turn-one baseline that mostly catches guardrail leaks).
const MODE = arg("mode", "sim");
const MAX_FOLLOWUPS = Number(arg("max-turns", "8")); // caller turns after the opener

const BLAND_KEY = process.env.BLAND_API_KEY_COMPUGEN;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
if (!BLAND_KEY) throw new Error("BLAND_API_KEY_COMPUGEN not set (check repo-root .env)");
if (!OPENROUTER_KEY) throw new Error("OPENROUTER_API_KEY not set (check repo-root .env)");

const BLAND_API = "https://api.bland.ai/v1";
const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";
const JUDGE_MODEL = "deepseek/deepseek-chat";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- transport (port of bland.ts post) ---------------------------------------
async function post(url, body, headers, timeoutMs = 120_000, retries = 4) {
  let last = "";
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "qa-eval/1.0", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return res.json();
      const text = (await res.text()).slice(0, 300);
      last = `HTTP ${res.status}: ${text}`;
      if (![429, 500, 502, 503, 504].includes(res.status)) throw new Error(last);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("HTTP")) throw e;
      last = `${e?.name ?? "Error"}: ${e?.message ?? e}`;
    }
    // Bland sits behind Cloudflare (429 "error code: 1015" under concurrency) — back off hard.
    await sleep(3 * 2 ** attempt * 1000);
  }
  throw new Error(`failed after ${retries} attempts -- ${last}`);
}

// 'Wed, Jul 22, 2026, 2:28 PM' — how a person says a date and how the node prompt reads it.
function nowString() {
  const d = new Date();
  const date = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${date}, ${time}`;
}

// --- pathway chat (port of bland.ts pathwayRun) ------------------------------
async function pathwayRun(pathwayId, turns, apiKey) {
  // Turn 1 is ALWAYS consumed by the Greeting node, so we burn one "hello" and
  // grade only what comes after. {{now}} must go in request_data (NOT variables,
  // which is silently ignored) or the node's date arithmetic has no anchor.
  const created = await post(
    `${BLAND_API}/pathway/chat/create`,
    { pathway_id: pathwayId, request_data: { now: nowString() } },
    { authorization: apiKey }
  );
  const chatId = created.data.chat_id;
  await post(`${BLAND_API}/pathway/chat/${chatId}`, { message: "hello" }, { authorization: apiKey });

  const exchanges = [];
  for (const turn of turns) {
    // Send route is /pathway/chat/{chat_id}; the bare path returns a misleading
    // "Error checking pathway ownership".
    const d = (await post(`${BLAND_API}/pathway/chat/${chatId}`, { message: turn }, { authorization: apiKey })).data;
    exchanges.push({
      user: turn,
      assistant: ((d.assistant_responses ?? []).join(" ")).trim(),
      node: d.current_node_name ?? null,
    });
  }
  return { chatId, exchanges };
}

// --- caller simulator --------------------------------------------------------
// An LLM plays the non-technical caller so a multi-turn troubleshooting agent
// can actually work the problem. It is deliberately NOT given the KB's expected
// steps — a real caller does not know the fix — so it cannot coach the agent.
async function callerReply(testCase, exchanges) {
  const transcript = exchanges
    .map((e) => `${e.user ? `Caller: ${e.user}\n` : ""}Agent: ${e.assistant}`)
    .join("\n");
  const prompt = `You are role-playing a non-technical employee who called IT support. Your problem, in your own words: "${testCase.name}". You already opened with: "${exchanges[0].user}".

Rules for your reply:
- Speak as the caller, first person, 1-2 short sentences. Never speak or think for the agent.
- Answer ONLY what the agent actually asked in their last message. Do not volunteer steps you have supposedly already tried, and do not name folders, menus, settings, or fixes yourself — you are not technical and do not know them. Wait for the agent to walk you through each step.
- When the agent tells you to check or do something, do exactly that and report a realistic result: if their step would plausibly fix your specific problem, say it worked; otherwise say it didn't help, so they keep going.
- You are a standard user with NO admin rights. If asked to install/uninstall/reset software, edit the registry, enter safe mode, or anything admin-gated, say you're not able to do that.
- Keep cooperating for as long as the agent is still working the problem. If the agent has clearly finished — they confirmed it's resolved, or said they're raising an IT ticket or transferring you to a person — just thank them briefly.

Conversation so far:
${transcript}

Your next reply as the caller:`;

  const d = await post(
    OPENROUTER_API,
    { model: JUDGE_MODEL, temperature: 0, reasoning: { enabled: false }, max_tokens: 120,
      messages: [{ role: "user", content: prompt }] },
    { authorization: `Bearer ${OPENROUTER_KEY}` }
  );
  return (d?.choices?.[0]?.message?.content ?? "").trim();
}

// The call is wrapping up when the agent's NODE or its wording signals closure
// or a handoff. Driving off the agent (not the caller's [[END]] token) keeps a
// flaky caller-sim from ending the conversation before the agent has done its
// job. The caller's [[END]] is honoured too, but only after a few turns.
const ENDING_NODE = /resolv|route|transfer|escalat|ticket|goodbye|wrap|end call|hand ?off/i;
const ENDING_TEXT =
  /\b(?:raise|create|open|log|put in|submit)(?: a| an)? (?:support )?ticket|transfer(?:ring)? you|connect(?:ing)? you (?:to|with)|stay on the line|reach out to (?:our )?IT|our IT team will|is (?:now )?resolved|you'?re (?:all set|good to go)|glad (?:that|it) (?:worked|fixed)|that should (?:fix|resolve|do it|sort|take care)|is there anything else|anything else (?:I can help|you need)/i;
const isEnding = (assistant, node) =>
  (node && ENDING_NODE.test(node)) || ENDING_TEXT.test(assistant ?? "");

// --- multi-turn conversation (opener + caller-simulator follow-ups) ----------
async function pathwaySim(pathwayId, testCase, opening, apiKey) {
  const created = await post(
    `${BLAND_API}/pathway/chat/create`,
    { pathway_id: pathwayId, request_data: { now: nowString() } },
    { authorization: apiKey }
  );
  const chatId = created.data.chat_id;
  await post(`${BLAND_API}/pathway/chat/${chatId}`, { message: "hello" }, { authorization: apiKey });

  const exchanges = [];
  const send = async (message) => {
    const d = (await post(`${BLAND_API}/pathway/chat/${chatId}`, { message }, { authorization: apiKey })).data;
    const assistant = ((d.assistant_responses ?? []).join(" ")).trim();
    exchanges.push({ user: message, assistant, node: d.current_node_name ?? null });
    return d.current_node_name ?? null;
  };

  let node = await send(opening);
  for (let i = 0; i < MAX_FOLLOWUPS; i++) {
    const last = exchanges[exchanges.length - 1];
    if (isEnding(last.assistant, node)) break; // agent has wrapped up / handed off
    const reply = await callerReply(testCase, exchanges);
    if (process.env.DEBUG_SIM) console.error(`  [caller#${i}] ${JSON.stringify(reply)}`);
    if (!reply) break;
    node = await send(reply);
  }
  return { chatId, exchanges };
}

// --- LLM judge (port of judge.ts) --------------------------------------------
const JUDGE_TEMPLATE = `You grade a customer-service voice agent for {{org}}.

EXPECTED OUTCOME describes the ground truth for this caller intent. Decide whether the agent handled the caller's actual question correctly.

PASS if:
- The agent conveys the parts of the expected outcome that are relevant to what the caller actually asked. Paraphrase is fine; judge substance, not wording.
- The agent adds extra context that is plausible and does not contradict the expected outcome. Additional accurate detail is good service, not a failure.
- The agent omits parts of the expected outcome the caller did not ask about.
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

function renderJudgePrompt(v) {
  const gt = v.groundTruth
    ? `VERIFIED GROUND TRUTH (already computed -- trust this over your own arithmetic):\n${v.groundTruth}\n\n`
    : "";
  const map = { org: v.org, today: v.today, expected: v.expected, conversation: v.conversation, ground_truth: gt };
  return JUDGE_TEMPLATE.replace(/\{\{(\w+)\}\}/g, (whole, key) => (key in map ? map[key] : whole));
}

async function judge(expected, exchanges, groundTruth) {
  const convo = exchanges.map((e) => `Caller: ${e.user}\nAgent: ${e.assistant}`).join("\n");
  const prompt = renderJudgePrompt({ org: ORG_NAME, today: nowString(), expected, conversation: convo, groundTruth });
  const d = await post(
    OPENROUTER_API,
    {
      model: JUDGE_MODEL,
      temperature: 0,
      reasoning: { enabled: false }, // grading wants a verdict, not chain-of-thought
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
      usage: { include: true },
    },
    { authorization: `Bearer ${OPENROUTER_KEY}` }
  );
  const u = d?.usage ?? {};
  const usage = {
    model: d?.model ?? JUDGE_MODEL,
    cost: Number(u.cost ?? 0) || 0,
    prompt_tokens: Number(u.prompt_tokens ?? 0) || 0,
    completion_tokens: Number(u.completion_tokens ?? 0) || 0,
  };
  const choice = d?.choices?.[0];
  const raw = (choice?.message?.content ?? "").trim();
  const finish = choice?.finish_reason;

  const m = raw.match(/\{.*\}/s);
  if (m) {
    try {
      const v = JSON.parse(m[0]);
      return [!!v.pass, String(v.reason ?? "").slice(0, 200), usage];
    } catch {}
  }
  const pass = raw.match(/"pass"\s*:\s*(true|false)/i);
  if (pass) {
    const reason = raw.match(/"reason"\s*:\s*"([^"]*)/i);
    return [
      pass[1].toLowerCase() === "true",
      `${(reason?.[1] ?? "reply truncated").slice(0, 200)}${finish === "length" ? " [truncated]" : ""}`,
      usage,
    ];
  }
  const why = finish === "length" ? "hit the token limit" : raw ? "no JSON in reply" : "empty reply";
  return [null, `unparseable judge reply (${why}, finish=${finish}): ${raw.slice(0, 120)}`, usage];
}

// Ground-truth lines from a case's own deterministic graders (Compugen uses
// only `contains`; payment_due is Texans-specific and not ported here).
function buildGroundTruth(testCase) {
  const truth = [];
  for (const g of testCase.graders ?? []) {
    if (g.type === "contains") {
      const want = g.any ?? g.all ?? [];
      truth.push(`The answer is expected to convey one of these, in any wording: ${JSON.stringify(want)}`);
    }
  }
  return truth;
}

// --- grade one run (port of judge.ts grade) ----------------------------------
async function grade(testCase, exchanges) {
  const answers = exchanges.map((e) => e.assistant).join(" ");
  const low = answers.toLowerCase();
  let ok = true;
  const notes = [];

  for (const g of testCase.graders ?? []) {
    if (g.type === "contains") {
      if (g.any && !g.any.some((s) => low.includes(s.toLowerCase())))
        notes.push({ type: "advisory", message: `none of ${JSON.stringify(g.any)} present verbatim` });
      if (g.all) {
        const miss = g.all.filter((s) => !low.includes(s.toLowerCase()));
        if (miss.length) notes.push({ type: "advisory", message: `missing verbatim ${JSON.stringify(miss)}` });
      }
    } else if (g.type === "forbidden") {
      const hit = (g.any ?? []).filter((s) => low.includes(s.toLowerCase()));
      if (hit.length) { ok = false; notes.push({ type: "hard_gate", message: `LEAKED ${JSON.stringify(hit)}` }); }
    } else if (g.type === "forbidden_regex" && g.pattern) {
      const scope = g.scope === "last_turn" ? exchanges[exchanges.length - 1]?.assistant ?? "" : answers;
      const mm = scope.match(new RegExp(g.pattern, g.flags ?? ""));
      if (mm) { ok = false; notes.push({ type: "hard_gate", message: `forbidden pattern matched '${mm[0]}'` }); }
    }
  }

  const truth = buildGroundTruth(testCase);
  const [verdict, reason, usage] = await judge(testCase.expected, exchanges, truth.length ? truth.join("\n") : null);
  if (verdict === null) { ok = false; notes.push({ type: "error", message: `judge error: ${reason}` }); }
  else if (!verdict) { ok = false; notes.push({ type: "judge", message: reason }); }

  return { ok, notes, usage };
}

// --- worker pool -------------------------------------------------------------
async function workerPool(items, n, fn) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async () => {
      while (queue.length) await fn(queue.shift());
    })
  );
}

// --- main --------------------------------------------------------------------
async function main() {
  let cases = JSON.parse(fs.readFileSync(path.join(HERE, "evals", "cases.json"), "utf8"));
  if (FILTER) {
    // Comma-separated: a case matches if any term is a substring of its id/name.
    const terms = FILTER.toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
    cases = cases.filter((c) =>
      terms.some((f) => c.id.toLowerCase().includes(f) || c.name.toLowerCase().includes(f))
    );
  }
  const testable = cases.filter((c) => c.untestable?.tier !== "pathway");

  const jobs = [];
  for (const c of testable) {
    const variants = VARIANT_CAP ? c.variants.slice(0, VARIANT_CAP) : c.variants;
    variants.forEach((v, i) => jobs.push({ c, v, variantIdx: i }));
  }

  console.log(`Pathway: ${PATHWAY_ID}`);
  console.log(`Mode: ${MODE}${MODE === "sim" ? ` (caller-simulator, up to ${MAX_FOLLOWUPS} follow-ups)` : ""}`);
  console.log(`Compugen pathway tier: ${testable.length} intents × phrasings = ${jobs.length} runs, ${WORKERS} workers\n`);

  const t0 = Date.now();
  const results = [];
  await workerPool(jobs, WORKERS, async ({ c, v, variantIdx }) => {
    const label = `${c.id} v${variantIdx + 1}`;
    try {
      const { chatId, exchanges } =
        MODE === "sim"
          ? await pathwaySim(PATHWAY_ID, c, v.turns[0], BLAND_KEY)
          : await pathwayRun(PATHWAY_ID, v.turns, BLAND_KEY);
      const { ok, notes, usage } = await grade(c, exchanges);
      results.push({
        case_id: c.id, case_name: c.name, category: c.category, application: c.application ?? null,
        variant_num: variantIdx + 1, question: v.turns[v.turns.length - 1],
        answer: exchanges.map((e) => e.assistant).join(" "), passed: ok, notes, chat_id: chatId, exchanges,
        judge_cost: usage?.cost ?? 0,
      });
      const noteStr = notes.length ? "  <- " + notes.map((n) => `${n.type}: ${n.message}`).join("; ") : "";
      console.log(`${ok ? "PASS" : "FAIL"} ${label}  ${c.name}${noteStr}`);
    } catch (e) {
      results.push({
        case_id: c.id, case_name: c.name, category: c.category, application: c.application ?? null,
        variant_num: variantIdx + 1, question: v.turns[v.turns.length - 1], answer: "",
        passed: false, notes: [{ type: "error", message: `${e?.name ?? "Error"}: ${e?.message ?? e}` }],
        chat_id: null, exchanges: [], judge_cost: 0,
      });
      console.log(`FAIL ${label}  ${c.name}  <- error: ${e?.message ?? e}`);
    }
  });

  const durationS = ((Date.now() - t0) / 1000).toFixed(1);
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const pct = total ? (100 * passed) / total : 0;
  const cost = results.reduce((s, r) => s + (r.judge_cost || 0), 0);

  results.sort((a, b) => a.case_id.localeCompare(b.case_id) || a.variant_num - b.variant_num);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.join(HERE, "evals", "results");
  fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, `run-${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(
    { stamp, tier: "pathway", org: "compugen", pathway_id: PATHWAY_ID, judge: JUDGE_MODEL,
      duration_s: Number(durationS), passed, total, judge_cost: cost, results }, null, 2));

  // Group failures by intent for the report.
  const byCase = {};
  for (const r of results) (byCase[r.case_id] ??= []).push(r);
  const brokenIntents = Object.entries(byCase).filter(([, rs]) => rs.every((r) => !r.passed)).map(([id]) => id);
  const flakyIntents = Object.entries(byCase)
    .filter(([, rs]) => rs.some((r) => r.passed) && rs.some((r) => !r.passed)).map(([id]) => id);

  const md = [];
  md.push(`# Compugen pathway eval — ${stamp}`, "");
  md.push(`Pathway: \`${PATHWAY_ID}\` ("MS Troubleshooting for Evals")  `);
  md.push(`Judge: \`${JUDGE_MODEL}\`  `);
  md.push(`**${passed}/${total} variant runs passed (${pct.toFixed(1)}%)** in ${durationS}s · judge cost $${cost.toFixed(4)}`, "");
  if (brokenIntents.length) md.push(`**Fully failing intents:** ${brokenIntents.join(", ")}`, "");
  if (flakyIntents.length) md.push(`**Phrasing-sensitive intents (some variants pass, some fail):** ${flakyIntents.join(", ")}`, "");

  md.push("", "## Per-intent summary", "", "| Intent | Category | Pass | Notes |", "|---|---|---|---|");
  for (const [id, rs] of Object.entries(byCase)) {
    const p = rs.filter((r) => r.passed).length;
    const notes = [...new Set(rs.flatMap((r) => r.notes).filter((n) => n.type !== "advisory").map((n) => n.message))];
    md.push(`| ${id} | ${rs[0].category} | ${p}/${rs.length} | ${notes.join("; ").slice(0, 160).replace(/\|/g, "\\|")} |`);
  }

  md.push("", "## Failing transcripts", "");
  for (const r of results.filter((r) => !r.passed)) {
    md.push(`### ${r.case_id} v${r.variant_num} — ${r.case_name}`, "");
    md.push(`- **Why it failed:** ${r.notes.map((n) => `${n.type}: ${n.message}`).join("; ")}`, "");
    if (r.exchanges?.length) {
      md.push("", "```");
      for (const e of r.exchanges) {
        md.push(`Caller: ${e.user}`);
        md.push(`Agent:  ${(e.assistant || "(no answer)").replace(/\n/g, " ")}${e.node ? `   [node: ${e.node}]` : ""}`);
      }
      md.push("```", "");
    } else {
      md.push(`- **Caller:** ${r.question}`, `- **Agent:** (no answer)`, "");
    }
  }

  const mdPath = path.join(outDir, `run-${stamp}.md`);
  fs.writeFileSync(mdPath, md.join("\n"));

  console.log(`\n=== ${passed}/${total} runs passed (${pct.toFixed(1)}%) in ${durationS}s ===`);
  if (brokenIntents.length) console.log(`Fully failing intents: ${brokenIntents.join(", ")}`);
  if (flakyIntents.length) console.log(`Phrasing-sensitive intents: ${flakyIntents.join(", ")}`);
  console.log(`\nReport: ${path.relative(ROOT, mdPath)}\nRaw:    ${path.relative(ROOT, jsonPath)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
