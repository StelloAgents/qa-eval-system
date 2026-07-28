"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  RotateCcw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  EvalOrg,
  GraderPrompt,
  GraderSummary,
  OrgCases,
  TestCaseSummary,
} from "@/lib/types";
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
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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

// What this grader enforces, in words. A raw regex is unreadable in a
// catalogue meant to tell a person what the agent is held to, so an authored
// `description` always wins; the pattern itself is shown separately, demoted.
function graderDetail(g: GraderSummary): string {
  if (g.description) {
    return g.scope === "last_turn"
      ? `${g.description} (checked on the final reply)`
      : g.description;
  }
  if (g.any?.length) return `any of ${g.any.map((s) => `"${s}"`).join(", ")}`;
  if (g.all?.length) return `all of ${g.all.map((s) => `"${s}"`).join(", ")}`;
  if (g.type === "payment_due") return "date computed from today's schedule";
  if (g.type === "judge") return "decides pass/fail against the expected outcome";
  if (g.pattern) return "must not match the pattern below";
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
                <CaseCard key={c.id} c={c} orgId={orgId} />
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

function CaseCard({ c, orgId }: { c: TestCaseSummary; orgId: string }) {
  const multiTurn = c.variants.some((v) => v.turns.length > 1);
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{c.name}</CardTitle>
          <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            {c.id}
          </code>
          {c.application && c.application !== c.category && (
            <span className="text-xs text-muted-foreground">{c.application}</span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {c.tiers.map((t) => (
              <Badge key={t} variant="outline">
                {t === "kb" ? "KB" : "Pathway"}
              </Badge>
            ))}
            {multiTurn && <Badge variant="secondary">Multi-turn</Badge>}
          </div>
        </div>
        {/* whitespace-pre-line keeps the paragraph breaks in longer expected
            outcomes (troubleshooting steps, guardrails) readable. */}
        <CardDescription className="whitespace-pre-line pt-1 leading-relaxed text-foreground/80">
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
                  <span className="min-w-0 text-muted-foreground">
                    {graderDetail(g)}
                    {meta.weight && (
                      <span className="ml-1.5 text-xs opacity-70">
                        ({meta.weight})
                      </span>
                    )}
                    {/* The pattern stays available for anyone maintaining the
                        case, but never as the primary explanation. */}
                    {g.pattern && (
                      <code
                        title={g.pattern}
                        className="mt-1 block overflow-x-auto whitespace-nowrap rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-[11px] opacity-60"
                      >
                        {g.pattern}
                      </code>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <GraderPromptEditor orgId={orgId} caseId={c.id} initiallyCustomised={c.grader_prompt_customised} />
      </CardContent>
    </Card>
  );
}

/** Mirror of renderJudgePrompt() on the client so the preview tracks the draft
 * as it is typed. The server sends back its own `rendered` for the saved
 * template; this keeps the two in step for unsaved edits. Unknown placeholders
 * are deliberately left intact — that is what the judge would receive. */
function renderPreview(template: string, d: GraderPrompt): string {
  const map: Record<string, string> = {
    org: d.values.org,
    today: d.values.today,
    expected: d.values.expected,
    conversation: d.values.conversation,
    ground_truth: d.values.ground_truth
      ? `VERIFIED GROUND TRUTH (already computed -- trust this over your own arithmetic):\n${d.values.ground_truth}\n\n`
      : "",
  };
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    key in map ? map[key] : whole
  );
}

/** The prompt the LLM judge is actually sent for this case. Loads lazily on
 * expand so the catalogue does not fire one request per case on mount. */
function GraderPromptEditor({
  orgId,
  caseId,
  initiallyCustomised,
}: {
  orgId: string;
  caseId: string;
  initiallyCustomised: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<GraderPrompt | null>(null);
  const [draft, setDraft] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [customised, setCustomised] = React.useState(initiallyCustomised);
  const [tab, setTab] = React.useState<"edit" | "preview">("edit");

  React.useEffect(() => {
    if (!open || data) return;
    api
      .getGraderPrompt(orgId, caseId)
      .then((d) => {
        setData(d);
        setDraft(d.effective);
      })
      .catch(() => toast.error("Could not load the grader prompt."));
  }, [open, data, orgId, caseId]);

  // Reset when the org changes underneath a mounted card.
  React.useEffect(() => {
    setData(null);
    setDraft("");
    setOpen(false);
    setCustomised(initiallyCustomised);
  }, [orgId, caseId, initiallyCustomised]);

  const dirty = !!data && draft !== data.effective;

  async function save() {
    setBusy(true);
    try {
      const next = await api.saveGraderPrompt(orgId, caseId, draft);
      setData(next);
      setDraft(next.effective);
      setCustomised(!next.is_default);
      toast.success("Grader prompt saved.");
      if (next.warning) toast.warning(next.warning);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save the grader prompt.");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      const next = await api.resetGraderPrompt(orgId, caseId);
      setData(next);
      setDraft(next.effective);
      setCustomised(false);
      toast.success("Reverted to the default grader prompt.");
    } catch {
      toast.error("Could not reset the grader prompt.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-t pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Grader prompt
        </span>
        {customised ? (
          <Badge className="border-0 bg-primary/10 text-primary">Customised</Badge>
        ) : (
          <span className="text-xs text-muted-foreground">default</span>
        )}
      </button>

      {open && (
        !data ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="space-y-2">
            <div className="flex gap-1">
              {(["edit", "preview"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs capitalize transition-colors",
                    tab === t
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t === "preview" ? "Preview filled" : "Edit template"}
                </button>
              ))}
            </div>

            {tab === "edit" ? (
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                rows={16}
                className="resize-y font-mono text-xs leading-relaxed"
              />
            ) : (
              <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-secondary/30 p-3 font-mono text-xs leading-relaxed">
                {renderPreview(draft, data)}
              </pre>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={save} disabled={busy || !dirty}>
                {busy && <Loader2 className="animate-spin" />}
                {dirty ? "Save" : "Saved"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={reset}
                disabled={busy || (data.is_default && !dirty)}
                title="Revert this case to the default grader prompt"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset to default
              </Button>
              {dirty && (
                <span className="text-xs text-amber-400">unsaved changes</span>
              )}
            </div>
            {/* What each slot actually resolves to for this case — without
                this the template is a set of names with invisible contents. */}
            <div className="space-y-1.5 rounded-md border p-3">
              <Label>Placeholder values for this case</Label>
              {data.placeholders.map((p) => {
                const key = p.token.replace(/[{}]/g, "") as keyof typeof data.values;
                const val = data.values[key];
                return (
                  <div key={p.token} className="flex gap-2 text-[11px]">
                    <code className="mt-px h-fit shrink-0 rounded bg-secondary px-1 py-0.5 font-mono">
                      {p.token}
                    </code>
                    <span className="min-w-0 flex-1 whitespace-pre-line break-words text-muted-foreground">
                      {val ? (
                        val
                      ) : (
                        <em>
                          empty for this case — {p.token} renders as nothing
                        </em>
                      )}
                    </span>
                  </div>
                );
              })}
              <p className="pt-1 text-[11px] text-muted-foreground opacity-70">
                Values are substituted at grade time; the judge never sees the
                braces. The transcript is a stand-in — the real one comes from
                the run. Ground truth is shown for variant 1.
              </p>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}
