import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from '@/lib/prisma';

export const runtime = "nodejs";

export async function GET() {
  const uid = cookies().get("uid")?.value;
  if (!uid) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const user = await prisma.user.findUnique({ where: { id: uid } });
  if (!user || user.role !== "PART_TIMER") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const asns = await prisma.assignment.findMany({
    where: { userId: uid },
    include: { job: true },
    orderBy: { createdAt: "desc" }
  });

  const rows = asns.map(a => ({
    id: a.id,
    status: a.status,
    transport: a.transport,
    roleName: a.roleName,
    approvedAt: a.approvedAt,
    job: {
      id: a.job.id,
      title: a.job.title,
      venue: a.job.venue,
      callTimeUtc: a.job.callTimeUtc,
      endTimeUtc: a.job.endTimeUtc,
      jobType: a.job.jobType,
      status: a.job.status
    }
  }));

  return NextResponse.json(rows);
}
