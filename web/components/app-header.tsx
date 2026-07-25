"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/cases", label: "Test Cases" },
  { href: "/history", label: "Run History" },
];

export function AppHeader() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const qs = searchParams.toString();

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="container flex h-14 items-center gap-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <FlaskConical className="h-4 w-4" />
          </span>
          KB Regression Testing
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={qs ? `${item.href}?${qs}` : item.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:text-foreground",
                pathname === item.href && "bg-accent text-foreground"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
