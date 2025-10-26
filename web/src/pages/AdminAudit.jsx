// web/src/pages/AdminAudit.jsx
import React, { useEffect, useMemo, useState } from "react";
import { apiGet } from "../api";

function Badge({ children }) {
  return (
    <span
      className="status"
      style={{ textTransform: "none", background: "#eef2ff", borderColor: "#c7d2fe" }}
    >
      {children}
    </span>
  );
}

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return String(iso || "");
  }
}

export default function AdminAudit({ user }) {
  const isAdmin = !!user && user.role === "admin";

  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState([]);
  const [limit, setLimit] = useState(500);
  const [q, setQ] = useState("");
  const [actions, setActions] = useState([]);
  const [actionFilter, setActionFilter] = useState("all");

  // Lookups to render friendly details
  const [usersById, setUsersById] = useState({});
  const [jobsById, setJobsById] = useState({});

  async function load() {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const [audit, users, jobs] = await Promise.all([
        apiGet(`/admin/audit?limit=${limit}`),
        apiGet("/admin/users").catch(() => []), // best-effort
        apiGet("/jobs").catch(() => []),        // best-effort
      ]);

      setLogs(Array.isArray(audit) ? audit : []);

      const aSet = new Set();
      (audit || []).forEach((x) => x?.action && aSet.add(x.action));
      setActions(["all", ...Array.from(aSet).sort()]);

      const uMap = {};
      (users || []).forEach((u) => (uMap[u.id] = u));
      setUsersById(uMap);

      const jMap = {};
      (jobs || []).forEach((j) => (jMap[j.id] = j));
      setJobsById(jMap);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [isAdmin, limit]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (logs || []).filter((x) => {
      if (actionFilter !== "all" && x.action !== actionFilter) return false;
      if (!t) return true;
      const hay =
        JSON.stringify({
          time: x.time,
          actor: x.actor,
          role: x.role,
          action: x.action,
          details: x.details,
        }).toLowerCase();
      return hay.includes(t);
    });
  }, [logs, q, actionFilter]);

  function userLabel(id) {
    const u = usersById[id];
    return u ? `${u.name || u.email || u.username || id} (${u.email || u.username || u.id})` : id;
  }

  function jobLabel(jid) {
    const j = jobsById[jid];
    return j ? `${j.title} [${jid}]` : jid;
  }

  function describe(row) {
    const a = row?.action;
    const d = row?.details || {};
    // Common helpers
    const J = d.jobId ? jobLabel(d.jobId) : null;
    const U = d.userId ? userLabel(d.userId) : null;

    switch (a) {
      case "register":
        return `Registered: ${d.email || ""}`;
      case "login":
        return `Login (${d.identifier || ""})`;
      case "forgot_password":
        return `Requested password reset: ${d.email || ""}`;
      case "reset_password":
        return `Reset password for user ${d.userId || ""}`;
      case "create_job":
        return `Created job "${d.title || ""}" [${d.jobId || ""}]`;
      case "edit_job":
        return `Edited job ${J || ""}`;
      case "delete_job":
        return `Deleted job ${J || d.jobId || ""}`;
      case "update_job_rate":
        return `Updated rate for ${J || ""}`;
      case "update_adjustments":
        return `Updated adjustments (${d.entries ?? 0}) for ${J || ""}`;
      case "apply":
        return `Applied to ${J || ""} (transport: ${d.transport || "-"}${d.wantsLU ? ", wants L&U" : ""})`;
      case "reapply":
        return `Re-applied to ${J || ""} (transport: ${d.transport || "-"}${d.wantsLU ? ", wants L&U" : ""})`;
      case "approve":
        return `Approved ${U || ""} for ${J || ""}`;
      case "reject":
        return `Rejected ${U || ""} for ${J || ""}`;
      case "start_event":
        return `Started event for ${J || ""}`;
      case "end_event":
        return `Ended event for ${J || ""}`;
      case "reset_event":
        return `Reset event for ${J || ""} (keepAttendance: ${d.keepAttendance ? "yes" : "no"})`;
      case "gen_qr":
        return `Generated QR for ${J || ""} (${d.dir}) at ${d.lat},${d.lng}`;
      case "scan_in":
      case "scan_out":
        return `Recorded ${a === "scan_in" ? "IN" : "OUT"} for ${U || ""} on ${J || ""} (distance ${d.distanceMeters ?? "?"}m)`;
      case "scanner_heartbeat":
        return `Scanner heartbeat for ${J || ""} at ${d.lat},${d.lng}`;
      case "lu_mark":
        return `Loading & Unloading ${d.present ? "present" : "cleared"}: ${U || ""} on ${J || ""}`;
      case "attendance_mark":
        return `Manually updated attendance for ${U || ""} on ${J || ""}`;
      case "attendance_clear":
        return `Cleared attendance for ${U || ""} on ${J || ""}`;
      case "admin_update_user_role_grade": {
        const b = d.before || {};
        const af = d.after || {};
        const target = userLabel(d.userId || "");
        return `Changed ${target} — role: ${b.role} → ${af.role}; grade: ${(b.grade||"junior")} → ${(af.grade||"junior")}`;
      }
      default:
        // Fallback: show compact JSON of details
        try {
          return a + ": " + JSON.stringify(d);
        } catch {
          return a;
        }
    }
  }

  if (!isAdmin) {
    return <div className="container">Not authorized.</div>;
  }

  return (
    <div className="container" style={{ paddingTop: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>Audit Log</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <input
            placeholder="Search actor / job / action / details…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="card"
            style={{ padding: 8, width: 320 }}
          />
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {[100, 200, 500, 1000].map((n) => (
              <option key={n} value={n}>
                limit {n}
              </option>
            ))}
          </select>
          <button className="btn" onClick={load}>Refresh</button>
        </div>
      </div>

      {loading ? (
        <div>Loading…</div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: "8px" }}>Time</th>
                <th style={{ padding: "8px" }}>Actor</th>
                <th style={{ padding: "8px" }}>Role</th>
                <th style={{ padding: "8px" }}>Action</th>
                <th style={{ padding: "8px" }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: 8, whiteSpace: "nowrap" }}>{fmtDate(row.time)}</td>
                  <td style={{ padding: 8 }}>{row.actor}</td>
                  <td style={{ padding: 8 }}>
                    <Badge>{row.role}</Badge>
                  </td>
                  <td style={{ padding: 8 }}>
                    <Badge>{row.action}</Badge>
                  </td>
                  <td style={{ padding: 8 }}>
                    <div style={{ whiteSpace: "pre-wrap" }}>{describe(row)}</div>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={5} style={{ padding: 12, color: "#666" }}>
                    No audit entries.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 10, color: "#666" }}>
        Shows: job applications, approvals/rejections, job CRUD, rate/adjustment changes,
        attendance/QR events, and admin role/grade changes.
      </div>
    </div>
  );
}
