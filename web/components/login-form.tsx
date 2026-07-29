"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, FlaskConical, Loader2, Mail } from "lucide-react";
import { browserClient, ALLOWED_DOMAIN, isAllowedEmail } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function LoginForm({ allowedDomain }: { allowedDomain: string }) {
  const params = useSearchParams();
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Messages the middleware and callback redirect here with.
  const notice =
    params.get("denied") === "domain"
      ? `Only @${allowedDomain} accounts can access this dashboard.`
      : params.get("error") === "link_invalid"
        ? "That sign-in link has expired or was already used. Request a new one."
        : params.get("error") === "missing_code"
          ? "That link was incomplete. Request a new one."
          : null;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const address = email.trim();
    // UX only — the real gate is server-side, in middleware and the callback.
    if (!isAllowedEmail(address)) {
      setError(`Use your @${allowedDomain} email address.`);
      return;
    }
    setBusy(true);
    try {
      const next = params.get("next");
      const redirectTo =
        `${window.location.origin}/auth/callback` +
        (next ? `?next=${encodeURIComponent(next)}` : "");
      const { error } = await browserClient().auth.signInWithOtp({
        email: address,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      setSent(true);
    } catch (err: any) {
      setError(err?.message ?? "Could not send the sign-in link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <FlaskConical className="h-4 w-4" />
            </span>
            <span className="font-semibold">KB Regression Testing</span>
          </div>
          <CardTitle className="text-base">Sign in</CardTitle>
          <CardDescription>
            We&apos;ll email you a sign-in link. Restricted to @{allowedDomain}{" "}
            accounts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {notice && (
            <p className="mb-4 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
              {notice}
            </p>
          )}

          {sent ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                Link sent
              </div>
              <p className="text-sm text-muted-foreground">
                Check <span className="text-foreground">{email}</span> and open
                the link to finish signing in. It expires in an hour.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSent(false)}
                className="px-0"
              >
                Use a different address
              </Button>
            </div>
          ) : (
            <form onSubmit={send} className="space-y-3">
              <Input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={`you@${allowedDomain}`}
                autoComplete="email"
              />
              {error && <p className="text-sm text-red-400">{error}</p>}
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? <Loader2 className="animate-spin" /> : <Mail />}
                Email me a sign-in link
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
