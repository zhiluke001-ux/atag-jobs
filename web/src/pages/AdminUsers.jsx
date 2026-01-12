// web/src/pages/AdminUsers.jsx
import React, { useEffect, useMemo, useState } from "react";
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

export default function AdminUsers({ user }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [edits, setEdits] = useState({}); // { [userId]: { role?, grade? } }
  const [busyVerifyId, setBusyVerifyId] = useState(null);
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

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return list;
    return list.filter((u) => {
      const email = (u.email || "").toLowerCase();
      const uname = (u.username || "").toLowerCase();
      const name = (u.name || "").toLowerCase();
      const phone = (u.phone || "").toLowerCase();
      const discord = (u.discord || "").toLowerCase();
      const verified = String(u.verified ? "verified" : "pending");
      return (
        email.includes(t) ||
        uname.includes(t) ||
        name.includes(t) ||
        phone.includes(t) ||
        discord.includes(t) ||
        verified.includes(t)
      );
    });
  }, [q, list]);

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
      if (String(msg).includes("last_admin")) {
        alert("Cannot remove the last admin.");
      } else {
        alert(msg);
      }
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

  // ✅ Verification actions
  async function setVerified(u, verified) {
    try {
      setBusyVerifyId(u.id);
      // backend should support PATCH /admin/users/:id { verified: true/false }
      const res = await apiPatch(`/admin/users/${u.id}`, { verified: !!verified });
      const updated = res?.user || { ...u, verified: !!verified };
      setList((old) => old.map((x) => (x.id === u.id ? updated : x)));
      alert(verified ? "User verified ✅" : "User unverified.");
    } catch (err) {
      alert(err?.message || "Verify failed");
    } finally {
      setBusyVerifyId(null);
    }
  }

  if (!isAdmin) {
    return <div className="container">Not authorized.</div>;
  }

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
            Pending users can’t log in until verified. Search “pending” / “verified”.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            placeholder="Search email / username / name / phone / discord / pending"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="card"
            style={{ padding: 8, width: 360, maxWidth: "100%" }}
          />
          <button className="btn" onClick={refresh} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card">Loading...</div>
      ) : (
        <div className="card table-shell" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: "8px" }}>Name</th>
                <th style={{ padding: "8px" }}>Email</th>
                <th style={{ padding: "8px" }}>Username</th>
                <th style={{ padding: "8px" }}>Phone</th>
                <th style={{ padding: "8px" }}>Discord</th>

                <th style={{ padding: "8px" }}>Status</th>
                <th style={{ padding: "8px" }}>Verification Pic</th>

                <th style={{ padding: "8px" }}>Account Role</th>
                <th style={{ padding: "8px" }}>Staff Grade</th>
                <th style={{ padding: "8px" }} />
              </tr>
            </thead>

            <tbody>
              {filtered.map((u) => {
                const draft = getDraft(u);
                const dirty = isDirty(u);

                const verified = !!u.verified;
                const hasPic = !!u.verifyImageUrl; // ✅ expects backend to return this field
                const picUrl = u.verifyImageUrl || "";

                return (
                  <tr key={u.id} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: 8 }}>{u.name || "—"}</td>
                    <td style={{ padding: 8 }}>{u.email || "—"}</td>
                    <td style={{ padding: 8 }}>{u.username || "—"}</td>
                    <td style={{ padding: 8 }}>{u.phone || "—"}</td>
                    <td style={{ padding: 8 }}>{u.discord || "—"}</td>

                    <td style={{ padding: 8 }}>
                      {verified ? (
                        <span style={pillStyle("#ecfdf5", "#6ee7b7", "#065f46")}>
                          ✅ Verified
                        </span>
                      ) : (
                        <span style={pillStyle("#fff7ed", "#fdba74", "#9a3412")}>
                          ⏳ Pending
                        </span>
                      )}
                    </td>

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
                      <select
                        value={draft.role}
                        onChange={(e) => setDraft(u, { role: e.target.value })}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td style={{ padding: 8 }}>
                      <select
                        value={draft.grade}
                        onChange={(e) => setDraft(u, { grade: e.target.value })}
                      >
                        {GRADES.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td style={{ padding: 8 }}>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {/* verify / unverify */}
                        {!verified ? (
                          <button
                            className="btn primary"
                            disabled={busyVerifyId === u.id || !hasPic}
                            title={!hasPic ? "User must upload verification picture first" : ""}
                            onClick={() => setVerified(u, true)}
                          >
                            {busyVerifyId === u.id ? "Verifying..." : "Verify"}
                          </button>
                        ) : (
                          <button
                            className="btn"
                            disabled={busyVerifyId === u.id}
                            onClick={() => setVerified(u, false)}
                          >
                            {busyVerifyId === u.id ? "Working..." : "Unverify"}
                          </button>
                        )}

                        {/* save role/grade */}
                        <button
                          className="btn primary"
                          disabled={savingId === u.id || !dirty}
                          onClick={() => save(u)}
                        >
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
                  <td colSpan={10} style={{ padding: 12, color: "#666" }}>
                    No users.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 10, color: "#666" }}>
        Tip: all new registrations start as <code>part-timer</code> with grade{" "}
        <code>junior</code> and status <code>pending</code>. Verify them after checking
        the uploaded pic.
      </div>

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
