import { NextRequest, NextResponse } from "next/server";
import { middlewareClient } from "@/lib/auth";

// POST so a stray link prefetch cannot sign someone out.
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const res = NextResponse.redirect(url, { status: 303 });
  const supabase = middlewareClient(req, res);
  await supabase.auth.signOut();
  return res;
}
