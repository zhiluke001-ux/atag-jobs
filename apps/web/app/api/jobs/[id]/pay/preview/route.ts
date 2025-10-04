export const runtime   = 'nodejs';
export const dynamic   = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { computePayFromScans } from "@/lib/pay";

export async function GET(
  _: Request,
  { params }: { params: { id: string } }
) {
  try {
    // Fetch job with assignments and scans
    const job = await prisma.job.findUnique({
      where: { id: params.id },
      include: {
        assignments: { include: { user: true } },
        scans: true,
      },
    });

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Compute preview for each assignment
    const previews = job.assignments.map((assignment) => {
      const scans = job.scans.filter((s) => s.userId === assignment.userId);
      return {
        assignmentId: assignment.id,
        user: {
          id: assignment.user.id,
          name: assignment.user.name,
          email: assignment.user.email,
        },
        pay: computePayFromScans(job, scans, assignment.transport),
      };
    });

    return NextResponse.json(previews);
  } catch (err) {
    console.error("Preview pay error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
