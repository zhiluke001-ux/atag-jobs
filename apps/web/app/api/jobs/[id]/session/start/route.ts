import { NextResponse } from "next/server";
import { redis } from "../../../../../lib/redis";
import { randomUUID } from "crypto";

const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || "21600");

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { pmDeviceId } = await req.json().catch(() => ({}));
  if (!pmDeviceId) return NextResponse.json({ error: "pmDeviceId required" }, { status: 400 });

  const key = `session:${params.id}`;
  const existing = await redis.get<string>(key);
  if (existing) {
    await redis.expire(key, SESSION_TTL_SECONDS);
    const s = JSON.parse(existing);
    return NextResponse.json({ sessionId: s.sessionId, expiresIn: SESSION_TTL_SECONDS });
  }
  const sid = randomUUID();
  await redis.set(key, JSON.stringify({ sessionId: sid, pmDeviceId, startedAt: Date.now() }), { ex: SESSION_TTL_SECONDS });
  return NextResponse.json({ sessionId: sid, expiresIn: SESSION_TTL_SECONDS });
}
