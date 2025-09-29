import { NextResponse } from "next/server";
import { computePay } from "../../../../../lib/pay";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const out = await computePay(params.id);
  return NextResponse.json(out);
}
