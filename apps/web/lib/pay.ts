import { AssignmentStatus } from "@prisma/client";
import { prisma } from "./prisma";

function hoursBetween(a?: Date | null, b?: Date | null) {
  if (!a || !b) return 0;
  return Math.max(0, (b.getTime() - a.getTime()) / 3600000);
}

export async function computePay(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new Error("job_not_found");

  const approved = await prisma.assignment.findMany({
    where: { jobId, status: AssignmentStatus.APPROVED },
    include: { user: true }
  });
  const scans = await prisma.scan.findMany({ where: { jobId }, orderBy: { tsUtc: "asc" } });

  const byUser = new Map<string, { firstIn?: Date; lastOut?: Date }>();
  for (const s of scans) {
    const r = byUser.get(s.userId) || {};
    if (s.action === "IN")  { if (!r.firstIn || s.tsUtc < r.firstIn) r.firstIn = s.tsUtc; }
    if (s.action === "OUT") { if (!r.lastOut || s.tsUtc > r.lastOut) r.lastOut = s.tsUtc; }
    byUser.set(s.userId, r);
  }

  const rows = [];
  for (const a of approved) {
    const r = byUser.get(a.userId) || {};
    let span = hoursBetween(r.firstIn, r.lastOut);
    if (span > 0 && job.breakMinutes > 0) span = Math.max(0, span - job.breakMinutes / 60);

    const payable = Math.max(job.minCallHours, span);
    const baseHours = Math.min(payable, job.otAfterHours);
    const otHours   = Math.max(0, payable - job.otAfterHours);

    const basePay = baseHours * job.baseHourly;
    const otPay   = otHours * job.baseHourly * job.otMultiplier;
    const transportAllowance = a.transport === "OWN" ? job.ownTransportAllowance : 0;
    const total = basePay + otPay + transportAllowance;

    rows.push({
      userId: a.userId,
      name: a.user.name,
      email: a.user.email,
      transport: a.transport,
      firstInUtc: r.firstIn || null,
      lastOutUtc: r.lastOut || null,
      baseHours: Number(baseHours.toFixed(2)),
      otHours: Number(otHours.toFixed(2)),
      payableHours: Number(payable.toFixed(2)),
      basePay: Number(basePay.toFixed(2)),
      otPay: Number(otPay.toFixed(2)),
      transportAllowance: Number(transportAllowance.toFixed(2)),
      totalPay: Number(total.toFixed(2))
    });
  }

  return { job, rows };
}
