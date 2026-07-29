import { NextRequest, NextResponse } from "next/server";
import { isAllowedEmail, middlewareClient } from "@/lib/auth";

// Where the magic link lands. Exchanges the one-time code for a session, then
// checks the domain again — Supabase will happily create a user for any email
// that requests a link, so this is the point where a non-Stello address is
// turned away and its session destroyed rather than left dormant.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const next = req.nextUrl.searchParams.get("next") || "/";

  const redirect = (path: string) => {
    const url = req.nextUrl.clone();
    url.pathname = path.split("?")[0];
    url.search = path.includes("?") ? path.slice(path.indexOf("?")) : "";
    return NextResponse.redirect(url);
  };

  if (!code) return redirect("/login?error=missing_code");

  const res = redirect(next.startsWith("/") ? next : "/");
  const supabase = middlewareClient(req, res as any);

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return redirect("/login?error=link_invalid");

  if (!isAllowedEmail(data.user?.email)) {
    // Destroy the session so a rejected address is not left signed in with a
    // valid cookie that merely fails the middleware check on every request.
    await supabase.auth.signOut();
    return redirect("/login?denied=domain");
  }

  return res;
}
