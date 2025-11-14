// web/src/pages/AdminUsers.jsx
import React, { useEffect, useMemo, useState } from "react";
import { apiGet, apiPatch } from "../api";

const ROLES  = ["part-timer", "pm", "admin"];
const GRADES = ["junior", "senior", "lead"];

export default function AdminUsers({ user }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [edits, setEdits] = useState({}); // { [userId]: { role?, grade? } }

  const isAdmin = !!user && user.role === "admin";

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    apiGet("/admin/users")
      .then((rows) => setList(Array.isArray(rows) ? rows : []))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return list;
    return list.filter((u) => {
      const email   = (u.email    || "").toLowerCase();
      const uname   = (u.username || "").toLowerCase();
      const name    = (u.name     || "").toLowerCase();
      const phone   = (u.phone    || "").toLowerCase();
      const discord = (u.discord  || "").toLowerCase();
      return (
        email.includes(t) ||
        uname.includes(t) ||
        name.includes(t) ||
        phone.includes(t) ||
        discord.includes(t)
      );
    });
  }, [q, list]);

  function getDraft(u) {
    const d = edits[u.id] || {};
    return {
      role:  d.role  ?? u.role,
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

  if (!isAdmin) {
    return <div className="container">Not authorized.</div>;
  }

  return (
    <div className="container" style={{ paddingTop: 16 }}>
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
        <div style={{ fontSize: 22, fontWeight: 800 }}>Users</div>
        <input
          placeholder="Search email / username / name / phone / discord"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="card"
          style={{ padding: 8, width: 320, maxWidth: "100%" }}
        />
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
                <th style={{ padding: "8px" }}>Account Role</th>
                <th style={{ padding: "8px" }}>Staff Grade</th>
                <th style={{ padding: "8px" }}></th>
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
                    <td style={{ padding: 8, display: "flex", gap: 8 }}>
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
      )}

      <div style={{ marginTop: 10, color: "#666" }}>
        Tip: all new registrations start as <code>part-timer</code> with grade{" "}
        <code>junior</code>. Use this page to promote/demote.
      </div>
    </div>
  );
}
