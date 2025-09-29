import { NextResponse } from "next/server";
import prisma from '@/lib/prisma';
import { verifyQR } from '@/lib/jwt';
import { redis } from '@/lib/redis';

const TOKEN_TTL_SECONDS = Number(process.env.QR_TOKEN_TTL_SECONDS || "60");

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { token, pmDeviceId, sessionId, coords } = await req.json().catch(() => ({}));
  if (!token || !pmDeviceId || !sessionId)
    return NextResponse.json({ result: "invalid", reason: "missing_fields" }, { status: 400 });

  let payload: any;
  try { ({ payload } = await verifyQR(token)); }
  catch (e: any) { return NextResponse.json({ result: "invalid", reason: "jwt_error", detail: e?.message || String(e) }); }

  try {
    const { sub, job, act, sid, jti } = payload as any;
    if (sid !== sessionId) return NextResponse.json({ result: "invalid", reason: "sid_mismatch" });

    const burnKey = `jti:${jti}`;
    const burned = await redis.set(burnKey, "1", { nx: true, ex: TOKEN_TTL_SECONDS * 2 });
    if (!burned) return NextResponse.json({ result: "duplicate" });

    if (act === "out") {
      const hasIn = await prisma.scan.findFirst({ where: { jobId: String(job), userId: String(sub), action: "IN", result: "success" } });
      if (!hasIn) return NextResponse.json({ result: "invalid", reason: "no_prior_in" });
    }

    const scan = await prisma.scan.create({
      data: {
        jobId: String(job),
        userId: String(sub),
        action: act === "out" ? "OUT" : "IN",
        pmDeviceId,
        result: "success",
        sessionId,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        tokenJti: String(jti)
      }
    });

    // Late merit on first IN
    let late = false, minutesLate = 0;
    if (act === "in") {
      const priorIn = await prisma.scan.findFirst({ where: { jobId: String(job), userId: String(sub), action: "IN", result: "success" } });
      if (!priorIn) {
        const jb = await prisma.job.findUnique({ where: { id: String(job) } });
        if (jb?.callTimeUtc) {
          const cutoff = new Date(jb.callTimeUtc.getTime() + (jb.callGraceMins ?? 15) * 60000);
          if (scan.tsUtc > cutoff) {
            late = true; minutesLate = Math.ceil((scan.tsUtc.getTime() - cutoff.getTime()) / 60000);
            await prisma.meritLog.create({ data: { jobId: String(job), userId: String(sub), kind: "LATE", points: 1, reason: `Clock-in after grace by ${minutesLate} min` } });
          }
        }
      }
    }

    try {
      const { appendAttendanceRow } = await import("../../lib/sheets");
      await appendAttendanceRow(String(job), String(sub), scan, late, minutesLate);
    } catch {}

    const user = await prisma.user.findUnique({ where: { id: String(sub) } });
    return NextResponse.json({ result: "success", user: { name: user?.name, photo: user?.photoUrl }, late, minutesLate });
  } catch (e: any) {
    return NextResponse.json({ result: "invalid", reason: "db_error", detail: e?.message || String(e) });
  }
}
