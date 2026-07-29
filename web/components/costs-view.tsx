"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { DollarSign } from "lucide-react";
import { api } from "@/lib/api";
import { CostSummary, EvalOrg } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { TierBadge } from "@/components/badges";

/** Grader spend is fractions of a cent per call, so the usual 2-decimal
 * currency format would render almost everything as $0.00. */
const usd = (n: number) =>
  n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(4)}`;

export function CostsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgFilter = searchParams.get("org") ?? "all";

  const [orgs, setOrgs] = React.useState<EvalOrg[]>([]);
  const [data, setData] = React.useState<CostSummary | null>(null);

  React.useEffect(() => {
    // Never leave this unguarded: a database outage makes every endpoint
    // 500, and an unhandled rejection here takes the whole page down with
    // a client-side exception instead of showing anything useful.
    api.listOrgs().then(setOrgs).catch(() => setOrgs([]));
  }, []);

  React.useEffect(() => {
    setData(null);
    api.getCosts(orgFilter === "all" ? undefined : orgFilter).then(setData);
  }, [orgFilter]);

  function selectOrg(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("org");
    else params.set("org", next);
    const qs = params.toString();
    router.push(qs ? `?${qs}` : "/costs");
  }

  const avgPerRun =
    data && data.total_runs ? data.total_cost / data.total_runs : 0;

  return (
    <div className="container space-y-6 py-8">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-xl font-semibold">Cost</h1>
          <p className="text-sm text-muted-foreground">
            Grader spend, taken from the cost OpenRouter reported on each judge
            call — not estimated.
          </p>
        </div>
        <Select value={orgFilter} onValueChange={selectOrg}>
          <SelectTrigger className="ml-auto w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All organizations</SelectItem>
            {orgs.map((o) => (
              <SelectItem key={o.org_id} value={o.org_id}>
                {o.org_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!data ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Total spend" value={usd(data.total_cost)} icon />
            <Stat label="Runs" value={String(data.total_runs)} />
            <Stat label="Judge calls" value={data.total_graded_calls.toLocaleString()} />
            <Stat label="Avg per run" value={usd(avgPerRun)} />
          </div>

          {data.total_graded_calls === 0 && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                No graded runs recorded yet. Cost is captured per judge call, so
                this fills in once a pathway-tier run completes. KB-tier runs are
                substring checks and cost nothing.
              </CardContent>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">By organization</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.by_org.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing recorded.</p>
                ) : (
                  data.by_org.map((o) => (
                    <div key={o.org_id} className="flex items-center gap-3 text-sm">
                      <span className="font-mono text-xs">{o.org_id}</span>
                      <span className="text-muted-foreground">{o.runs} runs</span>
                      <span className="ml-auto tabular-nums">{usd(o.cost)}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">By grader model</CardTitle>
                <CardDescription>
                  Historical, so switching models keeps past spend attributed
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.by_model.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing recorded.</p>
                ) : (
                  data.by_model.map((m) => (
                    <div key={m.judge_model} className="flex items-center gap-3 text-sm">
                      <code className="font-mono text-xs">{m.judge_model}</code>
                      <span className="text-muted-foreground">{m.calls} calls</span>
                      <span className="ml-auto tabular-nums">{usd(m.cost)}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Per run</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {data.runs.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">No runs yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Org</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead className="text-right">Judge calls</TableHead>
                      <TableHead className="text-right">Tokens</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.runs.map((r) => (
                      <TableRow key={r.run_id}>
                        <TableCell>
                          <Link
                            href={`/runs/${r.run_id}?org=${r.org_id}`}
                            className="hover:underline"
                          >
                            {formatDateTime(r.created_at)}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{r.org_id}</TableCell>
                        <TableCell>
                          <TierBadge tier={r.run_tier as "kb" | "pathway" | "both"} />
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {r.judge_model ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.graded_calls}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {(r.prompt_tokens + r.completion_tokens).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {usd(r.cost)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
          {icon && <DollarSign className="h-3.5 w-3.5" />}
          {label}
        </div>
        <div className="pt-1 text-2xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}
