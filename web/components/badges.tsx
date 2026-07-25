import { Badge } from "@/components/ui/badge";
import { RunStatus, RunTier } from "@/lib/types";

export function StatusBadge({ status }: { status: RunStatus }) {
  switch (status) {
    case "completed":
      return <Badge variant="success">Completed</Badge>;
    case "running":
      return <Badge variant="default">Running</Badge>;
    case "queued":
      return <Badge variant="secondary">Queued</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
  }
}

export function TierBadge({ tier }: { tier: RunTier }) {
  const label = tier === "both" ? "KB + Pathway" : tier === "kb" ? "KB" : "Pathway";
  return <Badge variant="outline">{label}</Badge>;
}

export function PassBadge({ passed }: { passed: boolean }) {
  return passed ? (
    <Badge variant="success">Pass</Badge>
  ) : (
    <Badge variant="destructive">Fail</Badge>
  );
}
