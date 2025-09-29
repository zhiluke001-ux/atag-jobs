import { NextResponse } from "next/server";
import { prisma } from "../../../../../lib/prisma";
import { redis } from "../../../../../lib/redis";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: { jti: string } }) {
  try {
    const scan = await prisma.scan.findUnique({ where: { tokenJti: String(params.jti) } });
    if (scan) return NextResponse.json({ used: true, result: scan.result, action: scan.action, tsUtc: scan.tsUtc });
    const exists = await redis.get(`jti:${params.jti}`);
    return NextResponse.json({ used: !!exists, result: exists ? "pending" : "unused" });
  } catch (e: any) {
    return NextResponse.json({ used: false, error: e?.message || String(e) }, { status: 500 });
  }
}
