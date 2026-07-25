"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Search } from "lucide-react";
import { api } from "@/lib/api";
import { EvalOrg, GraderSummary, OrgCases, TestCaseSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

// How each grader type is described to a reader. The wording carries the
// grading contract from SPEC.md: only hard gates and the judge can fail a run.
const GRADER_LABEL: Record<
  string,
  { label: string; weight: string; className: string }
> = {
  judge: {
    label: "LLM judge",
    weight: "authoritative",
    className: "bg-primary/10 text-primary",
  },
  contains: {
    label: "Must mention",
    weight: "advisory",
    className: "bg-amber-500/10 text-amber-400",
  },
  payment_due: {
    label: "Payment date check",
    weight: "advisory",
    className: "bg-amber-500/10 text-amber-400",
  },
  forbidden: {
    label: "Must not say",
    weight: "hard gate",
    className: "bg-red-500/10 text-red-400",
  },
  forbidden_regex: {
    label: "Must not match",
    weight: "hard gate",
    className: "bg-red-500/10 text-red-400",
  },
};

function graderDetail(g: GraderSummary): string {
  if (g.any?.length) return `any of ${g.any.map((s) => `"${s}"`).join(", ")}`;
  if (g.all?.length) return `all of ${g.all.map((s) => `"${s}"`).join(", ")}`;
  if (g.pattern) {
    return `/${g.pattern}/${g.scope === "last_turn" ? " on the final reply" : ""}`;
  }
  if (g.type === "payment_due") return "date computed from today's schedule";
  if (g.type === "judge") return "decides pass/fail against the expected outcome";
  return "";
}

export function CasesView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgId = searchParams.get("org") ?? "texans";

  const [orgs, setOrgs] = React.useState<EvalOrg[]>([]);
  const [data, setData] = React.useState<OrgCases | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState("all");

  React.useEffect(() => {
    api.listOrgs().then(setOrgs);
  }, []);

  React.useEffect(() => {
    setData(null);
    setError(null);
    setCategory("all");
    api
      .getOrgCases(orgId)
      .then(setData)
      .catch(() => setError(`No test cases found for "${orgId}".`));
  }, [orgId]);

  const categories = React.useMemo(
    () => [...new Set(data?.cases.map((c) => c.category) ?? [])].sort(),
    [data]
  );

  const filtered = React.useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.cases.filter((c) => {
      if (category !== "all" && c.category !== category) return false;
      if (!q) return true;
      // Search the prompts too — people look for a case by what it asks.
      return (
        c.id.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.expected.toLowerCase().includes(q) ||
        c.variants.some((v) => v.turns.some((t) => t.toLowerCase().includes(q)))
      );
    });
  }, [data, query, category]);

  const grouped = React.useMemo(() => {
    const m = new Map<string, TestCaseSummary[]>();
    for (const c of filtered) m.set(c.category, [...(m.get(c.category) ?? []), c]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  function selectOrg(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("org", next);
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="container space-y-6 py-8">
      <div>
        <h1 className="text-xl font-semibold">Test Cases</h1>
        <p className="text-sm text-muted-foreground">
          Every scenario this org is graded on, read live from{" "}
          <code className="font-mono text-xs">{orgId}/evals/cases.json</code> —
          the same file the runner executes.
        </p>
      </div>

      {/* Controls + counts */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
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
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search cases, expected outcomes, or prompts…"
              className="pl-9"
            />
          </div>
        </CardContent>
        {data && (
          <div className="flex flex-wrap gap-6 border-t px-4 py-3 text-sm">
            <Stat n={data.total_cases} label="cases" />
            <Stat n={data.pathway_runs} label="pathway runs per eval" />
            <Stat n={data.kb_checks} label="KB checks per eval" />
          </div>
        )}
      </Card>

      {error ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            {error}
          </CardContent>
        </Card>
      ) : !data ? (
        <Skeleton className="h-96 w-full" />
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No cases match these filters.
          </CardContent>
        </Card>
      ) : (
        grouped.map(([cat, cases]) => (
          <section key={cat} className="space-y-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {cat}
              </h2>
              <span className="text-xs text-muted-foreground">
                {cases.length} {cases.length === 1 ? "case" : "cases"}
              </span>
              <Separator className="flex-1" />
            </div>
            <div className="space-y-3">
              {cases.map((c) => (
                <CaseCard key={c.id} c={c} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-lg font-semibold tabular-nums">{n}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function CaseCard({ c }: { c: TestCaseSummary }) {
  const multiTurn = c.variants.some((v) => v.turns.length > 1);
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{c.name}</CardTitle>
          <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            {c.id}
          </code>
          <div className="ml-auto flex items-center gap-1.5">
            {c.tiers.map((t) => (
              <Badge key={t} variant="outline">
                {t === "kb" ? "KB" : "Pathway"}
              </Badge>
            ))}
            {multiTurn && <Badge variant="secondary">Multi-turn</Badge>}
          </div>
        </div>
        <CardDescription className="pt-1 leading-relaxed text-foreground/80">
          {c.expected}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {c.untestable_reason && (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
            Partially excluded: {c.untestable_reason}
          </p>
        )}

        {/* Prompts */}
        <div className="space-y-1.5">
          <Label>
            {c.variants.length} phrasing{c.variants.length === 1 ? "" : "s"}
          </Label>
          <ul className="space-y-1.5">
            {c.variants.map((v, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5 shrink-0 font-mono text-xs text-muted-foreground">
                  v{i + 1}
                </span>
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  {v.turns.map((t, j) => (
                    <React.Fragment key={j}>
                      {j > 0 && (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="text-muted-foreground">“{t}”</span>
                    </React.Fragment>
                  ))}
                  {v.plan && (
                    <Badge variant="secondary" className="ml-1">
                      {v.plan}-month plan
                    </Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* KB assertions */}
        {c.kb_expect?.length ? (
          <div className="space-y-1.5">
            <Label>KB tier must return</Label>
            <div className="flex flex-wrap gap-1.5">
              {c.kb_expect.map((s) => (
                <code
                  key={s}
                  className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs"
                >
                  {s}
                </code>
              ))}
            </div>
          </div>
        ) : null}

        {/* Graders */}
        <div className="space-y-1.5">
          <Label>Graded by</Label>
          <div className="space-y-1.5">
            {c.graders.map((g, i) => {
              const meta = GRADER_LABEL[g.type] ?? {
                label: g.type,
                weight: "",
                className: "bg-secondary text-muted-foreground",
              };
              return (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <Badge className={cn("shrink-0 border-0", meta.className)}>
                    {meta.label}
                  </Badge>
                  <span className="text-muted-foreground">
                    {graderDetail(g)}
                    {meta.weight && (
                      <span className="ml-1.5 text-xs opacity-70">
                        ({meta.weight})
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}
