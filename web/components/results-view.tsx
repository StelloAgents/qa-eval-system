"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Search } from "lucide-react";
import { api } from "@/lib/api";
import { EvalResult, RunStatusResponse } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { PassBadge, TierBadge } from "@/components/badges";
import { TranscriptDialog } from "@/components/transcript-dialog";

type PassFilter = "all" | "pass" | "fail";
type TierFilter = "all" | "kb" | "pathway";

export function ResultsView({ runId, orgId }: { runId: string; orgId: string }) {
  const router = useRouter();
  const [status, setStatus] = React.useState<RunStatusResponse | null>(null);
  const [results, setResults] = React.useState<EvalResult[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const [passFilter, setPassFilter] = React.useState<PassFilter>("all");
  const [tierFilter, setTierFilter] = React.useState<TierFilter>("all");
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<EvalResult | null>(null);

  React.useEffect(() => {
    Promise.all([api.getRun(runId), api.getRunResults(runId)])
      .then(([s, rs]) => {
        setStatus(s);
        setResults(rs);
      })
      .catch(() => setError("Could not load this run."));
  }, [runId]);

  const filtered = React.useMemo(() => {
    if (!results) return [];
    const q = query.trim().toLowerCase();
    return results.filter((r) => {
      if (passFilter === "pass" && !r.passed) return false;
      if (passFilter === "fail" && r.passed) return false;
      if (tierFilter !== "all" && r.tier !== tierFilter) return false;
      if (q && !r.case_id.toLowerCase().includes(q) && !r.case_name.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [results, passFilter, tierFilter, query]);

  const firstNote = (r: EvalResult) => r.notes[0]?.message ?? "";

  return (
    <div className="container space-y-6 py-8">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft />
        </Button>
        <div>
          <h1 className="flex items-center gap-3 text-xl font-semibold">
            Run Results
            {status && <PassBadge passed={status.passed_cases === status.total_cases} />}
          </h1>
          <p className="font-mono text-xs text-muted-foreground">{runId}</p>
        </div>
        {status && (
          <div className="ml-auto text-right text-sm text-muted-foreground">
            <div className="tabular-nums">
              {status.passed_cases}/{status.total_cases} passed
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search case id or name…"
              className="pl-9"
            />
          </div>
          <Select value={passFilter} onValueChange={(v) => setPassFilter(v as PassFilter)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All results</SelectItem>
              <SelectItem value="pass">Passed</SelectItem>
              <SelectItem value="fail">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Select value={tierFilter} onValueChange={(v) => setTierFilter(v as TierFilter)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tiers</SelectItem>
              <SelectItem value="kb">KB</SelectItem>
              <SelectItem value="pathway">Pathway</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {!results && !error ? (
            <div className="p-6">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : error ? (
            <p className="p-6 text-sm text-muted-foreground">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No results match these filters.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Case</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead className="w-[30%]">Question</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="w-[25%]">Notes</TableHead>
                  <TableHead>Chat ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => setSelected(r)}
                  >
                    <TableCell>
                      <div className="font-medium">{r.case_name}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {r.case_id}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.tier === "kb" ? "—" : `v${r.variant_num}`}
                    </TableCell>
                    <TableCell>
                      <TierBadge tier={r.tier} />
                    </TableCell>
                    <TableCell className="max-w-0 truncate text-muted-foreground">
                      {r.question}
                    </TableCell>
                    <TableCell>
                      <PassBadge passed={r.passed} />
                    </TableCell>
                    <TableCell className="max-w-0">
                      {r.notes.length > 0 && (
                        <span
                          className={cn(
                            "block truncate text-xs",
                            r.notes[0].type === "hard_gate"
                              ? "text-red-400"
                              : r.notes[0].type === "advisory"
                                ? "text-amber-400"
                                : "text-muted-foreground"
                          )}
                        >
                          {firstNote(r)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {r.chat_id ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {filtered.length} of {results?.length ?? 0} results
        </span>
        {results?.[0] && <span>Ran {formatDateTime(results[0].created_at)}</span>}
      </div>

      <TranscriptDialog result={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
