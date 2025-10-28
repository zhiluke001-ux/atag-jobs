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
 * - viewerUser?: object
 */
function fmtDateShort(d) { return d.toLocaleDateString("en-US"); }
function fmtHourCompact(d) {
  const h = d.toLocaleTimeString("en-US", { hour: "numeric", hour12: true });
  return h.replace(" ", "");
}

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const money = (v) => {
  const n = num(v);
  return Number.isFinite(n) && n > 0 ? `RM${n % 1 === 0 ? n : n.toFixed(2)}` : null;
};

// ---- Discord/constants ----
const DISCORD_URL = "https://discord.gg/AwGaCG3W";
const BTN_BLACK_STYLE = { background: "#000", color: "#fff", borderColor: "#000" };
// Compact button helper to keep actions on a single line without overflowing
const COMPACT_BTN = { padding: "6px 10px", fontSize: 12, lineHeight: 1.2 };

// === EXACTLY MATCH JobDetails helpers ===
function deriveViewerRank(user) {
  const raw = (
    user?.ptRole || user?.jobRole || user?.rank || user?.tier || user?.level || user?.roleRank || ""
  ).toString().toLowerCase();
  if (["lead", "leader", "supervisor", "captain"].includes(raw)) return "lead";
  if (["senior", "sr"].includes(raw)) return "senior";
  return "junior";
}
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
function otSuffix(hourlyRM, otRM) {
  // New OT policy: billed per full hour after event end; show explicit rate if provided.
  if (otRM && otRM !== hourlyRM) return ` (OT ${otRM}/hr after end)`;
  if (hourlyRM) return ` (OT billed hourly after end)`;
  return "";
}
function buildPayForViewer(job, user) {
  const { kind } = deriveKind(job);
  const rank = deriveViewerRank(user);
  const tr = job?.rate?.tierRates || job?.roleRates || {};
  const tier = tr?.[rank] || {};
  const flat = job?.rate?.flatHourly || null;

  if (kind === "hourly_flat") {
    const base = money(flat?.base ?? tier.base);
    const ot   = money(flat?.otRatePerHour);
    if (base || ot) return `${base ? `${base}/hr` : ""}${otSuffix(base, ot)}`;
    return "-";
  }

  if (kind === "virtual" || kind === "hourly_by_role") {
    const base = money(tier.base);
    const ot   = money(tier.otRatePerHour);
    if (base || ot) return `${base ? `${base}/hr` : ""}${otSuffix(base, ot)}`;
    return "-";
  }

  const pick = (k) => {
    if (k === "half_day") return tier?.halfDay ?? tier?.specificPayment ?? null;
    if (k === "full_day") return tier?.fullDay ?? tier?.specificPayment ?? null;
    if (k === "2d1n")     return tier?.twoD1N ?? tier?.specificPayment ?? null;
    if (k === "3d2n")     return tier?.threeD2N ?? tier?.specificPayment ?? null;
    return null;
  };
  const sessionRM = money(pick(kind));
  const hasAddon =
    job?.session?.hourlyEnabled ||
    job?.physicalHourlyEnabled ||
    tier?.payMode === "specific_plus_hourly";
  const base = money(tier.base);
  const ot   = money(tier.otRatePerHour);

  if (sessionRM) {
    if (hasAddon && (base || ot)) return `${sessionRM}  +  ${base ? `${base}/hr` : ""}${otSuffix(base, ot)}`;
    return sessionRM;
  }

  if (base || ot) return `${base ? `${base}/hr` : ""}${otSuffix(base, ot)}`;
  return "-";
}

// badges (only used for physical)
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
  viewerUser = null,
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

        const { label, kind, isVirtual } = { ...deriveKind(j), isVirtual: deriveKind(j).kind === "virtual" ? true : false };
        const isPhysical = !isVirtual;

        // Allowances (for physical transport)
        const pa = (() => {
          const r = j?.rate || {};
          const v = Number.isFinite(r.parkingAllowance) ? r.parkingAllowance
            : Number.isFinite(r.transportAllowance) ? r.transportAllowance
            : Number.isFinite(r.transportBus) ? r.transportBus
            : null;
          return v == null ? null : Math.round(Number(v));
        })();

        const ec = j.earlyCall || {};
        const lu = j.loadingUnload || {};
        const payForViewer = buildPayForViewer(j, viewerUser);

        function ApplyArea() {
          if (!canApply) return null;
          if (my === "approved") return <button className="btn green" style={COMPACT_BTN} disabled>Approved</button>;
          if (my === "applied")  return <button className="btn gray"  style={COMPACT_BTN} disabled>Applied</button>;
          if (my === "rejected") return <button className="btn gray"  style={COMPACT_BTN} disabled>Full</button>;
          return <button className="btn red" style={COMPACT_BTN} onClick={() => onApply && onApply(j)}>Apply</button>;
        }

        return (
          <div key={j.id} className="card">
            {/* Title + status */}
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div><div style={{ fontWeight: 600, fontSize: 16 }}>{j.title}</div></div>
              <div style={{ textAlign: "right" }}><div className="status">{j.status}</div></div>
            </div>

            {/* Basics */}
            <div style={{ marginTop: 8, lineHeight: 1.55 }}>
              {/* Date / Time side-by-side */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div><strong>Date</strong><span style={{ marginLeft: 8 }}>{dateLine}</span></div>
                <div><strong>Time</strong><span style={{ marginLeft: 8 }}>{timeLine}</span></div>
              </div>

              {/* Venue (its own line) */}
              <div style={{ marginTop: 6 }}>
                <strong>Venue</strong>
                <span style={{ marginLeft: 8, whiteSpace: "nowrap" }}>{j.venue || "-"}</span>
              </div>

              {/* Session (its own line) */}
              <div style={{ marginTop: 6 }}>
                <strong>Session</strong>
                <span style={{ marginLeft: 8, whiteSpace: "nowrap" }}>{label}</span>
              </div>

              {/* === Physical-only options (ALWAYS visible when physical) === */}
              {isPhysical && (
                <>
                  <div style={{ marginTop: 6 }}>
                    <strong>Transport</strong>
                    <div style={{ marginTop: 6 }}><TransportBadges job={j} /></div>
                    {pa != null && (
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                        ATAG Bus allowance: RM{pa} per person (if selected)
                      </div>
                    )}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
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
                </>
              )}

              {/* Pay (IDENTICAL to JobDetails.jsx) */}
              <div style={{ marginTop: 6 }}>
                <strong>Pay</strong>
                <div
                  style={{
                    marginTop: 6,
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  {payForViewer}
                </div>
              </div>

              {/* Optional extra details (we keep, but physical-only blocks are already above) */}
              {showFullDetails && (
                <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                  <div>
                    <strong>Description</strong>
                    <div style={{ marginTop: 4, color: "#374151" }}>{j.description || "-"}</div>
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
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {/* Keep Approved + View + Discord in one line, compact, within the card */}
              <div
                style={{
                  display: "inline-flex",
                  gap: 6,
                  alignItems: "center",
                  flexShrink: 0,
                  minWidth: 0,
                  maxWidth: "100%",
                }}
              >
                {canApply && <ApplyArea />}

                <button className="btn" style={COMPACT_BTN} onClick={() => onView && onView(j)}>
                  View details
                </button>

                {my === "approved" && (
                  <a
                    href={DISCORD_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="btn"
                    style={{ ...BTN_BLACK_STYLE, ...COMPACT_BTN }}
                  >
                    Join Discord Channel
                  </a>
                )}
              </div>

              {/* Manager controls can wrap to a new line if needed */}
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
