import { cn } from "@/lib/utils";

export function PassRateRing({
  passed,
  total,
  size = 96,
  stroke = 8,
  className,
}: {
  passed: number;
  total: number;
  size?: number;
  stroke?: number;
  className?: string;
}) {
  const pct = total ? passed / total : 0;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const color =
    pct >= 0.95 ? "stroke-emerald-400" : pct >= 0.85 ? "stroke-amber-400" : "stroke-red-400";

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          className="fill-none stroke-secondary"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          className={cn("fill-none transition-all duration-700", color)}
        />
      </svg>
      <div className="absolute text-center">
        <div className="text-xl font-bold tabular-nums">{(pct * 100).toFixed(1)}%</div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          pass rate
        </div>
      </div>
    </div>
  );
}
