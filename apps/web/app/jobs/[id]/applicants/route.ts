import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "../../../../lib/prisma";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const uid = cookies().get("uid")?.value;
  if (!uid) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const me = await prisma.user.findUnique({ where: { id: uid } });
  if (!me || (me.role !== "PM" && me.role !== "ADMIN")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const asns = await prisma.assignment.findMany({ where: { jobId: params.id }, include: { user: true }, orderBy: { approvedAt: "desc" } });
  const rows = asns.map(a => ({ id: a.id, userId: a.userId, name: a.user.name, email: a.user.email, roleName: a.roleName, transport: a.transport, status: a.status, approvedBy: a.approvedBy || null, approvedAt: a.approvedAt || null }));
  return NextResponse.json(rows);
}
