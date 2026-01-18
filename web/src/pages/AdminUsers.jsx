// web/src/pages/AdminUsers.jsx
import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { apiGet, apiPatch } from "../api";

const ROLES = ["part-timer", "pm", "admin"];
const GRADES = ["junior", "senior", "lead"];

function pillStyle(bg, border, color) {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    padding: "4px 8px",
    borderRadius: 999,
    background: bg,
    border: `1px solid ${border}`,
    color,
    fontWeight: 700,
    whiteSpace: "nowrap",
  };
}

/* ---------- URL helper (supports relative urls + data urls) ---------- */
const API_BASE_CLEAN = (() => {
  try {
    const v = import.meta?.env?.VITE_API_BASE || import.meta?.env?.VITE_API_URL || "";
    return String(v || "").replace(/\/$/, "");
  } catch {
    return "";
  }
})();

function toAbsUrl(u) {
  if (!u) return "";
  const s = String(u);
  if (/^data:/i.test(s) || /^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return window.location.protocol + s;
  if (API_BASE_CLEAN) return API_BASE_CLEAN + (s.startsWith("/") ? s : `/${s}`);
  return s;
}

/* ---------- flexible getters for backend field name differences ---------- */
function pickFirstString(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function getVerifyPicUrl(u) {
  // supports: url OR dataUrl saved in DB
  const raw = pickFirstString(u, [
    "verifyImageUrl",
    "verify_image_url",
    "verificationImageUrl",
    "verification_image_url",
    "verifyPhotoUrl",
    "verify_photo_url",
    "verificationPhotoUrl",
    "verification_photo_url",
    "verifyImageDataUrl",
    "verify_image_data_url",
    "verificationDataUrl",
    "verification_data_url",
  ]);
  return toAbsUrl(raw);
}

function getVerifyStatus(u) {
  const raw = pickFirstString(u, ["verificationStatus", "verifyStatus", "verification_status", "verify_status"]);
  const s = (raw || "").toLowerCase();

  // normalize common values
  if (["verified", "approve", "approved"].includes(s)) return "verified";
  if (["rejected", "reject", "declined"].includes(s)) return "rejected";
  if (["pending", "awaiting", "new"].includes(s)) return "pending";

  // fallback to boolean
  if (u?.verified === true) return "verified";
  if (u?.verified === false) return "pending";
  return "pending";
}

function fmtSubmitted(u) {
  const t =
    u?.verificationSubmittedAt ||
    u?.verifySubmittedAt ||
    u?.submittedAt ||
    u?.createdAt ||
    u?.created_at ||
    null;

  if (!t) return "—";
  try {
    return dayjs(t).format("YYYY/MM/DD HH:mm");
  } catch {
    return "—";
  }
}

function TabBtn({ active, onClick, children, badge }) {
  return (
    <button
      className="btn"
      onClick={onClick}
      style={{
        borderRadius: 12,
        fontWeight: 800,
        background: active ? "#ef4444" : "#fff",
        color: active ? "#fff" : "#111827",
        borderColor: active ? "#ef4444" : "var(--border)",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      {children}
      {Number.isFinite(badge) ? (
        <span
          style={{
            background: active ? "rgba(255,255,255,.25)" : "#fee2e2",
            color: active ? "#fff" : "#991b1b",
            padding: "2px 8px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 900,
          }}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

export default function AdminUsers({ user }) {
  const [tab, setTab] = useState("manage"); // "manage" | "verify"

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const [savingId, setSavingId] = useState(null);
  const [edits, setEdits] = useState({}); // { [userId]: { role?, grade? } }

  const [busyActionId, setBusyActionId] = useState(null); // verify/reject action busy
  const [imgOpen, setImgOpen] = useState(null); // url string

  const isAdmin = !!user && user.role === "admin";

  async function refresh() {
    setLoading(true);
    try {
      const rows = await apiGet("/admin/users");
      setList(Array.isArray(rows) ? rows : []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const pendingCount = useMemo(() => {
    return (list || []).filter((u) => getVerifyStatus(u) === "pending").length;
  }, [list]);

  // ----- search filter depends on tab -----
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return list;

    return (list || []).filter((u) => {
      const email = (u.email || "").toLowerCase();
      const uname = (u.username || "").toLowerCase();
      const name = (u.name || "").toLowerCase();
      const phone = (u.phone || "").toLowerCase();
      const discord = (u.discord || "").toLowerCase();

      const status = getVerifyStatus(u);
      const statusText = String(status);

      return (
        email.includes(t) ||
        uname.includes(t) ||
        name.includes(t) ||
        phone.includes(t) ||
        discord.includes(t) ||
        statusText.includes(t)
      );
    });
  }, [q, list]);

  // =========================
  // User Management helpers
  // =========================
  function getDraft(u) {
    const d = edits[u.id] || {};
    return {
      role: d.role ?? u.role,
      grade: d.grade ?? (u.grade || "junior"),
    };
  }

  function setDraft(u, patch) {
    setEdits((old) => ({
      ...old,
      [u.id]: { ...(old[u.id] || {}), ...patch },
    }));
  }

  function isDirty(u) {
    const d = getDraft(u);
    return d.role !== u.role || (d.grade || "junior") !== (u.grade || "junior");
  }

  async function save(u) {
    const draft = getDraft(u);
    const body = {};
    if (draft.role !== u.role) body.role = draft.role;
    if ((draft.grade || "junior") !== (u.grade || "junior")) body.grade = draft.grade;

    if (!Object.keys(body).length) {
      alert("No changes to save.");
      return;
    }

    try {
      setSavingId(u.id);
      const res = await apiPatch(`/admin/users/${u.id}`, body);
      const updated = res?.user || { ...u, ...body };
      setList((old) => old.map((x) => (x.id === u.id ? updated : x)));
      setEdits((old) => {
        const nxt = { ...old };
        delete nxt[u.id];
        return nxt;
      });
      alert("Saved.");
    } catch (err) {
      const msg = err?.message || "Save failed";
      if (String(msg).includes("last_admin")) alert("Cannot remove the last admin.");
      else alert(msg);
    } finally {
      setSavingId(null);
    }
  }

  function resetRow(u) {
    setEdits((old) => {
      const nxt = { ...old };
      delete nxt[u.id];
      return nxt;
    });
  }

  // =========================
  // Verification actions
  // =========================
  async function setVerification(u, nextStatus) {
    // nextStatus: "verified" | "rejected" | "pending"
    try {
      setBusyActionId(u.id);

      // Send multiple keys so backend with different schema still works
      const body = {
        verificationStatus: nextStatus,
        verified: nextStatus === "verified",
      };

      const res = await apiPatch(`/admin/users/${u.id}`, body);
      const updated =
        res?.user ||
        res ||
        {
          ...u,
          ...body,
        };

      setList((old) => old.map((x) => (x.id === u.id ? updated : x)));

      if (nextStatus === "verified") alert("User verified ✅");
      if (nextStatus === "rejected") alert("User rejected.");
    } catch (err) {
      alert(err?.message || "Action failed");
    } finally {
      setBusyActionId(null);
    }
  }

  if (!isAdmin) {
    return <div className="container">Not authorized.</div>;
  }

  const showManage = tab === "manage";
  const showVerify = tab === "verify";

  const verificationRows = (filtered || []).filter((u) => {
    const st = getVerifyStatus(u);
    // show pending + rejected (you can search "verified" if you want, but default hide)
    return st !== "verified";
  });

  return (
    <div className="container" style={{ paddingTop: 16 }}>
      {/* Header */}
      <div
        className="card"
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>Users</div>
          <div style={{ color: "#666", fontSize: 12, marginTop: 4 }}>
            Use <strong>Verification</strong> to approve/reject new registrations.
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <TabBtn active={showManage} onClick={() => setTab("manage")}>
              User Management
            </TabBtn>

            <TabBtn active={showVerify} onClick={() => setTab("verify")} badge={pendingCount}>
              Verification
            </TabBtn>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            placeholder={
              showVerify
                ? 'Search name/email/phone/discord ("pending","rejected")'
                : "Search email / username / name / phone / discord"
            }
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="card"
            style={{ padding: 8, width: 420, maxWidth: "100%" }}
          />
          <button className="btn" onClick={refresh} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card">Loading...</div>
      ) : showManage ? (
        /* ========================= User Management ========================= */
        <div className="card table-shell" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: "8px" }}>Name</th>
                <th style={{ padding: "8px" }}>Email</th>
                <th style={{ padding: "8px" }}>Username</th>
                <th style={{ padding: "8px" }}>Phone</th>
                <th style={{ padding: "8px" }}>Discord</th>
                <th style={{ padding: "8px" }}>Account Role</th>
                <th style={{ padding: "8px" }}>Staff Grade</th>
                <th style={{ padding: "8px" }} />
              </tr>
            </thead>

            <tbody>
              {filtered.map((u) => {
                const draft = getDraft(u);
                const dirty = isDirty(u);

                return (
                  <tr key={u.id} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: 8 }}>{u.name || "—"}</td>
                    <td style={{ padding: 8 }}>{u.email || "—"}</td>
                    <td style={{ padding: 8 }}>{u.username || "—"}</td>
                    <td style={{ padding: 8 }}>{u.phone || "—"}</td>
                    <td style={{ padding: 8 }}>{u.discord || "—"}</td>

                    <td style={{ padding: 8 }}>
                      <select value={draft.role} onChange={(e) => setDraft(u, { role: e.target.value })}>
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td style={{ padding: 8 }}>
                      <select value={draft.grade} onChange={(e) => setDraft(u, { grade: e.target.value })}>
                        {GRADES.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td style={{ padding: 8 }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button className="btn primary" disabled={savingId === u.id || !dirty} onClick={() => save(u)}>
                          {savingId === u.id ? "Saving..." : "Save"}
                        </button>

                        {dirty && (
                          <button className="btn" onClick={() => resetRow(u)}>
                            Reset
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!filtered.length && (
                <tr>
                  <td colSpan={8} style={{ padding: 12, color: "#666" }}>
                    No users.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        /* ========================= Verification ========================= */
        <div className="card table-shell" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: "8px" }}>Name</th>
                <th style={{ padding: "8px" }}>Email</th>
                <th style={{ padding: "8px" }}>Phone</th>
                <th style={{ padding: "8px" }}>Discord</th>
                <th style={{ padding: "8px" }}>Submitted</th>
                <th style={{ padding: "8px" }}>Verification Pic</th>
                <th style={{ padding: "8px" }}>Status</th>
                <th style={{ padding: "8px" }} />
              </tr>
            </thead>

            <tbody>
              {verificationRows.map((u) => {
                const status = getVerifyStatus(u);
                const picUrl = getVerifyPicUrl(u);
                const hasPic = !!picUrl;

                return (
                  <tr key={u.id} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: 8 }}>{u.name || "—"}</td>
                    <td style={{ padding: 8 }}>{u.email || "—"}</td>
                    <td style={{ padding: 8 }}>{u.phone || "—"}</td>
                    <td style={{ padding: 8 }}>{u.discord || "—"}</td>

                    <td style={{ padding: 8 }}>{fmtSubmitted(u)}</td>

                    <td style={{ padding: 8 }}>
                      {hasPic ? (
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <img
                            src={picUrl}
                            alt="verification"
                            style={{
                              width: 38,
                              height: 38,
                              borderRadius: 10,
                              objectFit: "cover",
                              border: "1px solid #eee",
                              cursor: "pointer",
                            }}
                            onClick={() => setImgOpen(picUrl)}
                          />
                          <button className="btn" onClick={() => setImgOpen(picUrl)}>
                            View
                          </button>
                        </div>
                      ) : (
                        <span style={{ color: "#666", fontSize: 12 }}>No pic</span>
                      )}
                    </td>

                    <td style={{ padding: 8 }}>
                      {status === "verified" ? (
                        <span style={pillStyle("#ecfdf5", "#6ee7b7", "#065f46")}>✅ Verified</span>
                      ) : status === "rejected" ? (
                        <span style={pillStyle("#fee2e2", "#fca5a5", "#991b1b")}>⛔ Rejected</span>
                      ) : (
                        <span style={pillStyle("#fff7ed", "#fdba74", "#9a3412")}>⏳ Pending</span>
                      )}
                    </td>

                    <td style={{ padding: 8 }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          className="btn primary"
                          disabled={busyActionId === u.id || !hasPic}
                          title={!hasPic ? "User must upload verification picture first" : ""}
                          onClick={() => setVerification(u, "verified")}
                        >
                          {busyActionId === u.id ? "Working..." : "Verify"}
                        </button>

                        <button
                          className="btn"
                          disabled={busyActionId === u.id}
                          onClick={() => setVerification(u, "rejected")}
                        >
                          {busyActionId === u.id ? "Working..." : "Reject"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!verificationRows.length && (
                <tr>
                  <td colSpan={8} style={{ padding: 12, color: "#666" }}>
                    No pending/rejected users.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div style={{ marginTop: 10, color: "#666", fontSize: 12 }}>
            Tip: Reject keeps the account unverified. User can re-upload from <code>Profile → Status</code>.
          </div>
        </div>
      )}

      {/* Simple image modal */}
      {imgOpen && (
        <div
          onClick={() => setImgOpen(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 9999,
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 760,
              width: "100%",
              padding: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 800 }}>Verification Picture</div>
              <button className="btn" onClick={() => setImgOpen(null)}>
                Close
              </button>
            </div>
            <div style={{ marginTop: 10 }}>
              <img
                src={imgOpen}
                alt="verification-large"
                style={{
                  width: "100%",
                  maxHeight: "70vh",
                  objectFit: "contain",
                  borderRadius: 12,
                  border: "1px solid #eee",
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
