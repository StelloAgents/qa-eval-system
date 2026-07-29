// Magic-link sign-in via Supabase Auth, restricted to one email domain.
//
// The domain check is enforced server-side in middleware and again in the
// callback. A client-side check exists too, but only as UX — anyone can call
// Supabase's auth endpoint directly, so the browser can never be the gate.

import { createBrowserClient, createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

/** Falls back to the literal domain so a missing env var cannot silently open
 * access to everyone. */
export const ALLOWED_DOMAIN = (
  process.env.ALLOWED_EMAIL_DOMAIN ||
  process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ||
  "stelloagents.com"
).toLowerCase();

export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const at = email.lastIndexOf("@");
  if (at === -1) return false;
  // Compare the whole domain, not a suffix: `notstelloagents.com` and
  // `stelloagents.com.evil.net` must both fail.
  return email.slice(at + 1).trim().toLowerCase() === ALLOWED_DOMAIN;
}

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set"
    );
  }
  return { url, key };
}

/** Browser client, used by the login form only. */
export function browserClient() {
  const { url, key } = env();
  return createBrowserClient(url, key);
}

/** Request-scoped client that reads and refreshes the session cookies. The
 * response is passed in so refreshed cookies are written back to it. */
export function middlewareClient(req: NextRequest, res: NextResponse) {
  const { url, key } = env();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (cookies) => {
        for (const { name, value, options } of cookies) {
          res.cookies.set(name, value, options);
        }
      },
    },
  });
}
