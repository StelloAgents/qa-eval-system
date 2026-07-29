"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { TestCaseSummary } from "@/lib/types";

// Category-grouped case selector: pick all cases, a whole category, or
// individual cases. Category checkboxes are tri-state (indeterminate on a
// partial selection). Selection is a set of case ids owned by the parent.

export function CasePicker({
  cases,
  selected,
  onChange,
  disabled,
}: {
  cases: TestCaseSummary[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
}) {
  const groups = React.useMemo(() => {
    const m = new Map<string, TestCaseSummary[]>();
    for (const c of cases) {
      const arr = m.get(c.category) ?? [];
      arr.push(c);
      m.set(c.category, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [cases]);

  const [open, setOpen] = React.useState<Set<string>>(new Set());

  const setMany = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    for (const id of ids) (on ? next.add(id) : next.delete(id));
    onChange(next);
  };

  const allIds = cases.map((c) => c.id);
  const allOn = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someOn = allIds.some((id) => selected.has(id));
  const masterState: boolean | "indeterminate" = allOn ? true : someOn ? "indeterminate" : false;

  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Checkbox
          checked={masterState}
          disabled={disabled}
          onCheckedChange={() => setMany(allIds, !allOn)}
          aria-label="Select all cases"
        />
        <span className="text-sm font-medium">All cases</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {selected.size} of {allIds.length} selected
        </span>
      </div>

      <div className="max-h-72 overflow-y-auto">
        {groups.map(([category, group]) => {
          const ids = group.map((c) => c.id);
          const catAll = ids.every((id) => selected.has(id));
          const catSome = ids.some((id) => selected.has(id));
          const catState: boolean | "indeterminate" = catAll
            ? true
            : catSome
              ? "indeterminate"
              : false;
          const expanded = open.has(category);
          return (
            <div key={category} className="border-b last:border-b-0">
              <div className="flex items-center gap-2 px-3 py-2">
                <Checkbox
                  checked={catState}
                  disabled={disabled}
                  onCheckedChange={() => setMany(ids, !catAll)}
                  aria-label={`Select all ${category}`}
                />
                <button
                  type="button"
                  className="flex flex-1 items-center gap-1 text-left text-sm"
                  onClick={() =>
                    setOpen((o) => {
                      const n = new Set(o);
                      n.has(category) ? n.delete(category) : n.add(category);
                      return n;
                    })
                  }
                >
                  {expanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span className="font-medium">{category}</span>
                  <span className="text-xs text-muted-foreground">
                    ({ids.filter((id) => selected.has(id)).length}/{ids.length})
                  </span>
                </button>
              </div>
              {expanded && (
                <ul className="pb-1">
                  {group.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 py-1 pl-9 pr-3">
                      <Checkbox
                        checked={selected.has(c.id)}
                        disabled={disabled}
                        onCheckedChange={() => setMany([c.id], !selected.has(c.id))}
                        aria-label={c.name}
                      />
                      <span className="text-sm text-muted-foreground">
                        {c.name}
                        <span className="ml-1 text-xs opacity-60">
                          · {c.variants.length} variant{c.variants.length === 1 ? "" : "s"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
