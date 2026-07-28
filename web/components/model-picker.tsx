"use client";

import * as React from "react";
import { Cpu, Loader2, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { JudgeModel, ModelCatalogue } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Sorts are limited to what OpenRouter actually publishes. There is no
// "reliability" figure in their API; the closest is Artificial Analysis's
// intelligence index, which is present for roughly a third of models — so it
// is labelled as what it is rather than dressed up as reliability.
type SortKey = "cost" | "intelligence" | "context" | "name";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "cost", label: "Cost per run" },
  { key: "intelligence", label: "Intelligence" },
  { key: "context", label: "Context length" },
  { key: "name", label: "Name" },
];

const usd = (n: number) =>
  n === 0 ? "free" : n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(4)}`;
const perMTok = (n: number) => (n === 0 ? "—" : `$${(n * 1e6).toFixed(3)}`);

export function ModelPicker({ orgId }: { orgId: string }) {
  const [data, setData] = React.useState<ModelCatalogue | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(() => {
    setData(null);
    setError(null);
    api
      .listModels(orgId)
      .then(setData)
      .catch(() => setError("Could not load models from OpenRouter."));
  }, [orgId]);

  React.useEffect(load, [load]);

  const current = data?.models.find((m) => m.id === data.selected);

  async function choose(id: string) {
    setBusy(true);
    try {
      await api.setJudgeModel(orgId, id);
      setData((d) => (d ? { ...d, selected: id, is_default: false } : d));
      setOpen(false);
      toast.success(`Grader model set to ${id}`);
    } catch {
      toast.error("Could not change the grader model.");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      const r = await api.resetJudgeModel(orgId);
      setData((d) => (d ? { ...d, selected: r.model, is_default: true } : d));
      toast.success("Reverted to the default grader model.");
    } catch {
      toast.error("Could not reset the grader model.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="h-4 w-4 text-muted-foreground" />
          Grader model
          {data && !data.is_default && (
            <Badge className="border-0 bg-primary/10 text-primary">Custom</Badge>
          )}
        </CardTitle>
        <CardDescription>
          The OpenRouter model that judges pass/fail for this org
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-muted-foreground">{error}</p>
        ) : !data ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <code className="font-mono text-sm">{data.selected}</code>
              {current && (
                <span className="text-sm text-muted-foreground">
                  ~
                  <span className="font-semibold tabular-nums text-foreground">
                    {usd(current.est_cost_per_run)}
                  </span>{" "}
                  per run
                </span>
              )}
            </div>
            {current ? (
              <p className="text-xs text-muted-foreground">
                Estimated from {data.estimate_basis.graded_calls} judge calls ·
                ~{data.estimate_basis.est_prompt_tokens.toLocaleString()} prompt
                tokens · {perMTok(current.prompt_price)}/M in,{" "}
                {perMTok(current.completion_price)}/M out
              </p>
            ) : (
              <p className="text-xs text-amber-400">
                This model is not in OpenRouter&apos;s current list — it may have
                been retired.
              </p>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setOpen(true)} disabled={busy}>
                Change model
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={reset}
                disabled={busy || data.is_default}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Default
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      {data && (
        <ModelDialog
          open={open}
          onOpenChange={setOpen}
          data={data}
          busy={busy}
          onChoose={choose}
        />
      )}
    </Card>
  );
}

function ModelDialog({
  open,
  onOpenChange,
  data,
  busy,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  data: ModelCatalogue;
  busy: boolean;
  onChoose: (id: string) => void;
}) {
  const [sort, setSort] = React.useState<SortKey>("cost");
  const [query, setQuery] = React.useState("");
  const [freeOnly, setFreeOnly] = React.useState(false);
  const [scoredOnly, setScoredOnly] = React.useState(false);

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = data.models.filter(
      (m) =>
        (!q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)) &&
        (!freeOnly || m.is_free) &&
        (!scoredOnly || m.intelligence !== null)
    );
    const by: Record<SortKey, (a: JudgeModel, b: JudgeModel) => number> = {
      cost: (a, b) => a.est_cost_per_run - b.est_cost_per_run,
      // Unscored models sort last rather than reading as zero.
      intelligence: (a, b) => (b.intelligence ?? -1) - (a.intelligence ?? -1),
      context: (a, b) => b.context_length - a.context_length,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return [...list].sort(by[sort]);
  }, [data.models, sort, query, freeOnly, scoredOnly]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* DialogContent is a grid by default, which sizes rows to content and
          then clips them against max-h. Switching to a flex column lets the
          table area take the leftover height and scroll inside it. */}
      <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle>Choose a grader model</DialogTitle>
          <DialogDescription>
            Cost is estimated for one full run of this org&apos;s suite —{" "}
            {data.estimate_basis.graded_calls} judge calls at ~
            {data.estimate_basis.est_prompt_tokens.toLocaleString()} prompt
            tokens. Intelligence is Artificial Analysis&apos;s index where
            OpenRouter publishes one.
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models…"
              className="pl-9"
            />
          </div>
          {SORTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSort(s.key)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs transition-colors",
                sort === s.key
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setFreeOnly((v) => !v)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs transition-colors",
              freeOnly ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Free only
          </button>
          <button
            type="button"
            onClick={() => setScoredOnly((v) => !v)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs transition-colors",
              scoredOnly ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Scored only
          </button>
        </div>

        {/* min-h-0 is the load-bearing part: without it a flex child refuses
            to shrink below its content height and the scrollbar never appears. */}
        <div className="min-h-0 flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Cost / run</TableHead>
                <TableHead className="text-right">Intelligence</TableHead>
                <TableHead className="text-right">$/M in</TableHead>
                <TableHead className="text-right">$/M out</TableHead>
                <TableHead className="text-right">Context</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => (
                <TableRow key={m.id} className={cn(m.id === data.selected && "bg-accent/40")}>
                  <TableCell>
                    <div className="font-medium">{m.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{m.id}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {usd(m.est_cost_per_run)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {m.intelligence ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {perMTok(m.prompt_price)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {perMTok(m.completion_price)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {(m.context_length / 1000).toFixed(0)}k
                  </TableCell>
                  <TableCell className="text-right">
                    {m.id === data.selected ? (
                      <span className="text-xs text-muted-foreground">current</span>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => onChoose(m.id)}>
                        {busy ? <Loader2 className="animate-spin" /> : "Use"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rows.length === 0 && (
            <p className="p-6 text-sm text-muted-foreground">
              No models match these filters.
            </p>
          )}
        </div>
        <p className="shrink-0 text-xs text-muted-foreground">
          {rows.length} of {data.models.length} models
        </p>
      </DialogContent>
    </Dialog>
  );
}
