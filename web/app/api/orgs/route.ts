import { NextResponse } from "next/server";
import { listOrgs } from "@/lib/db";

// This handler takes no request input, so Next would otherwise prerender it at
// build time and serve a frozen org list (and open the DB during the build).
export const dynamic = "force-dynamic";

export async function GET() {
  // Never leak which env var holds the key to the client.
  return NextResponse.json(
    listOrgs().map(({ bland_api_key_env: _omit, ...org }) => org)
  );
}
