import { NextResponse } from "next/server";
import { redis } from "../../../../../lib/redis";
const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || "21600");
export const runtime = "nodejs";
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { pmDeviceId } = await req.json().catch(() => ({}));
  if (!pmDeviceId) return NextResponse.json({ error: "pmDeviceId required" }, { status: 400 });
  const key = `session:${params.id}`;
  const existing = await redis.get<string>(key);
  if (existing) { await redis.expire(key, SESSION_TTL_SECONDS); const s=JSON.parse(existing); return NextResponse.json({ sessionId: s.sessionId, expiresIn: SESSION_TTL_SECONDS }); }
  await redis.set(key, JSON.stringify({ sessionId: crypto.randomUUID(), pmDeviceId, startedAt: Date.now() }), { ex: SESSION_TTL_SECONDS });
  const s = await redis.get<string>(key).then(v=>v?JSON.parse(v):null);
  return NextResponse.json({ sessionId: s.sessionId, expiresIn: SESSION_TTL_SECONDS });
}
