"use client";

import { EvalResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { PassBadge, TierBadge } from "@/components/badges";

const NOTE_STYLE: Record<string, string> = {
  judge: "bg-primary/10 text-primary",
  advisory: "bg-amber-500/10 text-amber-400",
  hard_gate: "bg-red-500/10 text-red-400",
  error: "bg-red-500/10 text-red-400",
};

export function TranscriptDialog({
  result,
  onClose,
}: {
  result: EvalResult | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!result} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        {result && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                {result.case_name}
                <PassBadge passed={result.passed} />
                <TierBadge tier={result.tier} />
              </DialogTitle>
              <DialogDescription className="font-mono text-xs">
                {result.case_id}
                {result.tier === "pathway" && `#v${result.variant_num}`}
                {result.chat_id && ` · ${result.chat_id}`}
              </DialogDescription>
            </DialogHeader>

            {result.exchanges.length > 0 ? (
              <div className="space-y-4">
                {result.exchanges.map((ex, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex justify-start">
                      <div className="max-w-[85%] rounded-xl rounded-bl-sm bg-secondary px-4 py-2.5 text-sm">
                        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          Caller
                        </div>
                        {ex.user}
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-xl rounded-br-sm bg-primary/15 px-4 py-2.5 text-sm">
                        <div className="mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-primary">
                          Agent
                          {ex.node && (
                            <span className="font-mono normal-case text-muted-foreground">
                              · {ex.node}
                            </span>
                          )}
                        </div>
                        {ex.assistant}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="rounded-xl bg-secondary px-4 py-2.5">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    KB Query
                  </div>
                  {result.question}
                </div>
                <div className="rounded-xl bg-primary/15 px-4 py-2.5">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-primary">
                    KB Response
                  </div>
                  {result.answer || <em className="text-muted-foreground">(empty)</em>}
                </div>
              </div>
            )}

            {result.notes.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Grader notes
                  </div>
                  {result.notes.map((n, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <Badge className={cn("shrink-0 border-0", NOTE_STYLE[n.type])}>
                        {n.type.replace("_", " ")}
                      </Badge>
                      <span className="text-muted-foreground">{n.message}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
