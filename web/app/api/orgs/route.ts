import { NextResponse } from "next/server";
import { ORGS } from "@/lib/mock-data";

export async function GET() {
  return NextResponse.json(ORGS);
}
