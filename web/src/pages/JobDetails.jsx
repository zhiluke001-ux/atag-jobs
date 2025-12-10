// web/src/pages/JobDetails.jsx
import React, { useEffect, useState } from "react";
import { apiGet } from "../api";

function fmtDateTime(dt) {
  if (!dt) return "";
  try {
    const s = new Date(dt);
    const date = s.toLocaleDateString("en-GB");
    const time = s.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `${date} ${time}`;
  } catch {
    return "";
  }
}

function fmtDateRange(startDt, endDt) {
  if (!startDt) return "-";
  const s = new Date(startDt);
  const sDate = s.toLocaleDateString("en-GB");
  if (!endDt) return sDate;

  const e = new Date(endDt);
  const sameDay = s.toDateString() === e.toDateString();
  if (sameDay) return sDate;

  const eDate = e.toLocaleDateString("en-GB");
  return `${sDate} – ${eDate}`;
}

function fmtTimeRange(startDt, endDt) {
  if (!startDt && !endDt) return "-";
  const opts = { hour: "numeric", minute: "2-digit", hour12: true };

  const s = startDt ? new Date(startDt).toLocaleTimeString("en-US", opts) : "";
  const e = endDt ? new Date(endDt).toLocaleTimeString("en-US", opts) : "";
  if (s && e) return `${s} — ${e}`;
  return s || e || "-";
}

/* ---- shared helpers (kept in sync with JobList.jsx) ---- */
const num = (v) =>
  v === null || v === undefined || v === "" ? null : Number(v);

const money = (v) => {
  const n = num(v);
  return Number.isFinite(n) && n > 0
    ? `RM${n % 1 === 0 ? n : n.toFixed(2)}`
    : null;
};

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

function parkingRM(job) {
  const r = job?.rate || {};
  const v = Number.isFinite(r.parkingAllowance)
    ? r.parkingAllowance
    : Number.isFinite(r.transportAllowance)
    ? r.transportAllowance
    : Number.isFinite(r.transportBus)
    ? r.transportBus
    : null;
  return v == null ? null : Math.round(Number(v));
}

function otSuffix(hourlyRM, otRM) {
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

/* ---- visual helpers ---- */
const LABEL_SM = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "#6b7280",
};

const TEXT_MAIN = {
  fontSize: 14,
  color: "#111827",
  marginTop: 2,
};

const TEXT_MUTED = {
  fontSize: 14,
  color: "#4b5563",
};

const PAY_STRONG = {
  fontSize: 17,
  fontWeight: 700,
  color: "#111827",
};

const SECTION_DIVIDER = {
  borderTop: "1px solid #e5e7eb",
  marginTop: 16,
  paddingTop: 14,
};

export default function JobDetails({ navigate, params, user }) {
  const id =
    params?.id ||
    (typeof window !== "undefined"
      ? window.location.hash.split("/").pop()
      : "");
  const [job, setJob] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Fetch full job + list so counts match Home / JobList
        const [fullJob, list] = await Promise.all([
          apiGet(`/jobs/${id}`),
          apiGet("/jobs"),
        ]);

        let merged = fullJob;
        if (Array.isArray(list)) {
          const fromList =
            list.find((x) => x.id === fullJob.id) ||
            list.find((x) => String(x.id) === String(id));
          if (fromList) {
            merged = {
              ...fullJob,
              appliedCount:
                fromList.appliedCount ?? fullJob.appliedCount,
              approvedCount:
                fromList.approvedCount ?? fullJob.approvedCount,
              headcount: fromList.headcount ?? fullJob.headcount,
            };
          }
        }

        if (mounted) setJob(merged);
      } catch (e) {
        if (mounted) setErr(String(e));
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  if (err) {
    return (
      <div className="container" style={{ paddingTop: 16 }}>
        <div
          className="card"
          style={{ color: "#b91c1c", background: "#fff1f2" }}
        >
          {err}
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="container" style={{ paddingTop: 16 }}>
        <div className="card">Loading…</div>
      </div>
    );
  }

  const { label } = deriveKind(job);
  const payForViewer = buildPayForViewer(job, user);
  const pa = parkingRM(job);
  const ec = job.earlyCall || {};
  const lu = job.loadingUnload || {};
  const approved = Number(job.approvedCount || 0);
  const applied = Number(job.appliedCount || 0);
  const total = Number(job.headcount || 0);

  const dateLine = fmtDateRange(job.startTime, job.endTime);
  const timeLine = fmtTimeRange(job.startTime, job.endTime);

  return (
    <div className="container" style={{ paddingTop: 16 }}>
      <div className="card" style={{ display: "grid", gap: 16 }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontWeight: 800, fontSize: 22 }}>{job.title}</div>
            {job.status && (
              <div className="status" style={{ marginTop: 8 }}>
                {job.status}
              </div>
            )}
          </div>
          <button className="btn" onClick={() => window.history.back()}>
            Back
          </button>
        </div>

        {/* Summary panel */}
        <div
          style={{
            marginTop: 4,
            padding: "14px 16px",
            background: "#f9fafb",
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
            gap: 14,
          }}
        >
          <div>
            <div style={LABEL_SM}>Date</div>
            <div style={TEXT_MAIN}>{dateLine}</div>
          </div>
          <div>
            <div style={LABEL_SM}>Time</div>
            <div style={TEXT_MAIN}>{timeLine}</div>
          </div>
          <div>
            <div style={LABEL_SM}>Venue</div>
            <div style={TEXT_MAIN}>{job.venue || "-"}</div>
          </div>
          <div>
            <div style={LABEL_SM}>Session</div>
            <div style={TEXT_MAIN}>{label}</div>
          </div>
          <div>
            <div style={LABEL_SM}>Pay (your tier)</div>
            <div style={PAY_STRONG}>{payForViewer}</div>
          </div>
        </div>

        {/* Description */}
        <div style={SECTION_DIVIDER}>
          <div style={LABEL_SM}>Description</div>
          <div style={{ ...TEXT_MUTED, marginTop: 6 }}>
            {job.description || "-"}
          </div>
        </div>

        {/* Transport */}
        <div style={SECTION_DIVIDER}>
          <div style={LABEL_SM}>Transport</div>
          <div style={{ marginTop: 8 }}>
            {job.transportOptions?.bus || job.transportOptions?.own ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {job.transportOptions?.bus && (
                  <span
                    style={{
                      background: "#eef2ff",
                      color: "#3730a3",
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    ATAG Transport
                  </span>
                )}
                {job.transportOptions?.own && (
                  <span
                    style={{
                      background: "#ecfeff",
                      color: "#155e75",
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontSize: 13,
                      fontWeight: 700,
                    }}
                  >
                    Own Transport
                  </span>
                )}
              </div>
            ) : (
              <span style={{ fontSize: 12, color: "#6b7280" }}>
                No transport option
              </span>
            )}
          </div>
          {pa != null && job.transportOptions?.bus && (
            <div
              style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}
            >
              {/*ATAG Transport allowance: RM{pa} per person (if selected)*/}
            </div>
          )}
        </div>

        {/* Early Call / Loading & Unloading */}
        <div style={SECTION_DIVIDER}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
              gap: 18,
            }}
          >
            <div>
              <div style={LABEL_SM}>Early Call</div>
              <div style={{ ...TEXT_MAIN, marginTop: 6 }}>
                {ec?.enabled
                  ? `Yes · RM${Number(ec.amount || 0)}${
                      ec.thresholdHours
                        ? ` (≥ ${Number(ec.thresholdHours || 0)}h)`
                        : ""
                    }`
                  : "No"}
              </div>
            </div>
            <div>
              <div style={LABEL_SM}>Loading & Unloading</div>
              <div style={{ ...TEXT_MAIN, marginTop: 6 }}>
                {lu?.enabled
                  ? `Yes · RM${Number(lu.price || 0)}`
                  : "No"}
                                 {/* / helper · Quota ${Number(lu.quota || 0)} */}
              </div>
            </div>
          </div>
        </div>

        {/* Team status */}
        <div style={SECTION_DIVIDER}>
          <div
            style={{
              display: "flex",
              gap: 18,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div style={TEXT_MAIN}>
              <strong>Hiring for</strong>
              <span style={{ marginLeft: 6 }}>{total} pax</span>
            </div>
            <div style={{ ...TEXT_MUTED, fontSize: 13 }}>
              Approved: {approved}/{total} · Applied: {applied}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
