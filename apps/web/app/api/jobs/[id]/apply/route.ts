export const runtime   = 'nodejs';
export const dynamic   = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from '@/lib/prisma';
import { ensureCsrf, getCsrf, verifyCsrf } from '@/lib/csrf';

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const uid = cookies().get("uid")?.value;
  if (!uid) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const me = await prisma.user.findUnique({ where: { id: uid } });
  if (!me || me.role !== "PART_TIMER") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const { roleName, transport } = await req.json().catch(() => ({}));

  const existing = await prisma.assignment.findFirst({ where: { jobId: params.id, userId: uid } });
  if (existing) {
    if (["WITHDRAWN", "REJECTED"].includes(existing.status)) {
      const upd = await prisma.assignment.update({
        where: { id: existing.id },
        data: {
          status: "APPLIED",
          roleName: roleName || existing.roleName,
          transport: transport === "ATAG_BUS" ? "ATAG_BUS" : "OWN",
          approvedBy: null,
          approvedAt: null
        }
      });
      return NextResponse.json({ ok: true, assignmentId: upd.id });
    }
    return NextResponse.json({ ok: true, assignmentId: existing.id });
  }

  const created = await prisma.assignment.create({
    data: {
      userId: uid,
      jobId: params.id,
      roleName: roleName || "Worker",
      status: "APPLIED",
      transport: transport === "ATAG_BUS" ? "ATAG_BUS" : "OWN"
    }
  });

  return NextResponse.json({ ok: true, assignmentId: created.id });
}
