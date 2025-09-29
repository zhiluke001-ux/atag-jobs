import { NextResponse } from "next/server";
import prisma from '@/lib/prisma';
import { ensureCsrf, getCsrf, verifyCsrf } from '@/lib/csrf';


export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const start = new Date(); start.setUTCHours(0,0,0,0);
  const end = new Date();   end.setUTCHours(23,59,59,999);

  const scans = await prisma.scan.findMany({ where: { jobId: params.id, tsUtc: { gte: start, lte: end } }, orderBy: { tsUtc: "asc" } });
  const map = new Map<string, { userId: string; firstIn?: Date; lastOut?: Date; totalIns: number }>();
  for (const s of scans) {
    const r = map.get(s.userId) || { userId: s.userId, totalIns: 0 };
    if (s.action === "IN") { r.totalIns += 1; if (!r.firstIn || s.tsUtc < r.firstIn) r.firstIn = s.tsUtc; }
    if (s.action === "OUT") { if (!r.lastOut || s.tsUtc > r.lastOut) r.lastOut = s.tsUtc; }
    map.set(s.userId, r);
  }

  const users = await prisma.user.findMany({ where: { id: { in: [...map.keys()] } } });
  const merits = await prisma.meritLog.findMany({ where: { jobId: params.id, kind: "LATE", tsUtc: { gte: start, lte: end } } });
  const records = [...map.values()].map(r => {
    const u = users.find(x => x.id === r.userId);
    const m = merits.find(x => x.userId === r.userId);
    return { userId: r.userId, user: u?.name || r.userId, email: u?.email || "", firstInUtc: r.firstIn || null, lastOutUtc: r.lastOut || null, lateMinutes: m ? m.reason?.match(/(\d+) min/)?.[1] : null, totalIns: r.totalIns };
  });

  return NextResponse.json({ jobId: params.id, date: new Date().toISOString().slice(0,10), records });
}
