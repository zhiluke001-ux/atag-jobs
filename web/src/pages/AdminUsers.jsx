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
  const isAdmin = !!user && user.role === "admin";

  useEffect(() => {
    if (!isAdmin) return;
    setLoading(true);
    apiGet("/admin/users")
      .then(setList)
      .finally(() => setLoading(false));
  }, [isAdmin]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return list;
    return list.filter(
      (u) =>
        (u.email || "").toLowerCase().includes(t) ||
        (u.username || "").toLowerCase().includes(t) ||
        (u.name || "").toLowerCase().includes(t)
    );
  }, [q, list]);

  async function save(u, next) {
    try {
      setSavingId(u.id);
      const body = {};
      if (next.role  && next.role  !== u.role)  body.role  = next.role;
      if (next.grade && next.grade !== u.grade) body.grade = next.grade;
      if (!Object.keys(body).length) return;

      const res = await apiPatch(`/admin/users/${u.id}`, body);
      const updated = res?.user || { ...u, ...next };
      setList((old) => old.map((x) => (x.id === u.id ? updated : x)));
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

  if (!isAdmin) {
    return <div className="container">Not authorized.</div>;
  }

  return (
    <div className="container" style={{ paddingTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>Users</div>
        <input
          placeholder="Search email / username / name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="card"
          style={{ padding: 8, width: 320 }}
        />
      </div>

      {loading ? (
        <div>Loading...</div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ padding: "8px" }}>Name</th>
                <th style={{ padding: "8px" }}>Email</th>
                <th style={{ padding: "8px" }}>Username</th>
                <th style={{ padding: "8px" }}>Account Role</th>
                <th style={{ padding: "8px" }}>Staff Grade</th>
                <th style={{ padding: "8px" }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => {
                const [role, setRole] = [u.role, (v) => (u.role = v)];
                const [grade, setGrade] = [u.grade || "junior", (v) => (u.grade = v)];
                return (
                  <tr key={u.id} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: 8 }}>{u.name}</td>
                    <td style={{ padding: 8 }}>{u.email}</td>
                    <td style={{ padding: 8 }}>{u.username}</td>
                    <td style={{ padding: 8 }}>
                      <select defaultValue={role} onChange={(e) => setRole(e.target.value)}>
                        {ROLES.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: 8 }}>
                      <select defaultValue={grade} onChange={(e) => setGrade(e.target.value)}>
                        {GRADES.map((g) => (
                          <option key={g} value={g}>{g}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: 8 }}>
                      <button
                        className="btn primary"
                        disabled={savingId === u.id}
                        onClick={() => save(u, { role: u.role, grade: u.grade || "junior" })}
                      >
                        {savingId === u.id ? "Saving..." : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr>
                  <td colSpan={6} style={{ padding: 12, color: "#666" }}>
                    No users.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 10, color: "#666" }}>
        Tip: all new registrations start as <code>part-timer</code> with grade <code>junior</code>. Use this page to promote/demote.
      </div>
    </div>
  );
}
