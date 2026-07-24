#!/usr/bin/env python3
"""
Houston Texans agent eval harness.

Runs the test cases in houston-texans/evals/cases.json against the live Texans
pathway (and, optionally, the knowledge base underneath it), grades each answer,
and writes a JSON artifact + markdown report.

Two tiers:
  pathway (default) -- POST /v1/pathway/chat/{chat_id}. The full agent: routing,
                       persona, multi-turn. This is what a caller actually gets.
  kb (--tier kb)    -- POST /v1/knowledge/chat. Retrieval only, no agent. Cheap
                       and deterministic. When a pathway case fails, run this to
                       tell "the KB doesn't contain/surface it" apart from "the
                       agent had it and answered badly."

Usage:
    export BLAND_API_KEY=org_...
    export OPENROUTER_API_KEY=sk-or-...     # LLM judge grader (via OpenRouter)
    python3 scripts/texans_eval.py                      # full suite, both tiers' default
    python3 scripts/texans_eval.py --tier kb            # retrieval smoke test only
    python3 scripts/texans_eval.py --filter mascot      # one case by id/name substring
    python3 scripts/texans_eval.py --variants 1         # first phrasing only (fast)
    python3 scripts/texans_eval.py --repeat 3           # run 3 times each (trustworthy)

Never hardcode either API key. Both are read from the environment.
"""
import argparse, datetime, json, os, pathlib, re, sys, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

BLAND_API = "https://api.bland.ai/v1"
OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions"
JUDGE_MODEL = "deepseek/deepseek-chat"

ROOT = pathlib.Path(__file__).resolve().parent.parent
CASES_PATH = ROOT / "houston-texans" / "evals" / "cases.json"
RESULTS_DIR = ROOT / "houston-texans" / "evals" / "results"

BLAND_KEY = os.environ.get("BLAND_API_KEY")
OPENROUTER_KEY = os.environ.get("OPENROUTER_API_KEY")


# --- transport ------------------------------------------------------------
def _post(url, body, headers, timeout=120, retries=4):
    """POST JSON with retry on transient failures (429/5xx/timeouts)."""
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url, data=json.dumps(body).encode(), method="POST",
                headers={"content-type": "application/json",
                         # A real UA matters: Cloudflare 403s python-urllib's default.
                         "user-agent": "texans-eval/1.0", **headers})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body_txt = e.read().decode(errors="replace")[:300]
            last = f"HTTP {e.code}: {body_txt}"
            if e.code not in (429, 500, 502, 503, 504):
                raise RuntimeError(last)
        except Exception as e:
            last = f"{type(e).__name__}: {e}"
        # Bland sits behind Cloudflare, which returns 429 "error code: 1015" under
        # concurrency. Back off hard -- 1015 is a rate gate, not a transient blip.
        time.sleep(3 * (2 ** attempt))
    raise RuntimeError(f"failed after {retries} attempts -- {last}")


# --- tier 1: knowledge base ----------------------------------------------
def now_string():
    """Current local time as 'Wed, Jul 22, 2026, 2:28 PM' -- no zero-padding on the
    day or hour, which is how a person says a date and how the node prompt reads it."""
    lt = time.localtime()
    return (time.strftime("%a, %b ", lt) + str(lt.tm_mday)
            + time.strftime(", %Y, ", lt) + str(int(time.strftime("%I", lt)))
            + time.strftime(":%M %p", lt))


def kb_chat(kb_id, question):
    d = _post(f"{BLAND_API}/knowledge/chat",
              {"knowledge_base_id": kb_id,
               "messages": [{"role": "user", "content": question}]},
              {"authorization": BLAND_KEY})
    return ((d.get("data") or {}).get("result") or "").strip()


# --- tier 2: pathway chat -------------------------------------------------
def pathway_run(pathway_id, turns, variant=None):
    """Prime the greeting, then send the real turns.

    Turn 1 is ALWAYS consumed by the pathway's Greeting node -- it replies with
    the scripted "Hey this is Riley from the Texans..." regardless of what you
    send. So we burn one turn on "hello" and grade only what comes after. A
    harness that skips this grades the greeting and fails every case.
    """
    # {{now}} must be supplied or the node's payment-date arithmetic has no anchor
    # and the agent falls back to the plan's FINAL deadline every time. On a real
    # call Bland injects {{now}} itself; the chat API does not, so we pass it.
    #
    # The parameter is `request_data`, NOT `variables`. A `variables` payload is
    # silently ignored here -- accepted without error, never bound, no warning.
    # That silence is what made this look like a broken agent rather than a
    # missing input, so don't "simplify" this key.
    created = _post(f"{BLAND_API}/pathway/chat/create",
                    {"pathway_id": pathway_id, "request_data": {"now": now_string()}},
                    {"authorization": BLAND_KEY})
    chat_id = created["data"]["chat_id"]

    _post(f"{BLAND_API}/pathway/chat/{chat_id}", {"message": "hello"},
          {"authorization": BLAND_KEY})

    exchanges = []
    for turn in turns:
        # NOTE: the send route is /pathway/chat/{chat_id}, NOT /pathway/chat.
        # Posting to the bare path returns "Error checking pathway ownership",
        # which reads like an auth failure but is really a wrong-route error.
        d = _post(f"{BLAND_API}/pathway/chat/{chat_id}", {"message": turn},
                  {"authorization": BLAND_KEY})["data"]
        exchanges.append({
            "user": turn,
            "assistant": " ".join(d.get("assistant_responses") or []).strip(),
            "node": d.get("current_node_name"),
            "node_id": d.get("current_node_id"),
        })
    return {"chat_id": chat_id, "exchanges": exchanges}


# --- payment schedule (deterministic; do NOT delegate this to the judge) ---
# Payments fall on the 15th of each month, except February's on the 13th.
# 4-month plan runs Feb-May (final deadline May 15).
# 8-month plan runs Feb-Sep (final deadline Sep 15).
PLAN_MONTHS = {"4": [2, 3, 4, 5], "8": [2, 3, 4, 5, 6, 7, 8, 9]}
MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June",
               "July", "August", "September", "October", "November", "December"]


def next_payment(plan, today):
    """Next due (month, day) for a plan, or None if the plan is fully paid up.

    A payment due *today* still counts as the next one -- the node is explicit
    that on-or-before the 15th means this month's payment has not happened yet.
    """
    for m in PLAN_MONTHS[plan]:
        d = 13 if m == 2 else 15
        if (today.month, today.day) <= (m, d):
            return m, d
    return None


def grade_payment_due(plan, answer, today):
    """Deterministic check of the agent's payment-date arithmetic."""
    low = answer.lower()
    if plan:
        nxt = next_payment(plan, today)
        if nxt is None:
            ok = any(s in low for s in ("paid up", "fully paid", "all paid",
                                        "paid in full", "all set"))
            return ok, "" if ok else f"{plan}-month plan is fully paid up; agent did not say so"
        m, d = nxt
        want = f"{MONTH_NAMES[m].lower()} {d}"
        if want in low:
            return True, ""
        return False, f"expected next due {MONTH_NAMES[m]} {d}; not stated"

    # No plan named: we can't pin one date, but the agent must never present a
    # date that has already passed as the *upcoming* one.
    #
    # Checked per sentence, not across the whole answer. Naming a past date is
    # perfectly correct when it's flagged as already passed -- "the 4-month plan
    # is all paid up, the final deadline was May 15th" is a good answer, and a
    # whole-answer substring check wrongly fails it.
    past_marker = ("paid up", "fully paid", "all paid", "paid in full", "all set",
                   "deadline was", "was back on", "already passed", "has passed",
                   "final deadline", "ran through", "runs february through may")
    stale = []
    for m in range(2, 10):
        d = 13 if m == 2 else 15
        if (m, d) >= (today.month, today.day):
            continue
        token = f"{MONTH_NAMES[m].lower()} {d}"
        for sent in re.split(r"(?<=[.!?])\s+|,\s+(?=if\b)", low):
            if token in sent and not any(p in sent for p in past_marker):
                stale.append(f"{MONTH_NAMES[m]} {d}")
                break
    if stale:
        return False, f"cites past date(s) as upcoming: {stale}"
    return True, ""


# --- grading --------------------------------------------------------------
def judge(expected, exchanges, ground_truth=None):
    """Cheap LLM judge -> {pass, reason}. Authoritative for pass/fail.

    `ground_truth` is pre-computed fact the model should not have to derive --
    notably the payment date, which DeepSeek got wrong when asked to calculate it
    (it accepted Sep 15 when the answer was Aug 15). It compares reliably; it
    computes unreliably. So compute in Python, compare in the model.
    """
    if not OPENROUTER_KEY:
        return None, "OPENROUTER_API_KEY not set"

    convo = "\n".join(f"Caller: {e['user']}\nAgent: {e['assistant']}" for e in exchanges)
    prompt = (
        "You grade a customer-service voice agent for the Houston Texans.\n\n"
        "EXPECTED OUTCOME describes the ground truth for this caller intent. Decide "
        "whether the agent handled the caller's actual question correctly.\n\n"
        "PASS if:\n"
        "- The agent conveys the parts of the expected outcome that are relevant to "
        "what the caller actually asked. Paraphrase is fine; judge substance, not wording.\n"
        "- The agent adds extra context that is plausible and does not contradict the "
        "expected outcome. Additional accurate detail is good service, not a failure.\n"
        "- The agent omits parts of the expected outcome the caller did not ask about. "
        "(If the caller asks only about away games, the agent need not also recite the "
        "policy for home games.)\n"
        "- The agent offers to transfer/connect to a human where the expected outcome "
        "says to, even if worded differently.\n\n"
        "FAIL if:\n"
        "- The agent contradicts the expected outcome.\n"
        "- The agent fabricates a specific commitment the expected outcome does not "
        "support: an exact date, dollar amount, deadline, or eligibility requirement. "
        "This is the most serious failure. It is especially a failure when the expected "
        "outcome says the answer depends on the caller's account or should be handled "
        "by a human, and the agent answers with a concrete specific instead.\n"
        "- The agent says it does not know, or deflects, when the expected outcome shows "
        "it should have been able to answer.\n"
        "- The caller's question squarely calls for several enumerated points and the "
        "agent gives only some of them.\n\n"
        f"TODAY'S DATE IS: {now_string()}\n\n"
        + (f"VERIFIED GROUND TRUTH (already computed -- trust this over your own "
           f"arithmetic):\n{ground_truth}\n\n" if ground_truth else "")
        + f"EXPECTED OUTCOME:\n{expected}\n\n"
        f"ACTUAL CONVERSATION:\n{convo}\n\n"
        'Reply with ONLY compact JSON: {"pass": true|false, "reason": "<one short sentence>"}'
    )
    d = _post(OPENROUTER_API,
              {"model": JUDGE_MODEL, "temperature": 0, "max_tokens": 200,
               "messages": [{"role": "user", "content": prompt}]},
              {"authorization": f"Bearer {OPENROUTER_KEY}"})
    raw = d["choices"][0]["message"]["content"].strip()
    m = re.search(r"\{.*\}", raw, re.S)
    if not m:
        return None, f"unparseable judge reply: {raw[:120]}"
    v = json.loads(m.group(0))
    return bool(v.get("pass")), str(v.get("reason", ""))[:200]


def grade(case, exchanges, variant=None):
    """Grade one run. Returns (ok, [notes]).

    The LLM judge is AUTHORITATIVE for pass/fail. Deterministic checks play two
    supporting roles and do not override it:

      - `contains` / `payment_due` are ADVISORY. They compute expected facts,
        feed them to the judge as ground truth, and report what they saw in the
        notes -- but they never fail a run the judge passed. Substring matching
        cannot tell a paraphrase from a wrong answer, and when it had veto power
        it failed correct answers (e.g. the agent offering a Membership Services
        transfer instead of naming "account manager").

      - `forbidden` / `forbidden_regex` remain HARD GATES. "Must not say X" is
        objectively checkable and is a safety guardrail, so it isn't subject to
        judge opinion. The asymmetry with `contains` is deliberate.
    """
    answers = " ".join(e["assistant"] for e in exchanges)
    low = answers.lower()
    ok, notes, truth = True, [], []

    for g in case.get("graders", []):
        kind = g["type"]

        if kind == "contains":  # advisory
            want = g.get("any") or g.get("all") or []
            truth.append("The answer is expected to convey one of these, in any "
                         f"wording: {want}")
            if "any" in g and not any(s.lower() in low for s in g["any"]):
                notes.append(f"[advisory] none of {g['any']} present verbatim")
            if "all" in g:
                miss = [s for s in g["all"] if s.lower() not in low]
                if miss:
                    notes.append(f"[advisory] missing verbatim {miss}")

        elif kind == "payment_due":  # advisory + supplies computed ground truth
            plan = (variant or {}).get("plan")
            today = datetime.date.today()
            if plan:
                nxt = next_payment(plan, today)
                truth.append(
                    f"The caller is on the {plan}-month plan. Computed from today, "
                    + (f"their next payment is {MONTH_NAMES[nxt[0]]} {nxt[1]}."
                       if nxt else
                       f"their plan is FULLY PAID UP (its final deadline has passed).")
                    + " An answer naming any other date is wrong.")
            else:
                parts = []
                for p in ("4", "8"):
                    n = next_payment(p, today)
                    parts.append(f"{p}-month plan: "
                                 + (f"{MONTH_NAMES[n[0]]} {n[1]}" if n else "fully paid up"))
                truth.append("The caller did not say which plan they are on. Computed "
                             f"from today -- {'; '.join(parts)}. Naming a date that has "
                             "already passed as the UPCOMING payment is wrong; "
                             "referring to a past date as already paid is correct.")
            good, note = grade_payment_due(plan, answers, today)
            if not good:
                notes.append(f"[advisory] {note}")

        elif kind == "forbidden":  # hard gate
            hit = [s for s in g["any"] if s.lower() in low]
            if hit:
                ok = False
                notes.append(f"LEAKED {hit}")

        elif kind == "forbidden_regex":  # hard gate
            scope = (exchanges[-1]["assistant"] if g.get("scope") == "last_turn"
                     else answers)
            m = re.search(g["pattern"], scope)
            if m:
                ok = False
                notes.append(f"forbidden pattern matched {m.group(0)!r}")

    verdict, reason = judge(case["expected"], exchanges,
                            "\n".join(truth) if truth else None)
    if verdict is None:
        ok = False
        notes.append(f"judge error: {reason}")
    elif not verdict:
        ok = False
        notes.append(f"judge: {reason}")

    return ok, notes


# --- runners --------------------------------------------------------------
def run_pathway_variant(job):
    case, idx, variant, pathway_id, rep = job
    label = f"{case['id']}#v{idx + 1}" + (f"r{rep + 1}" if rep else "")
    base = {"case_id": case["id"], "name": case["name"],
            "category": case["category"], "scenario_id": case.get("scenario_id"),
            "variant": idx + 1, "rep": rep + 1, "turns": variant["turns"],
            "label": label}
    try:
        res = pathway_run(pathway_id, variant["turns"])
        ok, notes = grade(case, res["exchanges"], variant)
        return {**base, "passed": ok, "notes": notes,
                "chat_id": res["chat_id"], "exchanges": res["exchanges"]}
    except Exception as e:
        return {**base, "passed": False,
                "notes": [f"ERROR {type(e).__name__}: {e}"],
                "chat_id": None, "exchanges": []}


def run_kb_case(job):
    case, kb_id = job
    question = case["variants"][0]["turns"][-1]
    try:
        ans = kb_chat(kb_id, question)
        expect = case.get("kb_expect") or []
        miss = [s for s in expect if s.lower() not in ans.lower()]
        return {"case_id": case["id"], "name": case["name"], "question": question,
                "passed": not miss, "notes": [f"missing {miss}"] if miss else [],
                "answer": ans}
    except Exception as e:
        return {"case_id": case["id"], "name": case["name"], "question": question,
                "passed": False, "notes": [f"ERROR {type(e).__name__}: {e}"],
                "answer": ""}


# --- reporting ------------------------------------------------------------
def write_reports(payload, stamp):
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    json_path = RESULTS_DIR / f"run-{stamp}.json"
    md_path = RESULTS_DIR / f"run-{stamp}.md"
    json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    rows = payload["results"]
    total, passed = len(rows), sum(r["passed"] for r in rows)
    pct = (100.0 * passed / total) if total else 0.0

    # Group variants back to their intent so phrasing sensitivity is visible.
    by_case = {}
    for r in rows:
        by_case.setdefault(r["case_id"], []).append(r)

    # A (case, variant) run more than once with mixed results is NON-DETERMINISTIC:
    # identical input, different verdict. Bland's KB retrieval genuinely does this
    # (measured ~4/6 on an identical query), so this has to be separated from real
    # phrasing sensitivity or every report will misattribute noise to regression.
    def variant_groups(rs):
        g = {}
        for r in rs:
            g.setdefault(r["variant"], []).append(r)
        return g

    nondet, phrasing, solid, broken = [], [], [], []
    for c, rs in by_case.items():
        g = variant_groups(rs)
        unstable = [v for v, vr in g.items()
                    if len(vr) > 1 and 0 < sum(x["passed"] for x in vr) < len(vr)]
        allp = all(r["passed"] for r in rs)
        anyp = any(r["passed"] for r in rs)
        if unstable:
            nondet.append(c)
        elif allp:
            solid.append(c)
        elif not anyp:
            broken.append(c)
        else:
            phrasing.append(c)

    reps = payload.get("repeat", 1)
    L = [f"# Texans agent eval -- {stamp}", "",
         f"**Pass rate: {passed}/{total} runs ({pct:.1f}%)**  ",
         f"Tier: `{payload['tier']}` | Judge: `{payload['judge']}` | "
         f"Reps: `{reps}` | Pathway: `{payload['pathway_id']}`", "",
         f"- Solid (every phrasing, every rep): **{len(solid)}**/{len(by_case)} intents",
         f"- Non-deterministic (same input, different verdict): **{len(nondet)}**",
         f"- Phrasing-sensitive (consistent per wording, differs across): **{len(phrasing)}**",
         f"- Broken (fails everywhere): **{len(broken)}**", ""]
    if reps == 1:
        L += ["> Run with `--repeat 3` before trusting a regression: retrieval is "
              "non-deterministic, so a single-rep diff can be noise.", ""]

    if nondet:
        L += ["## Non-deterministic intents", "",
              "Identical input, different verdict across repeats. Treat the pass rate "
              "here as a probability, not a boolean. Usually a retrieval-confidence "
              "problem in the KB rather than a pathway bug.", ""]
        for cid in nondet:
            g = variant_groups(by_case[cid])
            L.append(f"### {by_case[cid][0]['name']} (`{cid}`)")
            for v, vr in sorted(g.items()):
                p = sum(x["passed"] for x in vr)
                flag = " <-- unstable" if 0 < p < len(vr) else ""
                L.append(f"- v{v} \"{vr[0]['turns'][-1]}\": **{p}/{len(vr)}**{flag}")
            L.append("")

    by_cat = {}
    for r in rows:
        c = by_cat.setdefault(r["category"], [0, 0])
        c[1] += 1
        c[0] += r["passed"]
    L += ["## By category", "", "| Category | Pass | Total | Rate |", "|---|---|---|---|"]
    for cat, (p, t) in sorted(by_cat.items()):
        L.append(f"| {cat} | {p} | {t} | {100.0 * p / t:.0f}% |")
    L.append("")

    if phrasing:
        L += ["## Phrasing-sensitive intents", "",
              "The agent knows the answer but only surfaces it for some wordings. "
              "These are the highest-value fixes -- real callers use all three.", ""]
        for cid in phrasing:
            rs = by_case[cid]
            L.append(f"### {rs[0]['name']} (`{cid}`)")
            for r in rs:
                mark = "PASS" if r["passed"] else "FAIL"
                L.append(f"- **{mark}** v{r['variant']}: \"{r['turns'][-1]}\"")
                if r["notes"]:
                    L.append(f"  - {'; '.join(r['notes'])}")
            L.append("")

    if broken:
        L += ["## Broken intents", "", "Failed on every phrasing.", ""]
        for cid in broken:
            rs = by_case[cid]
            L.append(f"### {rs[0]['name']} (`{cid}`)")
            L.append(f"- Expected: {next(c['expected'] for c in payload['cases_meta'] if c['id'] == cid)}")
            for r in rs:
                L.append(f"- v{r['variant']} \"{r['turns'][-1]}\" -> {'; '.join(r['notes']) or 'failed'}")
                if r["exchanges"]:
                    L.append(f"  - Agent said: {r['exchanges'][-1]['assistant'][:300]}")
                    L.append(f"  - Node: `{r['exchanges'][-1]['node']}`")
            L.append("")

    if payload.get("untestable"):
        L += ["## Not tested on this channel", "",
              "Excluded from the pass rate above -- these cannot be graded here, so a "
              "FAIL would be meaningless. They still need verifying another way.", ""]
        for u in payload["untestable"]:
            L.append(f"- **{u['name']}** (`{u['id']}`) -- {u['reason']}")
        L.append("")

    if solid:
        L += ["## Solid intents", "",
              ", ".join(f"`{c}`" for c in sorted(solid)), ""]

    md_path.write_text("\n".join(L), encoding="utf-8")
    return json_path, md_path, passed, total, pct, nondet, phrasing, broken


# --- main -----------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tier", choices=["pathway", "kb"], default="pathway")
    ap.add_argument("--filter", default=None, help="substring match on case id or name")
    ap.add_argument("--variants", type=int, default=None, help="cap phrasings per intent")
    ap.add_argument("--repeat", type=int, default=1,
                    help="run each phrasing N times. Retrieval is non-deterministic, "
                         "so use >=3 when you need a trustworthy pass rate.")
    # 6+ workers trips Cloudflare's rate gate (429 / "error code: 1015") on Bland.
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    if not BLAND_KEY:
        sys.exit("Set BLAND_API_KEY first.")

    if not OPENROUTER_KEY:
        sys.exit("Set OPENROUTER_API_KEY first.")

    spec = json.loads(CASES_PATH.read_text(encoding="utf-8"))
    cases = spec["cases"]
    if args.filter:
        f = args.filter.lower()
        cases = [c for c in cases if f in c["id"].lower() or f in c["name"].lower()]
    if not cases:
        sys.exit(f"No cases matched --filter {args.filter!r}")

    stamp = time.strftime("%Y-%m-%dT%H-%M-%S")
    t0 = time.time()

    if args.tier == "kb":
        kb_cases = [c for c in cases if c.get("kb_expect")]
        print(f"KB retrieval tier: {len(kb_cases)} cases with kb_expect assertions\n")
        with ThreadPoolExecutor(max_workers=args.workers) as ex:
            results = list(ex.map(run_kb_case,
                                  [(c, spec["knowledge_base_id"]) for c in kb_cases]))
        for r in sorted(results, key=lambda r: r["passed"]):
            print(("PASS " if r["passed"] else "FAIL ") + r["name"]
                  + (f"  <- {'; '.join(r['notes'])}" if r["notes"] else ""))
            if not r["passed"]:
                print(f"   Q: {r['question']}")
                print(f"   A: {r['answer'][:240]}\n")
        p = sum(r["passed"] for r in results)
        print(f"\n=== KB retrieval: {p}/{len(results)} passed "
              f"({100.0 * p / max(len(results), 1):.0f}%) in {time.time() - t0:.0f}s ===")
        return 0 if p == len(results) else 1

    # Some cases can't be graded on this channel at all (e.g. they depend on a
    # variable the chat API never populates). Excluding them is not sweeping a
    # failure under the rug -- leaving them in would park a permanent false FAIL
    # that drags the rate down AND masks a real regression later. They're listed
    # explicitly in the report instead.
    untestable = [c for c in cases
                  if (c.get("untestable") or {}).get("tier") == args.tier]
    cases = [c for c in cases if c not in untestable]
    for c in untestable:
        print(f"SKIP {c['id']}  -- {c['untestable']['reason']}")
    if untestable:
        print()

    jobs = []
    for c in cases:
        variants = c["variants"][: args.variants] if args.variants else c["variants"]
        for i, v in enumerate(variants):
            for rep in range(args.repeat):
                jobs.append((c, i, v, spec["pathway_id"], rep))

    print(f"Pathway tier: {len(cases)} intents x phrasings x {args.repeat} rep(s) "
          f"= {len(jobs)} runs, {args.workers} workers\n")

    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        for r in ex.map(run_pathway_variant, jobs):
            results.append(r)
            print(("PASS " if r["passed"] else "FAIL ") + r["label"] + "  " + r["name"]
                  + (f"  <- {'; '.join(r['notes'])}" if r["notes"] else ""))

    payload = {"stamp": stamp, "tier": args.tier,
               "judge": JUDGE_MODEL,
               "pathway_id": spec["pathway_id"], "repeat": args.repeat,
               "duration_s": round(time.time() - t0, 1),
               "cases_meta": [{"id": c["id"], "expected": c["expected"]} for c in cases],
               "untestable": [{"id": c["id"], "name": c["name"],
                               "reason": c["untestable"]["reason"]} for c in untestable],
               "results": results}

    jp, mp, passed, total, pct, nondet, phrasing, broken = write_reports(payload, stamp)
    print(f"\n=== {passed}/{total} runs passed ({pct:.1f}%) in {payload['duration_s']}s ===")
    if nondet:
        print(f"Non-deterministic intents: {', '.join(nondet)}")
    if phrasing:
        print(f"Phrasing-sensitive intents: {', '.join(phrasing)}")
    if broken:
        print(f"Broken intents: {', '.join(broken)}")
    print(f"\nReport:  {mp.relative_to(ROOT)}\nRaw:     {jp.relative_to(ROOT)}")
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
