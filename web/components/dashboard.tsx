"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  ListChecks,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { CasePicker } from "@/components/case-picker";
import {
  CompareResult,
  EstimateResponse,
  EvalOrg,
  EvalResult,
  EvalRun,
  RunStatusResponse,
  RunTier,
  TestCaseSummary,
} from "@/lib/types";
import { formatDateTime, passRate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { PassRateRing } from "@/components/pass-rate-ring";
import { StatusBadge, TierBadge } from "@/components/badges";
import { ModelPicker } from "@/components/model-picker";

const TIER_OPTIONS: { value: RunTier; label: string }[] = [
  { value: "kb", label: "KB only" },
  { value: "pathway", label: "Pathway only" },
  { value: "both", label: "Both tiers" },
];

/** One-line cost/scope summary shown under the Run button. */
function estimateLabel(e: EstimateResponse | null, tier: RunTier): string {
  if (!e) return tier === "kb" ? " " : "estimating cost…";
  if (!e.variants) return `${e.selected_cases} KB checks · no LLM cost`;
  const calls = e.graded_calls + e.sim_calls;
  const cost = e.est_cost != null
    ? `${e.is_upper_bound ? "≤ " : ""}~$${e.est_cost.toFixed(e.est_cost < 0.1 ? 4 : 2)}`
    : "cost unavailable";
  return `Est. ${cost} · ${e.variants} variants · ${calls} LLM calls (${e.judge_model.split("/").pop()})`;
}

export function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgId = searchParams.get("org") ?? "texans";

  const [orgs, setOrgs] = React.useState<EvalOrg[]>([]);
  const [tier, setTier] = React.useState<RunTier>("both");
  // Max caller-simulator follow-up turns for the pathway tier. 0 = single-turn
  // baseline; higher lets a multi-turn troubleshooting agent finish its flow.
  const [maxTurns, setMaxTurns] = React.useState(6);
  // Case scope: which cases this run covers. Defaults to all once loaded.
  const [cases, setCases] = React.useState<TestCaseSummary[] | null>(null);
  const [selectedCases, setSelectedCases] = React.useState<Set<string>>(new Set());
  const [showPicker, setShowPicker] = React.useState(false);
  const [estimate, setEstimate] = React.useState<EstimateResponse | null>(null);
  const [runs, setRuns] = React.useState<EvalRun[] | null>(null);
  const [results, setResults] = React.useState<EvalResult[] | null>(null);
  const [compare, setCompare] = React.useState<CompareResult | null>(null);
  const [live, setLive] = React.useState<RunStatusResponse | null>(null);

  const org = orgs.find((o) => o.org_id === orgId);

  // --- data loading -------------------------------------------------------
  const loadHistory = React.useCallback(async () => {
    // An empty list renders the "no runs yet" state; an uncaught rejection
    // would instead surface as a client-side exception on the whole page.
    const rs = await api.listRuns(orgId, 5).catch(() => [] as EvalRun[]);
    setRuns(rs);
    const latest = rs[0];
    if (latest) {
      const [res, cmp] = await Promise.all([
        api.getRunResults(latest.run_id).catch(() => null),
        rs[1] ? api.compare(rs[1].run_id, latest.run_id).catch(() => null) : null,
      ]);
      setResults(res);
      setCompare(cmp);
    } else {
      setResults(null);
      setCompare(null);
    }
  }, [orgId]);

  React.useEffect(() => {
    // Never leave this unguarded: a database outage makes every endpoint
    // 500, and an unhandled rejection here takes the whole page down with
    // a client-side exception instead of showing anything useful.
    api.listOrgs().then(setOrgs).catch(() => setOrgs([]));
  }, []);

  React.useEffect(() => {
    setRuns(null);
    setResults(null);
    setCompare(null);
    loadHistory();
  }, [loadHistory]);

  // Load the org's case catalogue and start with everything selected, so the
  // default run behaviour (whole suite) is unchanged.
  React.useEffect(() => {
    let live = true;
    setCases(null);
    setShowPicker(false);
    api
      .getOrgCases(orgId)
      .then((c) => {
        if (!live) return;
        setCases(c.cases);
        setSelectedCases(new Set(c.cases.map((x) => x.id)));
      })
      .catch(() => {
        if (!live) return;
        setCases([]);
        setSelectedCases(new Set());
      });
    return () => {
      live = false;
    };
  }, [orgId]);

  // Live cost estimate, debounced so toggling cases or nudging the turn count
  // doesn't fire a request per keystroke.
  React.useEffect(() => {
    if (!cases) return;
    const ids = [...selectedCases];
    if (!ids.length) {
      setEstimate(null);
      return;
    }
    setEstimate(null);
    const t = setTimeout(() => {
      api
        .estimate(orgId, tier, maxTurns, ids)
        .then(setEstimate)
        .catch(() => setEstimate(null));
    }, 350);
    return () => clearTimeout(t);
  }, [orgId, tier, maxTurns, selectedCases, cases]);

  // --- run trigger + polling ----------------------------------------------
  async function startRun() {
    try {
      // Send ids only when it's a real subset; all-selected runs the whole suite.
      const ids = [...selectedCases];
      const scope = cases && ids.length === cases.length ? undefined : ids;
      const { run_id } = await api.startRun(orgId, tier, maxTurns, scope);
      setLive({
        run_id,
        status: "queued",
        total_cases: 0,
        passed_cases: 0,
        completed_cases: 0,
      });
    } catch {
      toast.error("Could not start the eval run.");
    }
  }

  React.useEffect(() => {
    if (!live || live.status === "completed" || live.status === "failed") return;
    const t = setInterval(async () => {
      try {
        const s = await api.getRun(live.run_id);
        setLive(s);
        if (s.status === "completed") {
          toast.success(`Run complete — ${s.passed_cases}/${s.total_cases} passed.`);
          loadHistory();
        } else if (s.status === "failed") {
          toast.error("Run failed.");
        }
      } catch {
        /* transient poll error — keep polling */
      }
    }, 800);
    return () => clearInterval(t);
  }, [live, loadHistory]);

  const running =
    live && (live.status === "queued" || live.status === "running");

  const latest = runs?.[0] ?? null;
  const pct = live?.total_cases
    ? (live.completed_cases / live.total_cases) * 100
    : 0;

  // Category breakdown of the latest run's results.
  const categories = React.useMemo(() => {
    if (!results) return [];
    const byCat = new Map<string, { passed: number; total: number }>();
    for (const r of results) {
      const c = byCat.get(r.category) ?? { passed: 0, total: 0 };
      c.total++;
      if (r.passed) c.passed++;
      byCat.set(r.category, c);
    }
    return [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [results]);

  function selectOrg(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("org", next);
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="container space-y-6 py-8">
      {/* Controls */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-end">
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Organization
            </label>
            <Select value={orgId} onValueChange={selectOrg} disabled={!!running}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Select org" />
              </SelectTrigger>
              <SelectContent>
                {orgs.map((o) => (
                  <SelectItem key={o.org_id} value={o.org_id}>
                    {o.org_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Tier
            </label>
            <Select
              value={tier}
              onValueChange={(v) => setTier(v as RunTier)}
              disabled={!!running}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIER_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Turns
            </label>
            <Input
              type="number"
              min={0}
              max={20}
              value={maxTurns}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isInteger(n) && n >= 0 && n <= 20) setMaxTurns(n);
              }}
              // Only the pathway tiers converse; the KB tier is a single query.
              disabled={!!running || tier === "kb"}
              title="Max caller-simulator follow-up turns per pathway case. 0 = single turn (send only the opening line)."
              className="w-[90px]"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Cases
            </label>
            <Button
              variant="outline"
              onClick={() => setShowPicker((s) => !s)}
              disabled={!!running || !cases}
              className="w-[170px] justify-start font-normal"
            >
              <ListChecks className="text-muted-foreground" />
              {cases
                ? selectedCases.size === cases.length
                  ? `All ${cases.length} cases`
                  : `${selectedCases.size} of ${cases.length} cases`
                : "Loading…"}
            </Button>
          </div>
          <div className="flex flex-col gap-1 sm:ml-auto sm:items-end">
            <Button
              size="lg"
              onClick={startRun}
              disabled={!!running || !org?.is_active || selectedCases.size === 0}
            >
              {running ? <Loader2 className="animate-spin" /> : <Play />}
              {running ? "Running…" : "Run Evals"}
            </Button>
            <span className="text-xs text-muted-foreground">{estimateLabel(estimate, tier)}</span>
          </div>
        </CardContent>
        {showPicker && cases && (
          <div className="border-t px-6 py-4">
            <CasePicker
              cases={cases}
              selected={selectedCases}
              onChange={setSelectedCases}
              disabled={!!running}
            />
          </div>
        )}

        {/* Status strip */}
        {live && (
          <div className="border-t px-6 py-4">
            <div className="mb-2 flex items-center gap-3 text-sm">
              <StatusBadge status={live.status} />
              {live.status === "running" || live.status === "queued" ? (
                <span className="tabular-nums text-muted-foreground">
                  {live.completed_cases}/{live.total_cases} tests
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {live.passed_cases}/{live.total_cases} passed (
                  {passRate(live.passed_cases, live.total_cases)})
                </span>
              )}
              {live.status === "completed" && (
                <Link
                  href={`/runs/${live.run_id}?org=${orgId}`}
                  className="ml-auto inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  View results <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
            <Progress value={live.status === "completed" ? 100 : pct} />
          </div>
        )}
      </Card>

      <ModelPicker orgId={orgId} />

      {/* Summary row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Last run */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Last Run
              {latest && <TierBadge tier={latest.run_tier} />}
            </CardTitle>
            <CardDescription>
              {latest ? formatDateTime(latest.created_at) : "No runs yet"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!runs ? (
              <Skeleton className="h-28 w-full" />
            ) : latest ? (
              <div className="flex items-center gap-6">
                <PassRateRing
                  passed={latest.passed_cases}
                  total={latest.total_cases}
                />
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <span className="tabular-nums">
                      {latest.passed_cases} passed
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-400" />
                    <span className="tabular-nums">
                      {latest.total_cases - latest.passed_cases} failed
                    </span>
                  </div>
                  <Link
                    href={`/runs/${latest.run_id}?org=${orgId}`}
                    className="inline-flex items-center gap-1 pt-1 text-primary hover:underline"
                  >
                    View full results table <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Run evals to see results here.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Compare vs previous */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">vs. Previous Run</CardTitle>
            <CardDescription>
              {compare
                ? `${compare.run_a} → ${compare.run_b}`
                : "No comparable runs"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!runs ? (
              <Skeleton className="h-28 w-full" />
            ) : compare ? (
              <div className="space-y-3 text-sm">
                <div className="flex gap-4">
                  <CompareStat
                    icon={<ArrowUpRight className="h-4 w-4 text-emerald-400" />}
                    count={compare.new_passes.length}
                    label="fixed"
                  />
                  <CompareStat
                    icon={<ArrowDownRight className="h-4 w-4 text-red-400" />}
                    count={compare.regressions.length}
                    label="regressed"
                  />
                  <CompareStat
                    icon={<Minus className="h-4 w-4 text-muted-foreground" />}
                    count={compare.stable.length}
                    label="stable"
                  />
                </div>
                {compare.regressions.length > 0 && (
                  <ul className="space-y-1.5 border-t pt-3">
                    {compare.regressions.map((r) => (
                      <li
                        key={`${r.case_id}-${r.tier}-v${r.variant_num}`}
                        className="flex items-center gap-2"
                      >
                        <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />
                        <span className="font-mono text-xs">
                          {r.case_id}#{r.tier === "kb" ? "kb" : `v${r.variant_num}`}
                        </span>
                        <span className="truncate text-muted-foreground">
                          {r.case_name}
                        </span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          was pass
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Run evals at least twice to compare runs.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Breakdown + recent runs */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By Category</CardTitle>
            <CardDescription>
              Latest run pass rate per category ·{" "}
              <Link href={`/cases?org=${orgId}`} className="hover:underline">
                view test cases →
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!results ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              categories.map(([cat, { passed, total }]) => (
                <div key={cat} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>{cat}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {passed}/{total} · {passRate(passed, total)}
                    </span>
                  </div>
                  <Progress value={(passed / total) * 100} className="h-1.5" />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Runs</CardTitle>
            <CardDescription>
              <Link href={`/history?org=${orgId}`} className="hover:underline">
                View full history →
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {!runs ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              runs.map((r) => (
                <Link
                  key={r.run_id}
                  href={`/runs/${r.run_id}?org=${orgId}`}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-accent"
                >
                  <TierBadge tier={r.run_tier} />
                  <span className="text-muted-foreground">
                    {formatDateTime(r.created_at)}
                  </span>
                  <span className="ml-auto tabular-nums">
                    {r.passed_cases}/{r.total_cases}
                  </span>
                  <span
                    className={
                      r.passed_cases === r.total_cases
                        ? "text-emerald-400"
                        : "text-amber-400"
                    }
                  >
                    {passRate(r.passed_cases, r.total_cases)}
                  </span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CompareStat({
  icon,
  count,
  label,
}: {
  icon: React.ReactNode;
  count: number;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className="text-lg font-semibold tabular-nums">{count}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}
