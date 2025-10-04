// apps/web/lib/pay.ts
import type { Assignment, Job, Scan, TransportMode } from '@prisma/client';

/**
 * Compute payable hours and money based on a simple rule set kept on Job:
 * - baseHourly:            RM/hour base
 * - minCallHours:          minimum payable hours
 * - otAfterHours:          threshold after which hours are paid as OT
 * - otMultiplier:          OT pay multiplier (e.g., 1.5x)
 * - breakMinutes:          unpaid minutes deducted from total span
 * - ownTransportAllowance: flat allowance if transport === OWN
 *
 * The scan window is computed as first IN to last OUT.
 */
function computePayFromScans(job: Job, scans: Scan[], transport: TransportMode) {
  const ins  = scans.filter(s => s.action === 'IN'  && s.result === 'success').sort((a,b)=>+a.tsUtc - +b.tsUtc);
  const outs = scans.filter(s => s.action === 'OUT' && s.result === 'success').sort((a,b)=>+a.tsUtc - +b.tsUtc);

  const firstIn = ins[0]?.tsUtc ? new Date(ins[0].tsUtc) : null;
  const lastOut = outs[outs.length - 1]?.tsUtc ? new Date(outs[outs.length - 1].tsUtc) : null;

  return computePay(job, firstIn, lastOut, transport);
}

/** Compute pay from an explicit start/end (falls back to min call if missing). */
function computePay(
  job: Job,
  start: Date | null,
  end: Date | null,
  transport: TransportMode
) {
  const baseHourly            = numberOr(job.baseHourly, 12);
  const minCallHours          = numberOr(job.minCallHours, 4);
  const otAfterHours          = numberOr(job.otAfterHours, 8);
  const otMultiplier          = numberOr(job.otMultiplier, 1.5);
  const breakMinutes          = intOr(job.breakMinutes, 0);
  const ownTransportAllowance = numberOr(job.ownTransportAllowance, 0);

  let spanHours = 0;
  if (start && end && end > start) {
    const ms = end.getTime() - start.getTime();
    spanHours = ms / 3_600_000; // ms -> hours
  }

  const breakHours = Math.max(0, breakMinutes) / 60;
  let payableHours = Math.max(0, spanHours - breakHours);

  // Min call
  payableHours = Math.max(payableHours, minCallHours);

  // Base vs OT
  const baseHours = Math.min(payableHours, otAfterHours);
  const otHours   = Math.max(0, payableHours - otAfterHours);

  const basePay = round2(baseHours * baseHourly);
  const otPay   = round2(otHours * baseHourly * otMultiplier);
  const transportAllowance = transport === 'OWN' ? round2(ownTransportAllowance) : 0;

  const total = round2(basePay + otPay + transportAllowance);

  return {
    window: {
      start: start ? start.toISOString() : null,
      end:   end   ? end.toISOString()   : null,
      spanHours: round2(spanHours),
      breakHours: round2(breakHours),
    },
    hours: {
      payable: round2(payableHours),
      base:    round2(baseHours),
      ot:      round2(otHours),
    },
    rates: { baseHourly, otMultiplier },
    money: { basePay, otPay, transportAllowance, total, currency: 'RM' },
  };
}

/** Convenience preview for one assignment (today’s scans). */
function computePayPreview(job: Job, assignment: Assignment, scans: Scan[]) {
  return {
    assignmentId: assignment.id,
    userId: assignment.userId,
    jobId: assignment.jobId,
    transport: assignment.transport,
    ...computePayFromScans(job, scans, assignment.transport),
  };
}

/* helpers */
const round2 = (n: number) => Math.round(n * 100) / 100;
const numberOr = (n: any, d: number) => (typeof n === 'number' && !Number.isNaN(n) ? n : d);
const intOr    = (n: any, d: number) => (Number.isInteger(n) ? (n as number) : d);

/* explicit named exports + default */
export { computePayFromScans, computePay, computePayPreview };
export default { computePayFromScans, computePay, computePayPreview };
