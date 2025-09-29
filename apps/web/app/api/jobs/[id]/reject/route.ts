import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from '@/lib/prisma';

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const uid = cookies().get("uid")?.value;
  if (!uid) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const me = await prisma.user.findUnique({ where: { id: uid } });
  if (!me || (me.role !== "PM" && me.role !== "ADMIN")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { assignmentId } = await req.json().catch(() => ({}));
  if (!assignmentId) return NextResponse.json({ error: "assignmentId required" }, { status: 400 });

  const upd = await prisma.assignment.update({ where: { id: String(assignmentId) }, data: { status: "REJECTED", approvedBy: uid, approvedAt: new Date() } });
  return NextResponse.json({ ok: true, assignmentId: upd.id });
}
