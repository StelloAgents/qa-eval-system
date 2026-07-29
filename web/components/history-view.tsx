"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, Eye, GitCompareArrows, Minus } from "lucide-react";
import { api } from "@/lib/api";
import { CompareResult, EvalOrg, EvalRun } from "@/lib/types";
import { formatDateTime, passRate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge, TierBadge } from "@/components/badges";

export function HistoryView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgId = searchParams.get("org") ?? "texans";

  const [orgs, setOrgs] = React.useState<EvalOrg[]>([]);
  const [runs, setRuns] = React.useState<EvalRun[] | null>(null);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [compare, setCompare] = React.useState<CompareResult | null>(null);
  const [comparing, setComparing] = React.useState(false);

  React.useEffect(() => {
    // Never leave this unguarded: a database outage makes every endpoint
    // 500, and an unhandled rejection here takes the whole page down with
    // a client-side exception instead of showing anything useful.
    api.listOrgs().then(setOrgs).catch(() => setOrgs([]));
  }, []);

  React.useEffect(() => {
    setRuns(null);
    setSelected([]);
    setCompare(null);
    api.listRuns(orgId, 10).then(setRuns);
  }, [orgId]);

  function toggle(runId: string) {
    setSelected((prev) => {
      if (prev.includes(runId)) return prev.filter((id) => id !== runId);
      return [...prev, runId].slice(-2); // keep at most two
    });
    setCompare(null);
  }

  async function runComparison() {
    if (!runs || selected.length !== 2) return;
    setComparing(true);
    try {
      const [a, b] = selected
        .map((id) => runs.find((r) => r.run_id === id)!)
        .sort((x, y) => x.created_at.localeCompare(y.created_at));
      // Older run is the baseline (A), newer is current (B).
      setCompare(await api.compare(a.run_id, b.run_id));
    } catch {
      setCompare(null);
    } finally {
      setComparing(false);
    }
  }

  function selectOrg(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("org", next);
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="container space-y-6 py-8">
      <div className="flex items-center gap-4">
        <div>
          <h1 className="text-xl font-semibold">Run History</h1>
          <p className="text-sm text-muted-foreground">
            Select two runs to compare them.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Button
            onClick={runComparison}
            disabled={selected.length !== 2 || comparing}
            variant="secondary"
          >
            <GitCompareArrows />
            {comparing ? "Comparing…" : "Compare"}
          </Button>
          <Select value={orgId} onValueChange={selectOrg}>
            <SelectTrigger className="w-[200px]">
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
      </div>

      <Card>
        <CardContent className="p-0">
          {!runs ? (
            <div className="p-6">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : runs.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No runs yet for this org.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Date</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Passed</TableHead>
                  <TableHead className="w-[20%]">Rate</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow
                    key={r.run_id}
                    data-state={selected.includes(r.run_id) ? "selected" : undefined}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selected.includes(r.run_id)}
                        onCheckedChange={() => toggle(r.run_id)}
                        aria-label={`Select ${r.run_id}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div>{formatDateTime(r.created_at)}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {r.run_id}
                      </div>
                    </TableCell>
                    <TableCell>
                      <TierBadge tier={r.run_tier} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="tabular-nums">{r.total_cases}</TableCell>
                    <TableCell className="tabular-nums">{r.passed_cases}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress
                          value={(r.passed_cases / Math.max(r.total_cases, 1)) * 100}
                          className="h-1.5 flex-1"
                        />
                        <span className="w-14 text-right tabular-nums text-muted-foreground">
                          {passRate(r.passed_cases, r.total_cases)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/runs/${r.run_id}?org=${orgId}`}>
                          <Eye /> View
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {compare && <ComparePanel compare={compare} />}
    </div>
  );
}

function ComparePanel({ compare }: { compare: CompareResult }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Comparison</CardTitle>
        <CardDescription className="font-mono text-xs">
          baseline {compare.run_a} → current {compare.run_b}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-6 text-sm">
          <span className="flex items-center gap-2">
            <ArrowUpRight className="h-4 w-4 text-emerald-400" />
            <strong className="tabular-nums">{compare.new_passes.length}</strong> fixed
          </span>
          <span className="flex items-center gap-2">
            <ArrowDownRight className="h-4 w-4 text-red-400" />
            <strong className="tabular-nums">{compare.regressions.length}</strong>{" "}
            regressed
          </span>
          <span className="flex items-center gap-2">
            <Minus className="h-4 w-4 text-muted-foreground" />
            <strong className="tabular-nums">{compare.stable.length}</strong> stable
          </span>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <CompareList
            title="Regressions"
            empty="Nothing regressed."
            entries={compare.regressions}
            tone="text-red-400"
          />
          <CompareList
            title="Fixed"
            empty="No new passes."
            entries={compare.new_passes}
            tone="text-emerald-400"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function CompareList({
  title,
  entries,
  empty,
  tone,
}: {
  title: string;
  entries: CompareResult["regressions"];
  empty: string;
  tone: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className={`mb-2 text-sm font-medium ${tone}`}>{title}</div>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {entries.map((e) => (
            <li key={`${e.case_id}-${e.tier}-v${e.variant_num}`} className="flex items-center gap-2">
              <span className="font-mono text-xs">
                {e.case_id}#{e.tier === "kb" ? "kb" : `v${e.variant_num}`}
              </span>
              <span className="truncate text-muted-foreground">{e.case_name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
