// web/src/components/JobList.jsx
import React from "react";

/**
 * Props:
 * - jobs: []
 * - onApply(job), onView(job)
 * - canApply: boolean
 * - myStatuses?: { [jobId]: 'applied'|'approved'|'rejected' }
 * - canManage?: boolean
 * - onEdit?(job), onDelete?(job)
 * - loading?: boolean
 * - showFullDetails?: boolean
 */
function fmtDateShort(d) {
  return d.toLocaleDateString("en-US");
}
function fmtHourCompact(d) {
  const h = d.toLocaleTimeString("en-US", { hour: "numeric", hour12: true });
  return h.replace(" ", "");
}

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const money = (v) => {
  const n = num(v);
  return Number.isFinite(n) && n > 0 ? `RM${n}` : null;
};

function deriveKind(job) {
  const kind =
    job?.rate?.sessionKind ||
    job?.sessionKind ||
    job?.physicalSubtype ||
    job?.session?.physicalType ||
    (job?.session?.mode === "virtual" ? "virtual" : null);

  const mode = job?.session?.mode || job?.sessionMode || job?.mode || (kind === "virtual" ? "virtual" : "physical");
  const isVirtual = mode === "virtual" || kind === "virtual";

  const resolvedKind = isVirtual
    ? "virtual"
    : ["half_day", "full_day", "2d1n", "3d2n", "hourly_by_role", "hourly_flat"].includes(kind)
      ? kind
      : "half_day";

  const label =
    resolvedKind === "virtual" ? "Virtual"
      : resolvedKind === "half_day" ? "Physical — Half Day"
      : resolvedKind === "full_day" ? "Physical — Full Day"
      : resolvedKind === "2d1n" ? "Physical — 2D1N"
      : resolvedKind === "3d2n" ? "Physical — 3D2N"
      : resolvedKind === "hourly_by_role" ? "Physical — Hourly (by role)"
      : "Physical — Backend (flat hourly)";

  return { isVirtual, kind: resolvedKind, label };
}

function parkingRM(job) {
  const r = job?.rate || {};
  const v = Number.isFinite(r.parkingAllowance) ? r.parkingAllowance
    : Number.isFinite(r.transportAllowance) ? r.transportAllowance
    : Number.isFinite(r.transportBus) ? r.transportBus
    : null;
  return v == null ? null : Math.round(Number(v));
}

/** Build human-friendly pay lines with smart fallback (no RM0). */
function buildPayLines(job) {
  const { kind } = deriveKind(job);
  const tr = job?.rate?.tierRates || job?.roleRates || {};
  const flat = job?.rate?.flatHourly || null;

  const hrJ = tr?.junior || {};
  const hrS = tr?.senior || {};
  const hrL = tr?.lead || {};

  const addon =
    job?.session?.hourlyEnabled ||
    job?.physicalHourlyEnabled ||
    hrJ?.payMode === "specific_plus_hourly" ||
    hrS?.payMode === "specific_plus_hourly" ||
    hrL?.payMode === "specific_plus_hourly";

  const out = [];
  const hrLine = (label, base, ot) => {
    const b = money(base);
    const o = money(ot);
    if (!b && !o) return null;
    return `${label} ${b ? `${b} / hr` : ""}${b && o ? "  " : ""}${o ? `(OT ${o}/hr)` : ""}`;
  };

  if (kind === "virtual" || kind === "hourly_by_role") {
    const j = hrLine("Junior", hrJ.base, hrJ.otRatePerHour);
    const s = hrLine("Senior", hrS.base, hrS.otRatePerHour);
    const l = hrLine("Lead",   hrL.base, hrL.otRatePerHour);
    [j, s, l].forEach((x) => x && out.push(x));
    if (out.length) return out;
    return [job.paySummary || "See details"];
  }

  if (kind === "hourly_flat") {
    const base = money(flat?.base ?? hrJ.base);
    const ot   = money(flat?.otRatePerHour ?? hrJ.otRatePerHour);
    if (base || ot) {
      out.push(`Flat ${base ? `${base} / hr` : ""}${base && ot ? "  " : ""}${ot ? `(OT ${ot}/hr)` : ""}`);
      return out;
    }
    return [job.paySummary || "See details"];
  }

  const pick = (tier, k) => {
    if (!tier) return null;
    if (k === "half_day") return tier.halfDay ?? tier.specificPayment ?? null;
    if (k === "full_day") return tier.fullDay ?? tier.specificPayment ?? null;
    if (k === "2d1n")     return tier.twoD1N ?? tier.specificPayment ?? null;
    return /* 3d2n */       tier.threeD2N ?? tier.specificPayment ?? null;
  };

  const jr = money(pick(hrJ, kind));
  const sr = money(pick(hrS, kind));
  const ld = money(pick(hrL, kind));

  const parts = [];
  if (jr) parts.push(`Junior ${jr}`);
  if (sr) parts.push(`Senior ${sr}`);
  if (ld) parts.push(`Lead ${ld}`);

  if (parts.length) {
    out.push(`Session: ${parts.join(" · ")}`);
    if (addon) {
      const j = hrLine("Junior", hrJ.base, hrJ.otRatePerHour);
      const s = hrLine("Senior", hrS.base, hrS.otRatePerHour);
      const l = hrLine("Lead",   hrL.base, hrL.otRatePerHour);
      const add = [j, s, l].filter(Boolean);
      if (add.length) {
        out.push("Hourly add-on:");
        add.forEach((ln) => out.push("  " + ln));
      }
    }
    return out;
  }

  return [job.paySummary || "See details"];
}

function TransportBadges({ job }) {
  const t = job?.transportOptions || {};
  const items = [
    ...(t.bus ? [{ text: "ATAG Bus", bg: "#eef2ff", color: "#3730a3" }] : []),
    ...(t.own ? [{ text: "Own Transport", bg: "#ecfeff", color: "#155e75" }] : []),
  ];
  if (!items.length) return <span style={{ fontSize: 12, color: "#6b7280" }}>No transport option</span>;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {items.map((it, i) => (
        <span key={i} style={{ background: it.bg, color: it.color, padding: "2px 8px", borderRadius: 999, fontSize: 12, fontWeight: 700 }}>
          {it.text}
        </span>
      ))}
    </div>
  );
}

export default function JobList({
  jobs = [],
  onApply,
  onView,
  canApply = true,
  myStatuses = {},
  canManage = false,
  onEdit,
  onDelete,
  loading = false,
  showFullDetails = false,
}) {
  return (
    <div className="grid">
      {jobs.map((j) => {
        const my = myStatuses[j.id];

        const start = new Date(j.startTime);
        const end = new Date(j.endTime);

        const dateLine = fmtDateShort(start);
        const timeLine = `${fmtHourCompact(start)} — ${fmtHourCompact(end)}`;

        const approved = Number(j.approvedCount || 0);
        const applied = Number(j.appliedCount || 0);
        const total = Number(j.headcount || 0);

        const { label } = deriveKind(j);
        const pa = parkingRM(j);
        const lu = j.loadingUnload || {};
        const ec = j.earlyCall || {};
        const payLines = buildPayLines(j);

        function ApplyArea() {
          if (!canApply) return null;
          if (my === "approved") return <button className="btn green" disabled>Approved</button>;
          if (my === "applied")  return <button className="btn gray" disabled>Applied</button>;
          if (my === "rejected") return <button className="btn gray" disabled>Full</button>;
          return <button className="btn red" onClick={() => onApply && onApply(j)}>Apply</button>;
        }

        return (
          <div key={j.id} className="card">
            {/* Title + status */}
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>{j.title}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="status">{j.status}</div>
              </div>
            </div>

            {/* Always-visible basics */}
            <div style={{ marginTop: 8, lineHeight: 1.55 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div><strong>Date</strong><span style={{ marginLeft: 8 }}>{dateLine}</span></div>
                <div><strong>Time</strong><span style={{ marginLeft: 8 }}>{timeLine}</span></div>
                <div><strong>Venue</strong><span style={{ marginLeft: 8 }}>{j.venue}</span></div>
                <div><strong>Session</strong><span style={{ marginLeft: 8 }}>{label}</span></div>
              </div>

              {showFullDetails && (
                <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                  <div>
                    <strong>Description</strong>
                    <div style={{ marginTop: 4, color: "#374151" }}>{j.description || "-"}</div>
                  </div>

                  <div>
                    <strong>Transport</strong>
                    <div style={{ marginTop: 6 }}><TransportBadges job={j} /></div>
                    {pa != null && (
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                        ATAG Bus allowance: RM{pa} per person (if selected)
                      </div>
                    )}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>Early Call</div>
                      <div style={{ color: "#374151" }}>
                        {ec?.enabled ? `Yes · RM${Number(ec.amount || 0)} (≥ ${Number(ec.thresholdHours || 0)}h)` : "No"}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontWeight: 600 }}>Loading & Unloading</div>
                      <div style={{ color: "#374151" }}>
                        {lu?.enabled ? `Yes · RM${Number(lu.price || 0)} / helper · Quota ${Number(lu.quota || 0)}` : "No"}
                      </div>
                    </div>
                  </div>

                  <div>
                    <strong>Pay</strong>
                    <div style={{ marginTop: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace", fontSize: 13, lineHeight: 1.5 }}>
                      {payLines.map((ln, i) => (<div key={i}>{ln}</div>))}
                    </div>
                  </div>
                </div>
              )}

              {/* Hiring line */}
              <div style={{ marginTop: 8, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                <div><strong>Hiring for</strong><span style={{ marginLeft: 8 }}>{total} pax</span></div>
                <div style={{ color: "#667085" }}>
                  Approved: {approved}/{total} &nbsp;·&nbsp; Applied: {applied}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {canApply && <ApplyArea />}
              <button className="btn" onClick={() => onView && onView(j)}>View details</button>

              {canManage && (
                <>
                  <button className="btn" onClick={() => onEdit && onEdit(j)}>Edit</button>
                  <button className="btn red" onClick={() => onDelete && onDelete(j)}>Delete</button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
