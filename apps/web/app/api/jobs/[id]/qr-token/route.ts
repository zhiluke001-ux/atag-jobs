export const runtime   = 'nodejs';
export const dynamic   = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from '@/lib/prisma';
import { ensureCsrf, getCsrf, verifyCsrf } from '@/lib/csrf';
import { signQR } from '@/lib/jwt';
import { redis } from '@/lib/redis';

const TOKEN_TTL_SECONDS = Number(process.env.QR_TOKEN_TTL_SECONDS || "60");

async function currentSessionId(jobId: string){
  const d = await redis.get<string>(`session:${jobId}`);
  if (!d) throw new Error("no_active_session");
  return JSON.parse(d).sessionId as string;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const uid = cookies().get("uid")?.value;
  if (!uid) return NextResponse.json({ error: "login_required" }, { status: 401 });

  const { action } = await req.json().catch(() => ({}));
  if (!["in","out"].includes(action)) return NextResponse.json({ error: "action must be in|out" }, { status: 400 });

  const asn = await prisma.assignment.findFirst({ where: { jobId: params.id, userId: uid, status: "APPROVED" } });
  if (!asn) return NextResponse.json({ error: "not approved for this job" }, { status: 403 });

  try {
    const sid = await currentSessionId(params.id);
    const jti = crypto.randomUUID();
    const token = await signQR({ sub: uid, job: params.id, act: action, sid, jti }, TOKEN_TTL_SECONDS);
    return NextResponse.json({ token, ttl: TOKEN_TTL_SECONDS });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "qr_issue_failed" }, { status: 400 });
  }
}
