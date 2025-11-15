// web/src/pages/Profile.jsx
import React, { useEffect, useRef, useState } from "react";
import {
  fetchCurrentUser,
  updateProfile,
  changePassword,
  uploadAvatarDataUrl,
} from "../auth";

/* ---------------- Reusable inline-edit row ---------------- */
function InlineRow({ label, name, type = "text", value, onSave, disabled }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const inputRef = useRef(null);

  useEffect(() => setDraft(value ?? ""), [value]);
  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  function onKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      doSave();
    }
    if (e.key === "Escape") {
      setDraft(value ?? "");
      setEditing(false);
    }
  }

  async function doSave() {
    if (!editing) return;
    setEditing(false);
    const trimmed = typeof draft === "string" ? draft.trim() : draft;
    if (trimmed === (value ?? "")) return;
    await onSave(name, trimmed);
  }

  return (
    <div className="row-line" style={styles.row}>
      <div style={styles.label}>{label}</div>
      {!editing ? (
        <div style={styles.value}>
          <span>{value || <span style={styles.muted}>—</span>}</span>
          {!disabled && (
            <button
              className="btn link"
              type="button"
              onClick={() => setEditing(true)}
              style={styles.editBtn}
            >
              Edit
            </button>
          )}
        </div>
      ) : (
        <div style={styles.value}>
          <input
            ref={inputRef}
            type={type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={doSave}
            style={styles.input}
          />
        </div>
      )}
    </div>
  );
}

/* ---------------- Profile page ---------------- */
export default function Profile() {
  const [me, setMe] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);

  // password section state
  const [showSecurity, setShowSecurity] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null); // {type:'ok'|'err', msg:string}

  function notify(msg, type = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2000);
  }

  useEffect(() => {
    (async () => {
      const res = await fetchCurrentUser();
      // res is already the user object (but support {user:...} just in case)
      const u = res?.user || res;
      if (u) setMe(u);
    })();
  }, []);

  async function saveField(field, val) {
    if (!me) return;
    setBusy(true);
    try {
      const updated = await updateProfile({ [field]: val });
      setMe(updated);
      notify("Saved ✅", "ok");
    } catch (e) {
      notify(e?.message || "Update failed", "err");
    } finally {
      setBusy(false);
    }
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function onPickAvatar(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const ok = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (!ok.includes(file.type)) {
      notify("Only PNG/JPG/WEBP", "err");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      notify("Max 2MB", "err");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setAvatarPreview(dataUrl); // instant preview
      const newUrl = await uploadAvatarDataUrl(dataUrl); // <- returns URL string
      setMe((m) => ({ ...m, avatarUrl: newUrl }));
      notify("Avatar updated ✅", "ok");
    } catch (err) {
      notify(err?.message || "Avatar upload failed", "err");
      setAvatarPreview(null);
    } finally {
      // clear the input value so the same file can be reselected if needed
      e.target.value = "";
    }
  }

  async function onChangePassword(e) {
    e.preventDefault();
    if (newPw.length < 6) {
      notify("Password too short (min 6)", "err");
      return;
    }
    if (newPw !== newPw2) {
      notify("Passwords do not match", "err");
      return;
    }
    setBusy(true);
    try {
      await changePassword(curPw, newPw);
      setCurPw("");
      setNewPw("");
      setNewPw2("");
      notify("Password changed ✅", "ok");
    } catch (e) {
      notify(e?.message || "Password change failed", "err");
    } finally {
      setBusy(false);
    }
  }

  const avatarSrc =
    avatarPreview ||
    me?.avatarUrl ||
    "https://api.dicebear.com/7.x/initials/svg?seed=" +
      encodeURIComponent(me?.name || me?.email || "U");

  return (
    <div className="container" style={{ maxWidth: 900 }}>
      {/* Header card */}
      <div className="card" style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <div style={{ position: "relative", width: 96, height: 96 }}>
          <img
            src={avatarSrc}
            alt="avatar"
            style={{
              width: 96,
              height: 96,
              borderRadius: "9999px",
              objectFit: "cover",
              border: "2px solid #e5e7eb",
            }}
          />
          <label
            htmlFor="avatarPick"
            className="btn"
            style={{ position: "absolute", bottom: -6, right: -6, fontSize: 12, padding: "6px 10px" }}
          >
            Change
          </label>
          <input id="avatarPick" type="file" accept="image/*" onChange={onPickAvatar} style={{ display: "none" }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>My Profile</div>
          <div style={{ color: "#666", fontSize: 12 }}>
            Role: {me?.role || "—"} • Grade: {me?.grade || "—"}
          </div>
        </div>
      </div>

      {/* Account details (view-first, click-to-edit) */}
      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Account</div>
        <InlineRow
          label="Email"
          name="email"
          type="email"
          value={me?.email}
          onSave={saveField}
        />
        <InlineRow
          label="Username"
          name="username"
          value={me?.username}
          onSave={saveField}
        />
        <InlineRow
          label="Full name"
          name="name"
          value={me?.name}
          onSave={saveField}
        />
        <InlineRow
          label="Phone"
          name="phone"
          type="tel"
          value={me?.phone}
          onSave={saveField}
        />
        <InlineRow
          label="Discord"
          name="discord"
          value={me?.discord}
          onSave={saveField}
        />
        {busy && <div style={styles.busyNote}>Saving…</div>}
      </div>

      {/* Security (collapsible) */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 600 }}>Security</div>
          <button className="btn" type="button" onClick={() => setShowSecurity((s) => !s)}>
            {showSecurity ? "Hide" : "Change password"}
          </button>
        </div>
        {showSecurity && (
          <form onSubmit={onChangePassword} style={{ marginTop: 12 }}>
            <div className="grid grid-2">
              <div>
                <div>Current password</div>
                <input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} required />
              </div>
              <div>
                <div>New password</div>
                <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required />
              </div>
              <div>
                <div>Confirm new password</div>
                <input type="password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} required />
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="btn" type="submit" disabled={busy}>
                {busy ? "Updating..." : "Update password"}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            background: toast.type === "ok" ? "rgba(16,185,129,0.95)" : "rgba(239,68,68,0.95)",
            color: "white",
            padding: "12px 16px",
            borderRadius: 12,
            zIndex: 9999,
            fontWeight: 600,
            boxShadow: "0 8px 30px rgba(0,0,0,0.25)",
          }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

/* ---------------- tiny inline styles (uses your existing .card/.btn) ---------------- */
const styles = {
  row: {
    display: "flex",
    alignItems: "center",
    padding: "10px 0",
    borderTop: "1px solid #eee",
  },
  label: { width: 160, fontSize: 13, color: "#666" },
  value: { flex: 1, display: "flex", alignItems: "center", gap: 8 },
  muted: { color: "#9ca3af" },
  input: { width: "100%" },
  editBtn: { marginLeft: "auto" },
  busyNote: { color: "#888", fontSize: 12, marginTop: 8 },
};
