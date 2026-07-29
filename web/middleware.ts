import { NextRequest, NextResponse } from "next/server";
import { isAllowedEmail, middlewareClient } from "@/lib/auth";

// The authorisation gate. Everything except the login flow and static assets
// requires a signed-in user whose email is on the allowed domain.
//
// This covers /api/* deliberately: protecting only the pages would leave the
// endpoints open, and those trigger runs that spend Bland and OpenRouter
// credits and write to a schema in a production database.

const PUBLIC_PATHS = ["/login", "/auth/callback", "/auth/signout"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Temporary escape hatch: when AUTH_BYPASS=1 the whole app is open, no sign-in
  // required. For testing only — it leaves the API (which spends Bland/OpenRouter
  // credits and writes to a production schema) unauthenticated. Remove the env
  // var to re-lock; no code change needed.
  if (process.env.AUTH_BYPASS === "1") return NextResponse.next();

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // The client may refresh the session, which issues new cookies; they have to
  // be written onto the response that is actually returned.
  const res = NextResponse.next({ request: { headers: req.headers } });
  const supabase = middlewareClient(req, res);

  // getUser() revalidates against Supabase rather than trusting the cookie,
  // so a tampered or stale session cannot get through.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const allowed = user && isAllowedEmail(user.email);

  if (!allowed) {
    // API callers get JSON; a redirect to an HTML login page would surface as
    // an unhelpful parse error in the dashboard's fetch calls.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          error: user
            ? "this account is not permitted"
            : "authentication required",
        },
        { status: 401 }
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // Signed in but wrong domain is a different message from not signed in.
    if (user) url.searchParams.set("denied", "domain");
    else if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  // Everything except Next's internals and static files. Auth-relevant routes
  // are excluded inside the handler instead, so this stays readable.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
