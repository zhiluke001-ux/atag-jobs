// web/src/pages/AdminUsers.jsx
import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { apiDelete, apiGet, apiPatch, apiPost } from "../api";

const ROLES = ["part-timer", "pm", "admin"];
// Keep in sync with backend STAFF_ROLES.
const GRADES = ["junior", "senior", "lead", "junior_emcee", "senior_emcee"];

function gradeLabel(value) {
  const grade = String(value || "");
  if (grade === "junior_emcee") return "Junior (Emcee)";
  if (grade === "senior_emcee") return "Senior (Emcee)";
  if (!grade) return "Junior";
  return grade.charAt(0).toUpperCase() + grade.slice(1);
}

function roleLabel(value) {
  if (value === "part-timer") return "Part-timer";
  if (value === "pm") return "Project Manager";
  if (value === "admin") return "Administrator";
  return value || "Unknown";
}

function roleClass(value) {
  if (value === "admin") return "is-admin";
  if (value === "pm") return "is-pm";
  return "is-part-timer";
}

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
    const value = import.meta?.env?.VITE_API_BASE || import.meta?.env?.VITE_API_URL || "";
    return String(value || "").replace(/\/$/, "");
  } catch {
    return "";
  }
})();

function toAbsUrl(url) {
  if (!url) return "";
  const value = String(url);
  if (/^data:/i.test(value) || /^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return window.location.protocol + value;
  if (API_BASE_CLEAN) return API_BASE_CLEAN + (value.startsWith("/") ? value : `/${value}`);
  return value;
}

function pickFirstString(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function getVerifyPicUrl(user) {
  const absolute = pickFirstString(user, ["verificationPhotoUrlAbs", "verifyPhotoUrlAbs"]);
  if (absolute) return toAbsUrl(absolute);

  const relative = pickFirstString(user, [
    "verificationPhotoUrl",
    "verification_photo_url",
    "verifyPhotoUrl",
    "verify_photo_url",
    "verificationImageUrl",
    "verification_image_url",
    "verifyImageUrl",
    "verify_image_url",
    "verificationDataUrl",
    "verification_data_url",
    "verifyImageDataUrl",
    "verify_image_data_url",
  ]);

  return toAbsUrl(relative);
}

function getVerifyStatus(user) {
  const raw = pickFirstString(user, [
    "verificationStatus",
    "verifyStatus",
    "verification_status",
    "verify_status",
  ]);
  const normalized = String(raw || "").trim().toUpperCase();

  if (["PENDING", "APPROVED", "REJECTED"].includes(normalized)) return normalized;

  const legacy = String(raw || "").trim().toLowerCase();
  if (["verified", "verify", "approved", "approve"].includes(legacy)) return "APPROVED";
  if (["rejected", "reject", "declined"].includes(legacy)) return "REJECTED";
  if (["pending", "awaiting", "new"].includes(legacy)) return "PENDING";

  if (user?.verified === true) return "APPROVED";
  return "PENDING";
}

function fmtSubmitted(user) {
  const timestamp =
    user?.verificationSubmittedAt ||
    user?.verifySubmittedAt ||
    user?.submittedAt ||
    user?.createdAt ||
    user?.created_at ||
    user?.verifiedAt ||
    null;

  if (!timestamp) return "—";
  const date = dayjs(timestamp);
  return date.isValid() ? date.format("YYYY/MM/DD HH:mm") : "—";
}

function TabBtn({ active, onClick, children, badge }) {
  return (
    <button
      type="button"
      className={`admin-users-tab${active ? " is-active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <span>{children}</span>
      {Number.isFinite(badge) ? <span className="admin-users-tab__badge">{badge}</span> : null}
    </button>
  );
}

function ContactDetails({ user }) {
  const phone = user.phone ? `Phone: ${user.phone}` : "No phone";
  const discord = user.discord ? `Discord: ${user.discord}` : "No Discord";

  return (
    <div className="admin-users-contact">
      <div className="admin-users-contact__email">{user.email || "—"}</div>
      <div className="admin-users-contact__meta">
        <span>{phone}</span>
        <span className="admin-users-contact__dot" aria-hidden="true">
          •
        </span>
        <span>{discord}</span>
      </div>
    </div>
  );
}

export default function AdminUsers({ user }) {
  const [tab, setTab] = useState("manage");
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  const [editingId, setEditingId] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [edits, setEdits] = useState({});

  const [busyActionId, setBusyActionId] = useState(null);
  const [busyPicId, setBusyPicId] = useState(null);
  const [imgOpen, setImgOpen] = useState(null);
  const [imgLoadErr, setImgLoadErr] = useState("");

  const isAdmin = Boolean(user && user.role === "admin");

  async function refresh() {
    setLoading(true);
    try {
      const rows = await apiGet("/admin/users");
      setList(Array.isArray(rows) ? rows : []);
      setEditingId(null);
      setEdits({});
    } catch (error) {
      alert(error?.message || "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAdmin) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  const pendingCount = useMemo(
    () => list.filter((item) => getVerifyStatus(item) === "PENDING").length,
    [list]
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return list;

    return list.filter((item) => {
      const values = [
        item.email,
        item.username,
        item.name,
        item.phone,
        item.discord,
        item.role,
        item.grade,
        getVerifyStatus(item),
      ];

      return values.some((value) => String(value || "").toLowerCase().includes(term));
    });
  }, [q, list]);

  function getDraft(item) {
    const draft = edits[item.id] || {};
    return {
      role: draft.role ?? item.role,
      grade: draft.grade ?? (item.grade || "junior"),
    };
  }

  function setDraft(item, patch) {
    setEdits((current) => ({
      ...current,
      [item.id]: { ...(current[item.id] || {}), ...patch },
    }));
  }

  function isDirty(item) {
    const draft = getDraft(item);
    return draft.role !== item.role || draft.grade !== (item.grade || "junior");
  }

  function beginEdit(item) {
    setEditingId(item.id);
    setEdits((current) => ({
      ...current,
      [item.id]: {
        role: item.role,
        grade: item.grade || "junior",
      },
    }));
  }

  function cancelEdit(item) {
    setEditingId(null);
    setEdits((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
  }

  async function save(item) {
    const draft = getDraft(item);
    const body = {};

    if (draft.role !== item.role) body.role = draft.role;
    if (draft.grade !== (item.grade || "junior")) body.grade = draft.grade;

    if (!Object.keys(body).length) {
      cancelEdit(item);
      return;
    }

    try {
      setSavingId(item.id);
      const response = await apiPatch(`/admin/users/${item.id}`, body);
      const updated = response?.user || { ...item, ...body };

      setList((current) => current.map((entry) => (entry.id === item.id ? updated : entry)));
      setEditingId(null);
      setEdits((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    } catch (error) {
      const message = error?.message || "Save failed";
      if (String(message).includes("last_admin")) alert("Cannot remove the last administrator.");
      else alert(message);
    } finally {
      setSavingId(null);
    }
  }

  async function removeUser(item) {
    if (!item?.id) return;

    const label = item.email || item.username || item.name || "this user";
    const isSelf = item.id === user?.id;

    if (isSelf) {
      alert("You cannot remove your own account while you are signed in.");
      return;
    }

    const confirmed = window.confirm(
      `Remove ${label} from the platform?\n\n` +
        "This deletes the account, job applications, approvals, attendance records and notifications. This cannot be undone."
    );

    if (!confirmed) return;

    try {
      setDeletingId(item.id);
      await apiDelete(`/admin/users/${item.id}`);
      setList((current) => current.filter((entry) => entry.id !== item.id));
      setEdits((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      if (editingId === item.id) setEditingId(null);
    } catch (error) {
      const message = error?.message || "Remove user failed";

      if (String(message).includes("last_admin")) alert("Cannot remove the last administrator.");
      else if (String(message).includes("self_delete")) {
        alert("You cannot remove your own account while you are signed in.");
      } else if (String(message).includes("user_not_found")) {
        alert("User not found. Refreshing the list.");
        refresh();
      } else alert(message);
    } finally {
      setDeletingId(null);
    }
  }

  async function setVerification(item, nextStatus) {
    try {
      setBusyActionId(item.id);
      const body = {
        verificationStatus: nextStatus,
        verified: nextStatus === "APPROVED",
        verifyStatus: nextStatus,
      };

      const response = await apiPatch(`/admin/users/${item.id}`, body);
      const updated = response?.user || response || { ...item, ...body };
      setList((current) => current.map((entry) => (entry.id === item.id ? updated : entry)));
    } catch (error) {
      alert(error?.message || "Action failed");
    } finally {
      setBusyActionId(null);
    }
  }

  async function removeVerifyPic(item) {
    if (!item?.id) return;
    const label = item.email || item.name || "this user";
    if (!window.confirm(`Remove verification picture for ${label}?`)) return;

    try {
      setBusyPicId(item.id);
      await apiPost(`/admin/users/${item.id}/verification-photo/remove`, {});

      setList((current) =>
        current.map((entry) => {
          if (entry.id !== item.id) return entry;
          return {
            ...entry,
            verificationPhotoUrl: "",
            verificationPhotoUrlAbs: "",
            verifyPhotoUrl: "",
            verifyPhotoUrlAbs: "",
            verificationDataUrl: "",
          };
        })
      );

      setImgOpen((current) => (current?.userId === item.id ? null : current));
      setImgLoadErr("");
    } catch (error) {
      alert(error?.message || "Remove failed");
    } finally {
      setBusyPicId(null);
    }
  }

  if (!isAdmin) {
    return <div className="container">Not authorized.</div>;
  }

  const showManage = tab === "manage";
  const verificationRows = filtered.filter((item) => getVerifyStatus(item) !== "APPROVED");

  return (
    <div className="container admin-users-page">
      <section className="card admin-users-toolbar" aria-labelledby="admin-users-title">
        <div className="admin-users-toolbar__top">
          <div className="admin-users-heading">
            <h1 id="admin-users-title">Users</h1>
            <p>Manage account access and review new registrations.</p>
          </div>

          <div className="admin-users-search">
            <input
              type="search"
              aria-label="Search users"
              placeholder={
                showManage
                  ? "Search name, email, username, phone or Discord"
                  : 'Search applicant or status (for example, "pending")'
              }
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
            <button type="button" className="btn" onClick={refresh} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="admin-users-tabs" role="tablist" aria-label="User administration sections">
          <TabBtn active={showManage} onClick={() => setTab("manage")} badge={list.length}>
            User Management
          </TabBtn>
          <TabBtn active={!showManage} onClick={() => setTab("verify")} badge={pendingCount}>
            Verification
          </TabBtn>
        </div>
      </section>

      {loading ? (
        <div className="card admin-users-empty">Loading users…</div>
      ) : showManage ? (
        <section className="card admin-users-table-card" aria-label="User management">
          <div className="admin-users-table-wrap">
            <table className="admin-users-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Contact</th>
                  <th>Access</th>
                  <th className="admin-users-actions-heading">Actions</th>
                </tr>
              </thead>

              <tbody>
                {filtered.map((item) => {
                  const draft = getDraft(item);
                  const dirty = isDirty(item);
                  const isSelf = item.id === user?.id;
                  const isEditing = editingId === item.id;
                  const rowBusy = savingId === item.id || deletingId === item.id;

                  return (
                    <tr key={item.id}>
                      <td data-label="User">
                        <div className="admin-users-person">
                          <div className="admin-users-person__name-row">
                            <span className="admin-users-person__name">{item.name || "Unnamed user"}</span>
                            {isSelf ? <span className="admin-users-you-badge">You</span> : null}
                          </div>
                          <span className="admin-users-person__username">
                            {item.username ? `@${item.username}` : "No username"}
                          </span>
                        </div>
                      </td>

                      <td data-label="Contact">
                        <ContactDetails user={item} />
                      </td>

                      <td data-label="Access">
                        {isEditing ? (
                          <div className="admin-users-access-editor">
                            <label>
                              <span>Account role</span>
                              <select
                                value={draft.role}
                                onChange={(event) => setDraft(item, { role: event.target.value })}
                                disabled={rowBusy}
                              >
                                {ROLES.map((role) => (
                                  <option key={role} value={role}>
                                    {roleLabel(role)}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label>
                              <span>Staff grade</span>
                              <select
                                value={draft.grade}
                                onChange={(event) => setDraft(item, { grade: event.target.value })}
                                disabled={rowBusy}
                              >
                                {GRADES.map((grade) => (
                                  <option key={grade} value={grade}>
                                    {gradeLabel(grade)}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                        ) : (
                          <div className="admin-users-access-badges">
                            <span className={`admin-users-role-badge ${roleClass(item.role)}`}>
                              {roleLabel(item.role)}
                            </span>
                            <span className="admin-users-grade-badge">{gradeLabel(item.grade)}</span>
                          </div>
                        )}
                      </td>

                      <td data-label="Actions" className="admin-users-actions-cell">
                        {isEditing ? (
                          <div className="admin-users-row-actions">
                            <button
                              type="button"
                              className="btn primary"
                              onClick={() => save(item)}
                              disabled={rowBusy || !dirty}
                            >
                              {savingId === item.id ? "Saving…" : "Save"}
                            </button>
                            <button
                              type="button"
                              className="btn"
                              onClick={() => cancelEdit(item)}
                              disabled={rowBusy}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="admin-users-row-actions">
                            <button
                              type="button"
                              className="btn"
                              onClick={() => beginEdit(item)}
                              disabled={deletingId === item.id}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn admin-users-remove-btn"
                              onClick={() => removeUser(item)}
                              disabled={deletingId === item.id || isSelf}
                              title={isSelf ? "You cannot remove your own account" : "Remove user"}
                            >
                              {deletingId === item.id ? "Removing…" : "Remove"}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {!filtered.length ? (
                  <tr className="admin-users-empty-row">
                    <td colSpan={4}>No users match your search.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="card admin-users-table-card" aria-label="User verification">
          <div className="admin-users-table-wrap">
            <table className="admin-users-table admin-users-verification-table">
              <thead>
                <tr>
                  <th>Applicant</th>
                  <th>Submitted</th>
                  <th>Verification</th>
                  <th>Status</th>
                  <th className="admin-users-actions-heading">Actions</th>
                </tr>
              </thead>

              <tbody>
                {verificationRows.map((item) => {
                  const status = getVerifyStatus(item);
                  const picUrl = getVerifyPicUrl(item);
                  const hasPic = Boolean(picUrl);
                  const isBusy = busyActionId === item.id;

                  return (
                    <tr key={item.id}>
                      <td data-label="Applicant">
                        <div className="admin-users-person">
                          <span className="admin-users-person__name">{item.name || "Unnamed user"}</span>
                          <span className="admin-users-person__username">{item.email || "No email"}</span>
                          <div className="admin-users-contact__meta admin-users-contact__meta--stackable">
                            <span>{item.phone ? `Phone: ${item.phone}` : "No phone"}</span>
                            <span className="admin-users-contact__dot" aria-hidden="true">
                              •
                            </span>
                            <span>{item.discord ? `Discord: ${item.discord}` : "No Discord"}</span>
                          </div>
                        </div>
                      </td>

                      <td data-label="Submitted">
                        <span className="admin-users-submitted">{fmtSubmitted(item)}</span>
                      </td>

                      <td data-label="Verification">
                        {hasPic ? (
                          <div className="admin-users-photo-cell">
                            <button
                              type="button"
                              className="admin-users-photo-button"
                              onClick={() => {
                                setImgLoadErr("");
                                setImgOpen({ userId: item.id, email: item.email || "", url: picUrl });
                              }}
                              aria-label={`View verification picture for ${item.email || item.name || "user"}`}
                            >
                              <img
                                src={picUrl}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                onError={(event) => {
                                  event.currentTarget.style.display = "none";
                                }}
                              />
                            </button>
                            <button
                              type="button"
                              className="btn"
                              onClick={() => {
                                setImgLoadErr("");
                                setImgOpen({ userId: item.id, email: item.email || "", url: picUrl });
                              }}
                            >
                              View
                            </button>
                          </div>
                        ) : (
                          <span className="admin-users-muted">No picture</span>
                        )}
                      </td>

                      <td data-label="Status">
                        {status === "REJECTED" ? (
                          <span style={pillStyle("#fee2e2", "#fca5a5", "#991b1b")}>Rejected</span>
                        ) : (
                          <span style={pillStyle("#fff7ed", "#fdba74", "#9a3412")}>Pending</span>
                        )}
                      </td>

                      <td data-label="Actions" className="admin-users-actions-cell">
                        <div className="admin-users-row-actions">
                          <button
                            type="button"
                            className="btn primary"
                            disabled={isBusy || !hasPic}
                            title={!hasPic ? "User must upload a verification picture first" : ""}
                            onClick={() => setVerification(item, "APPROVED")}
                          >
                            {isBusy ? "Working…" : "Verify"}
                          </button>
                          <button
                            type="button"
                            className="btn"
                            disabled={isBusy}
                            onClick={() => setVerification(item, "REJECTED")}
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {!verificationRows.length ? (
                  <tr className="admin-users-empty-row">
                    <td colSpan={5}>No pending or rejected users.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <p className="admin-users-tip">
            Rejected accounts stay unverified. Users can upload a new picture from <code>Profile → Status</code>.
          </p>
        </section>
      )}

      {imgOpen ? (
        <div
          className="admin-users-image-backdrop"
          onClick={() => {
            setImgOpen(null);
            setImgLoadErr("");
          }}
        >
          <div className="card admin-users-image-modal" onClick={(event) => event.stopPropagation()}>
            <div className="admin-users-image-modal__header">
              <div>
                <div className="admin-users-image-modal__title">Verification Picture</div>
                <div className="admin-users-muted">{imgOpen.email || ""}</div>
              </div>

              <div className="admin-users-row-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setImgOpen(null);
                    setImgLoadErr("");
                  }}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="btn admin-users-remove-btn"
                  disabled={busyPicId === imgOpen.userId}
                  onClick={() => {
                    const matchingUser = list.find((entry) => entry.id === imgOpen.userId);
                    if (matchingUser) removeVerifyPic(matchingUser);
                  }}
                >
                  {busyPicId === imgOpen.userId ? "Removing…" : "Remove Picture"}
                </button>
              </div>
            </div>

            {imgLoadErr ? <div className="admin-users-image-error">{imgLoadErr}</div> : null}

            <img
              className="admin-users-image-preview"
              src={imgOpen.url}
              alt="Verification document"
              loading="lazy"
              decoding="async"
              onError={() => {
                setImgLoadErr(
                  "Image failed to load. The uploaded file may no longer be available on the server."
                );
              }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
