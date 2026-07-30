"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Check, Copy, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { DraftAnswer, DraftEstimate, UnansweredItem, UnansweredResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

/** Colour + label per draft status. `drafted` is the only one safe to paste
 * without reading the source first, so it's the only one styled as success. */
const STATUS: Record<string, { label: string; className: string }> = {
  drafted: { label: "Grounded", className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  unverified: { label: "Unverified", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  no_source: { label: "Not in KB", className: "bg-rose-500/10 text-rose-600 border-rose-500/20" },
  error: { label: "Failed", className: "bg-muted text-muted-foreground border-border" },
};

const stamp = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function KbGapsView() {
  const searchParams = useSearchParams();
  const orgId = searchParams.get("org") ?? "texans";

  const [runId, setRunId] = React.useState<string | null>(null);
  const [data, setData] = React.useState<UnansweredResponse | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, DraftAnswer>>({});
  // Local edits, keyed by case id. The user owns the final wording; the draft is
  // only a starting point, so an edit always wins over the model's text.
  const [edits, setEdits] = React.useState<Record<string, string>>({});
  const [drafting, setDrafting] = React.useState(false);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [estimate, setEstimate] = React.useState<DraftEstimate | null>(null);
  const [spent, setSpent] = React.useState(0);

  const load = React.useCallback(
    async (wantRun?: string) => {
      setData(null);
      setEstimate(null);
      try {
        const d = await api.unanswered(orgId, wantRun);
        setData(d);
        setRunId(d.run_id);
        setDrafts(d.drafts);
        setSpent(d.spent);
        // Saved rewrites come back as edits so the textarea shows the user's
        // wording, not the model's, exactly as they left it.
        setEdits(
          Object.fromEntries(
            Object.values(d.drafts)
              .filter((x) => x.edited_answer != null)
              .map((x) => [x.case_id, x.edited_answer as string])
          )
        );
      } catch {
        setData({
          org_id: orgId,
          run_id: null,
          items: [],
          answered: 0,
          drafts: {},
          spent: 0,
          runs: [],
        });
      }
    },
    [orgId]
  );

  React.useEffect(() => {
    load();
  }, [load]);

  // Only price the questions that have no draft yet — that is what the button
  // will actually send, so quoting the full list would overstate it.
  const undrafted = React.useMemo(
    () => (data?.items ?? []).filter((i) => !drafts[i.case_id]),
    [data, drafts]
  );

  React.useEffect(() => {
    if (!undrafted.length) {
      setEstimate(null);
      return;
    }
    api
      .draftEstimate(
        orgId,
        undrafted.map((i) => ({ case_id: i.case_id, question: i.question, expected: i.expected }))
      )
      .then(setEstimate)
      .catch(() => setEstimate(null));
  }, [orgId, undrafted]);

  async function draftAll() {
    if (!undrafted.length || !runId) return;
    setDrafting(true);
    try {
      const res = await api.draftAnswers(
        orgId,
        undrafted.map((i) => ({ case_id: i.case_id, question: i.question, expected: i.expected })),
        runId
      );
      setDrafts((s) => ({
        ...s,
        ...Object.fromEntries(res.drafts.map((d) => [d.case_id, d])),
      }));
      setSpent((s) => s + res.cost);
      const ok = res.drafts.filter((d) => d.status === "drafted").length;
      toast.success(
        `${ok} of ${res.drafts.length} grounded in ${res.kb_file} · $${res.cost.toFixed(4)}`
      );
      if (!res.persisted) {
        toast.warning(
          "Drafts were not saved — run migration 0002_kb_drafts.sql. They will be lost on reload."
        );
      }
    } catch {
      toast.error("Could not draft answers.");
    } finally {
      setDrafting(false);
    }
  }

  /** Persist an edit, debounced so typing doesn't fire a write per keystroke. */
  const editTimers = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  function editAnswer(caseId: string, value: string | null) {
    setEdits((s) => {
      const n = { ...s };
      if (value == null) delete n[caseId];
      else n[caseId] = value;
      return n;
    });
    if (!runId) return;
    clearTimeout(editTimers.current[caseId]);
    editTimers.current[caseId] = setTimeout(() => {
      api.saveDraftEdit(orgId, runId, caseId, value).catch(() => {
        /* the edit stays in local state; a failed persist must not lose it */
      });
    }, 600);
  }

  async function copy(item: UnansweredItem) {
    const text = edits[item.case_id] ?? drafts[item.case_id]?.answer ?? "";
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(item.case_id);
    setTimeout(() => setCopied((c) => (c === item.case_id ? null : c)), 1500);
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  // Two groups: what still needs an answer, and what has one. Keeps the work
  // that remains at the top instead of buried among finished rows.
  const pending = data.items.filter((i) => !drafts[i.case_id]);
  const done = data.items.filter((i) => drafts[i.case_id]);

  const renderCard = (item: UnansweredItem) => {
    const d = drafts[item.case_id];
    const status = d ? STATUS[d.status] : null;
    const value = edits[item.case_id] ?? d?.answer ?? "";
    return (
      <Card key={item.case_id}>
        <CardHeader className="space-y-1 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">{item.question}</CardTitle>
            {status && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${status.className}`}
              >
                {status.label}
              </span>
            )}
            {edits[item.case_id] != null && (
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                Edited
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {item.case_id} · {item.category}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="rounded-md bg-muted/50 px-3 py-2 text-xs italic text-muted-foreground">
            KB replied: “{item.kb_reply}”
          </p>

          {d && d.status !== "no_source" && d.status !== "error" && (
            <>
              <Textarea
                value={value}
                onChange={(e) => editAnswer(item.case_id, e.target.value)}
                rows={3}
                className="text-sm"
              />
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => copy(item)}>
                  {copied === item.case_id ? <Check /> : <Copy />}
                  {copied === item.case_id ? "Copied" : "Copy answer"}
                </Button>
                {edits[item.case_id] != null && (
                  <Button size="sm" variant="ghost" onClick={() => editAnswer(item.case_id, null)}>
                    Revert to draft
                  </Button>
                )}
              </div>
              {d.source && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none">Cited KB line</summary>
                  <p className="mt-1 border-l-2 border-border pl-3">{d.source}</p>
                </details>
              )}
            </>
          )}

          {d?.note && (
            <p
              className={`flex items-start gap-2 text-xs ${
                d.status === "drafted" ? "text-muted-foreground" : "text-amber-600"
              }`}
            >
              {d.status !== "drafted" && <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />}
              {d.note}
            </p>
          )}

          {!d && item.expected && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Expected on file:</span> {item.expected}
            </p>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-4 space-y-0">
          <div className="space-y-2">
            <CardTitle>Unanswered KB questions</CardTitle>
            {data.run_id ? (
              <p className="text-sm text-muted-foreground">
                {data.items.length} unanswered · {done.length} drafted · {data.answered} answered
                in this run
                {spent > 0 && <> · ${spent.toFixed(4)} spent drafting</>}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No completed run with a KB tier yet — run the KB or Both tier first.
              </p>
            )}
            {data.runs.length > 1 && (
              <Select value={runId ?? undefined} onValueChange={(v) => load(v)}>
                <SelectTrigger className="w-[330px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {data.runs.map((r) => (
                    <SelectItem key={r.run_id} value={r.run_id}>
                      {stamp(r.created_at)} · {r.unanswered} unanswered
                      {r.drafted > 0 && ` · ${r.drafted} drafted`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button onClick={draftAll} disabled={drafting || !undrafted.length}>
              {drafting ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {drafting
                ? "Drafting…"
                : undrafted.length
                  ? `Draft ${undrafted.length} answer${undrafted.length === 1 ? "" : "s"}`
                  : "All drafted"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {!undrafted.length ? (
                spent > 0 ? (
                  <>${spent.toFixed(4)} spent</>
                ) : (
                  " "
                )
              ) : estimate ? (
                <>
                  Est.{" "}
                  {estimate.est_cost != null
                    ? `~$${estimate.est_cost.toFixed(4)}`
                    : "cost unavailable"}
                  {" · "}
                  {estimate.questions} question{estimate.questions === 1 ? "" : "s"}
                </>
              ) : (
                "estimating…"
              )}
            </span>
          </div>
        </CardHeader>
        {!!data.items.length && (
          <CardContent className="pt-0">
            <p className="text-xs text-muted-foreground">
              Drafts are written only from your KB document and every quote is verified against
              that file. Anything the model could not ground is marked so you can spot it — paste
              the grounded ones into Bland&apos;s <span className="font-medium">Answer</span> box to
              create a Q&amp;A pair.
            </p>
          </CardContent>
        )}
      </Card>

      {data.items.length === 0 && data.run_id && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing unanswered in this run. 🎉
          </CardContent>
        </Card>
      )}

      {!!pending.length && (
        <>
          <h2 className="px-1 pt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Needs an answer ({pending.length})
          </h2>
          {pending.map(renderCard)}
        </>
      )}

      {!!done.length && (
        <>
          <h2 className="px-1 pt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Drafted ({done.length})
          </h2>
          {done.map(renderCard)}
        </>
      )}
    </div>
  );
}
