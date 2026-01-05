// web/src/pages/PMJobDetails.jsx
import React, { useEffect, useRef, useState, useMemo } from "react";
import dayjs from "dayjs";
import { apiGet, apiPost } from "../api";

/* ---------------- helpers ---------------- */
const toRad = (d) => (d * Math.PI) / 180;
function haversineMeters(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const aa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(aa)));
}

function fmtRange(start, end) {
  try {
    const s = dayjs(start);
    const e = dayjs(end);
    const sameDay = s.isSame(e, "day");
    const d = s.format("YYYY/MM/DD");
    const t1 = s.format("h:mm a");
    const t2 = e.format("h:mm a");
    return sameDay ? `${d}  ${t1} — ${t2}` : `${s.format("YYYY/MM/DD h:mm a")} — ${e.format("YYYY/MM/DD h:mm a")}`;
  } catch {
    return "";
  }
}

function fmtTime(ts) {
  if (!ts) return "—";
  try {
    return dayjs(ts).format("h:mm a");
  } catch {
    return "—";
  }
}

function parseError(err) {
  if (!err) return {};
  if (typeof err === "string") return { message: err };
  if (err.message) {
    try {
      return JSON.parse(err.message);
    } catch {
      return { message: err.message };
    }
  }
  return {};
}

/* ---- Full-timer duty roles ---- */
const FT_ROLES = ["junior_marshal", "senior_marshal", "lead_marshal", "crew", "driver"];
const FT_ROLE_LABEL = {
  junior_marshal: "Junior Marshal",
  senior_marshal: "Senior Marshal",
  lead_marshal: "Lead Marshal",
  crew: "Crew",
  driver: "Driver",
};

const LOCAL_KEY = (jobId) => (jobId ? `atag.pmjob.actualEndAt.${jobId}` : "");

function isVirtualJob(job) {
  const kind = job?.rate?.sessionKind || job?.sessionKind || job?.physicalType;
  return kind === "virtual" || job?.session?.mode === "virtual" || job?.sessionMode === "virtual" || job?.mode === "virtual";
}

export default function PMJobDetails({ jobId }) {
  /* ---------- state ---------- */
  const [job, setJob] = useState(null);
  const [applicants, setApplicants] = useState([]);

  // Per-person add-ons / tags (used by payroll)
  const [luParticipants, setLuParticipants] = useState(() => new Set());
  const [earlyCallParticipants, setEarlyCallParticipants] = useState(() => new Set());

  const [loading, setLoading] = useState(true);

  const [fullTimers, setFullTimers] = useState([]);
  const [ftModalOpen, setFtModalOpen] = useState(false);
  const [ftRole, setFtRole] = useState("junior_marshal");
  const [ftCandidates, setFtCandidates] = useState([]);
  const [ftLoadingUsers, setFtLoadingUsers] = useState(false);
  const [ftSaving, setFtSaving] = useState(false);

  const [statusForce, setStatusForce] = useState(null);
  const effectiveStatus = (s) => statusForce ?? s ?? "upcoming";

  const videoRef = useRef(null);
  const endedAtRef = useRef(null);

  /* ---------- load job ---------- */
  async function load(silent = false) {
    if (!silent) setLoading(true);
    const bust = `?_=${Date.now()}`;
    try {
      const j = await apiGet(`/jobs/${jobId}${bust}`);
      let merged = statusForce ? { ...j, status: statusForce } : j;

      setJob(merged);

      const a = await apiGet(`/jobs/${jobId}/applicants${bust}`).catch(() => []);
      setApplicants(a);

      const l = await apiGet(`/jobs/${jobId}/loading${bust}`).catch(() => null);
      setLuParticipants(new Set((l && l.participants) || []));

      const ec = await apiGet(`/jobs/${jobId}/earlycall${bust}`).catch(() => null);
      setEarlyCallParticipants(new Set((ec && ec.participants) || []));
    } catch (e) {
      if (e && e.status === 401) window.location.replace("#/login");
      else console.error("load job failed", e);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [jobId]);

  const isVirtual = useMemo(() => isVirtualJob(job), [job]);

  async function setApproval(userId, approve) {
    await apiPost(`/jobs/${jobId}/approve`, { userId, approve });
    await load();
  }

  async function toggleLoadingUnload(userId) {
    const next = !luParticipants.has(userId);
    setLuParticipants((prev) => {
      const s = new Set(prev);
      next ? s.add(userId) : s.delete(userId);
      return s;
    });
    try {
      await apiPost(`/jobs/${jobId}/loading/mark`, { userId, present: next });
    } catch (e) {
      alert("Failed to update Loading/Unloading status.");
    }
  }

  async function toggleEarlyCall(userId) {
    const next = !earlyCallParticipants.has(userId);
    setEarlyCallParticipants((prev) => {
      const s = new Set(prev);
      next ? s.add(userId) : s.delete(userId);
      return s;
    });
    try {
      await apiPost(`/jobs/${jobId}/earlycall/mark`, { userId, present: next });
    } catch (e) {
      alert("Failed to update Early Call status. (Backend endpoint needed)");
    }
  }

  const MiniSwitch = ({ checked, onToggle, title }) => (
    <label title={title} style={{ display: "inline-flex", cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={onToggle} style={{ display: "none" }} />
      <span
        style={{
          width: 34,
          height: 18,
          borderRadius: 999,
          background: checked ? "#16a34a" : "#d1d5db",
          position: "relative",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 18 : 2,
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 120ms ease",
            boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
          }}
        />
      </span>
    </label>
  );

  const findApplicant = (uid) => applicants.find((x) => x.userId === uid);

  const approvedRows = (job?.approved || []).map((uid) => {
    const app = findApplicant(uid) || {};
    const attendanceMap = job?.attendance || {};
    const rec = attendanceMap[uid] || {};
    return {
      userId: uid,
      email: app.email || uid,
      name: app.name || "",
      phone: app.phone || "",
      discord: app.discord || "",
      in: rec.in,
      out: rec.out,
    };
  });

  if (!job) return <div className="container">{loading ? "Loading..." : "No job found."}</div>;

  return (
    <div className="container">
      {/* Applicants */}
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Applicants</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ textAlign: "left", padding: "10px 8px" }}>Email</th>
                <th style={{ textAlign: "left", padding: "10px 8px" }}>Name</th>
                <th style={{ textAlign: "left", padding: "10px 8px" }}>Phone</th>
                <th style={{ textAlign: "left", padding: "10px 8px" }}>Discord</th>
                <th style={{ textAlign: "left", padding: "10px 8px" }}>Transport</th>
                <th style={{ textAlign: "left", padding: "10px 8px" }}>Status</th>
                <th style={{ textAlign: "left", padding: "10px 8px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {applicants.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 12, color: "#6b7280" }}>
                    No applicants yet.
                  </td>
                </tr>
              ) : (
                applicants.map((a) => (
                  <tr key={a.userId} style={{ borderTop: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "10px 8px" }}>{a.email}</td>
                    <td style={{ padding: "10px 8px" }}>{a.name || "-"}</td>
                    <td style={{ padding: "10px 8px" }}>{a.phone || "-"}</td>
                    <td style={{ padding: "10px 8px" }}>{a.discord || "-"}</td>
                    <td style={{ padding: "10px 8px" }}>{a.transport || "-"}</td>
                    <td style={{ padding: "10px 8px" }}>{a.status}</td>
                    <td style={{ padding: "10px 8px" }}>
                      <button onClick={() => setApproval(a.userId, true)} className="btn" style={{ background: "#22c55e", color: "#fff" }}>
                        Approve
                      </button>
                      <button onClick={() => setApproval(a.userId, false)} className="btn danger">
                        Reject
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Approved List */}
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>
          Approved List & Attendance
          <span
            style={{
              marginLeft: 8,
              fontSize: 12,
              padding: "2px 10px",
              borderRadius: 999,
              background: "#f3f4f6",
              color: "#374151",
            }}
          >
            {approvedRows.length}
          </span>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 750 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "8px 4px", width: 32, color: "#6b7280" }}>#</th>
                <th style={{ textAlign: "left", padding: "8px 4px" }}>Email</th>
                <th style={{ textAlign: "left", padding: "8px 4px" }}>Name</th>
                <th style={{ textAlign: "left", padding: "8px 4px" }}>Phone</th>
                <th style={{ textAlign: "left", padding: "8px 4px" }}>Discord</th>
                <th style={{ textAlign: "left", padding: "8px 4px", width: 44 }}>EC</th>
                <th style={{ textAlign: "left", padding: "8px 4px", width: 54 }}>L&amp;U</th>
                <th style={{ textAlign: "center", padding: "8px 4px", width: 120 }}>In</th>
                <th style={{ textAlign: "center", padding: "8px 4px", width: 120 }}>Out</th>
              </tr>
            </thead>

            <tbody>
              {approvedRows.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ color: "#6b7280", padding: 8 }}>
                    No approved users yet.
                  </td>
                </tr>
              ) : (
                approvedRows.map((r, idx) => (
                  <tr key={r.userId || r.email} style={{ borderTop: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "8px 4px", color: "#6b7280" }}>{idx + 1}</td>
                    <td style={{ padding: "8px 4px" }}>{r.email}</td>
                    <td style={{ padding: "8px 4px" }}>{r.name || "-"}</td>
                    <td style={{ padding: "8px 4px" }}>{r.phone || "-"}</td>
                    <td style={{ padding: "8px 4px" }}>{r.discord || "-"}</td>

                    <td style={{ padding: "8px 4px" }}>
                      <MiniSwitch checked={earlyCallParticipants.has(r.userId)} onToggle={() => toggleEarlyCall(r.userId)} title="Early Call toggle" />
                    </td>

                    <td style={{ padding: "8px 4px" }}>
                      <MiniSwitch checked={luParticipants.has(r.userId)} onToggle={() => toggleLoadingUnload(r.userId)} title="Loading & Unloading toggle" />
                    </td>

                    <td style={{ padding: "8px 4px", textAlign: "center" }}>{fmtTime(r.in)}</td>
                    <td style={{ padding: "8px 4px", textAlign: "center" }}>{fmtTime(r.out)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
