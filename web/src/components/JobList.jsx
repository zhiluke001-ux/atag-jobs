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
function fmtDateShort(d) {
  return d.toLocaleDateString("en-GB");
}
function fmtHourCompact(d) {
  const h = d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true });
  return h.replace(" ", "");
}

const num = (v) =>
  v === null || v === undefined || v === "" ? null : Number(v);
const money = (v) => {
  const n = num(v);
  return Number.isFinite(n) && n > 0
    ? `RM${n % 1 === 0 ? n : n.toFixed(2)}`
    : null;
};

// ---- Discord/constants ----
const DISCORD_URL = "https://discord.gg/ZAeR28z3p2";
const BTN_BLACK_STYLE = { background: "#000", color: "#fff", borderColor: "#000" };
// Compact button helper to keep actions on a single line without overflowing
const COMPACT_BTN = { padding: "6px 10px", fontSize: 12, lineHeight: 1.2 };

// ---- Layout / style helpers (visual polish) ----
const CARD_INNER = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
};

const HEADER_ROW = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 8,
};

const TITLE_STYLE = {
  fontWeight: 600,
  fontSize: 16,
  lineHeight: 1.3,
};

const STATUS_BADGE = {
  fontSize: 12,
  padding: "2px 10px",
  borderRadius: 999,
  background: "#eef2ff",
  color: "#4f46e5",
  fontWeight: 600,
  textTransform: "capitalize",
};

const LABEL_SM = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "#6b7280",
};

const TEXT_MAIN = {
  fontSize: 13,
  color: "#111827",
  marginTop: 2,
};

const TEXT_MUTED = {
  fontSize: 13,
  color: "#4b5563",
};

const PAY_STRONG = {
  fontSize: 15,
  fontWeight: 700,
  color: "#111827",
};

const SECTION_DIVIDER = {
  borderTop: "1px solid #e5e7eb",
  marginTop: 10,
  paddingTop: 10,
};

function truncate(text, max = 140) {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

// === EXACTLY MATCH JobDetails helpers ===
function deriveViewerRank(user) {
  const raw = (
    user?.ptRole ||
    user?.jobRole ||
    user?.rank ||
    user?.tier ||
    user?.level ||
    user?.roleRank ||
    ""
  )
    .toString()
    .toLowerCase();
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

  const mode =
    job?.session?.mode ||
    job?.sessionMode ||
    job?.mode ||
    (kind === "virtual" ? "virtual" : "physical");
  const isVirtual = mode === "virtual" || kind === "virtual";

  const resolvedKind = isVirtual
    ? "virtual"
    : ["half_day", "full_day", "2d1n", "3d2n", "hourly_by_role", "hourly_flat"].includes(
        kind
      )
    ? kind
    : "half_day";

  const label =
    resolvedKind === "virtual"
      ? "Virtual"
      : resolvedKind === "half_day"
      ? "Physical — Half Day"
      : resolvedKind === "full_day"
      ? "Physical — Full Day"
      : resolvedKind === "2d1n"
      ? "Physical — 2D1N"
      : resolvedKind === "3d2n"
      ? "Physical — 3D2N"
      : resolvedKind === "hourly_by_role"
      ? "Physical — Hourly (by role)"
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
    const ot = money(flat?.otRatePerHour);
    if (base || ot)
      return `${base ? `${base}/hr` : ""}${otSuffix(base, ot)}`;
    return "-";
  }

  if (kind === "virtual" || kind === "hourly_by_role") {
    const base = money(tier.base);
    const ot = money(tier.otRatePerHour);
    if (base || ot)
      return `${base ? `${base}/hr` : ""}${otSuffix(base, ot)}`;
    return "-";
  }

  const pick = (k) => {
    if (k === "half_day") return tier?.halfDay ?? tier?.specificPayment ?? null;
    if (k === "full_day") return tier?.fullDay ?? tier?.specificPayment ?? null;
    if (k === "2d1n") return tier?.twoD1N ?? tier?.specificPayment ?? null;
    if (k === "3d2n") return tier?.threeD2N ?? tier?.specificPayment ?? null;
    return null;
  };
  const sessionRM = money(pick(kind));
  const hasAddon =
    job?.session?.hourlyEnabled ||
    job?.physicalHourlyEnabled ||
    tier?.payMode === "specific_plus_hourly";
  const base = money(tier.base);
  const ot = money(tier.otRatePerHour);

  if (sessionRM) {
    if (hasAddon && (base || ot))
      return `${sessionRM}  +  ${
        base ? `${base}/hr` : ""
      }${otSuffix(base, ot)}`;
    return sessionRM;
  }

  if (base || ot) return `${base ? `${base}/hr` : ""}${otSuffix(base, ot)}`;
  return "-";
}

// badges (only used for physical)
function TransportBadges({ job }) {
  const t = job?.transportOptions || {};
  const items = [
    ...(t.bus ? [{ text: "ATAG Transport", bg: "#eef2ff", color: "#3730a3" }] : []),
    ...(t.own ? [{ text: "Own Transport", bg: "#ecfeff", color: "#155e75" }] : []),
  ];
  if (!items.length)
    return (
      <span style={{ fontSize: 12, color: "#6b7280" }}>
        No transport option
      </span>
    );
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {items.map((it, i) => (
        <span
          key={i}
          style={{
            background: it.bg,
            color: it.color,
            padding: "2px 8px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
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

        const { isVirtual, kind, label } = deriveKind(j);
        const isPhysical = !isVirtual;

        // Allowances (for physical transport)
        const pa = (() => {
          const r = j?.rate || {};
          const v = Number.isFinite(r.parkingAllowance)
            ? r.parkingAllowance
            : Number.isFinite(r.transportAllowance)
            ? r.transportAllowance
            : Number.isFinite(r.transportBus)
            ? r.transportBus
            : null;
          return v == null ? null : Math.round(Number(v));
        })();

        const ec = j.earlyCall || {};
        const lu = j.loadingUnload || {};
        const payForViewer = buildPayForViewer(j, viewerUser);

        const hasDescription =
          typeof j.description === "string" && j.description.trim().length > 0;

        // === UPDATED ApplyArea ===
        function ApplyArea() {
          if (!canApply) return null;

          const isFull = total > 0 && approved >= total;

          // Job-level status should not override the user's own status
          if (my === "approved") {
            return (
              <button className="btn green" style={COMPACT_BTN} disabled>
                Approved
              </button>
            );
          }

          if (my === "applied") {
            return (
              <button className="btn gray" style={COMPACT_BTN} disabled>
                Applied
              </button>
            );
          }

          // Either the job is full OR user previously rejected because quota full
          if (my === "rejected" || isFull) {
            return (
              <button className="btn gray" style={COMPACT_BTN} disabled>
                Full
              </button>
            );
          }

          return (
            <button
              className="btn red"
              style={COMPACT_BTN}
              onClick={() => onApply && onApply(j)}
            >
              Apply
            </button>
          );
        }

        return (
          <div key={j.id} className="card" style={CARD_INNER}>
            {/* Top content */}
            <div>
              {/* Title + status */}
              <div style={HEADER_ROW}>
                <div>
                  <div style={TITLE_STYLE}>{j.title || "Untitled job"}</div>
                  {j.clientName && (
                    <div style={{ ...TEXT_MUTED, fontSize: 12, marginTop: 4 }}>
                      {j.clientName}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  {j.status && (
                    <div style={STATUS_BADGE}>{j.status}</div>
                  )}
                </div>
              </div>

              {/* Meta: date/time + pay */}
              <div
                style={{
                  marginTop: 10,
                  display: "flex",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div>
                  <div style={LABEL_SM}>Date &amp; Time</div>
                  <div style={TEXT_MAIN}>
                    {dateLine} · {timeLine}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={LABEL_SM}>Pay</div>
                  <div style={PAY_STRONG}>{payForViewer}</div>
                </div>
              </div>

              {/* Venue + session */}
              <div
                style={{
                  marginTop: 10,
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1.1fr)",
                  gap: 12,
                }}
              >
                <div>
                  <div style={LABEL_SM}>Venue</div>
                  <div style={TEXT_MAIN}>{j.venue || "-"}</div>
                </div>
                <div>
                  <div style={LABEL_SM}>Session</div>
                  <div style={TEXT_MAIN}>{label}</div>
                </div>
              </div>

              {/* Physical-only options */}
              {isPhysical && (
                <>
                  {/* Transport */}
                  <div style={{ marginTop: 10 }}>
                    <div style={LABEL_SM}>Transport</div>
                    <div style={{ marginTop: 4 }}>
                      <TransportBadges job={j} />
                    </div>
                    {pa != null && j?.transportOptions?.bus && (
                      <div
                        style={{
                          ...TEXT_MUTED,
                          fontSize: 12,
                          marginTop: 4,
                        }}
                      >
                        ATAG Transport allowance: RM{pa} per person (if selected)
                      </div>
                    )}
                  </div>

                  {/* Early call / L&U */}
                  <div
                    style={{
                      marginTop: 10,
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(140px, 1fr))",
                      gap: 12,
                    }}
                  >
                    <div>
                      <div style={LABEL_SM}>Early Call</div>
                      <div style={TEXT_MAIN}>
                        {ec?.enabled
                          ? `Yes · RM${Number(ec.amount || 0)}`
                          : "No"}
                      </div>
                    </div>
                    <div>
                      <div style={LABEL_SM}>Loading &amp; Unloading</div>
                      <div style={TEXT_MAIN}>
                        {lu?.enabled
                          ? `Yes · RM${Number(
                              lu.price || 0
                            )} / helper · Quota ${Number(lu.quota || 0)}`
                          : "No"}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Description */}
              {hasDescription && (
                <div style={{ marginTop: 10 }}>
                  <div style={LABEL_SM}>Description</div>
                  <div
                    style={{
                      ...TEXT_MUTED,
                      marginTop: 4,
                    }}
                  >
                    {showFullDetails
                      ? j.description
                      : truncate(j.description, 160)}
                  </div>
                </div>
              )}

              {/* Hiring line */}
              <div
                style={{
                  marginTop: 10,
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <div style={TEXT_MAIN}>
                  <strong>Hiring</strong>
                  <span style={{ marginLeft: 6 }}>{total} pax</span>
                </div>
                <div style={{ ...TEXT_MUTED, fontSize: 12 }}>
                  Approved: {approved}/{total} · Applied: {applied}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={SECTION_DIVIDER}>
              <div
                style={{
                  display: "flex",
                  justifyContent: canManage ? "space-between" : "flex-start",
                  flexWrap: "wrap",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    display: "inline-flex",
                    gap: 6,
                    alignItems: "center",
                    flexWrap: "wrap",
                    minWidth: 0,
                    maxWidth: "100%",
                  }}
                >
                  {canApply && <ApplyArea />}

                  <button
                    className="btn"
                    style={COMPACT_BTN}
                    onClick={() => onView && onView(j)}
                  >
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

                {canManage && (
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      className="btn"
                      onClick={() => onEdit && onEdit(j)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn red"
                      onClick={() => onDelete && onDelete(j)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
