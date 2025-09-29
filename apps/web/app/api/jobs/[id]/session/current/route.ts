import { NextResponse } from "next/server";
import { redis } from '@/lib/redis';
export const runtime = "nodejs";
export async function GET(_: Request, { params }: { params: { id: string } }) {
  const data = await redis.get<string>(`session:${params.id}`);
  if (!data) return NextResponse.json({ error: "no_active_session" }, { status: 404 });
  return NextResponse.json({ sessionId: JSON.parse(data).sessionId });
}
