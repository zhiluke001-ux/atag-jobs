// web/src/pages/Profile.jsx
import React, { useEffect, useState } from "react";
import {
  fetchCurrentUser,
  updateProfile,
  changePassword,
  uploadAvatarDataUrl,
} from "../auth";

function Row({ label, value, onEdit }) {
  return (
    <div
      role="button"
      onClick={onEdit}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "14px 16px",
        borderTop: "1px solid #eee",
        cursor: "pointer",
      }}
    >
      <div style={{ width: 160, color: "#555" }}>{label}</div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          color: "#111",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value || "—"}
      </div>
      <div style={{ marginLeft: 10, color: "#666" }}>›</div>
    </div>
  );
}

function Modal({ title, children, onClose, onSave, saving }) {
  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" onClick={onClose}>
        <div
          className="modal-card"
          style={{ maxWidth: 520 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">{title}</div>
          <div className="modal-body">{children}</div>
          <div className="modal-footer" style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" onClick={onSave} disabled={!!saving}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default function Profile() {
  const [me, setMe] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [loadErr, setLoadErr] = useState("");

  // modal state
  const [editing, setEditing] = useState(null); // { field, title, value }
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "" });

  function showToast(msg, type = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2200);
  }

  useEffect(() => {
    (async () => {
      const u = await fetchCurrentUser();
      if (!u) {
        setLoadErr("You are not logged in (or your session expired). Please log in again.");
        return;
      }
      setMe(u);
    })();
  }, []);

  if (loadErr) {
    return (
      <div className="container">
        <div className="card" style={{ border: "1px solid #fee2e2", color: "#b91c1c" }}>
          {loadErr}
          <div style={{ marginTop: 10 }}>
            <a className="btn primary" href="#/login">Go to Login</a>
          </div>
        </div>
      </div>
    );
  }

  if (!me) return <div className="container">Loading...</div>;

  async function onPickAvatar(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const okTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (!okTypes.includes(file.type)) {
      showToast("Only PNG/JPG/WEBP", "err");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast("Max 2MB", "err");
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const resp = await uploadAvatarDataUrl(String(reader.result));
        const newUrl = resp?.avatarUrl || resp?.user?.avatarUrl;
        if (newUrl) setMe((m) => ({ ...m, avatarUrl: newUrl }));
        showToast("Avatar updated ✅");
      } catch (e2) {
        showToast(e2?.message || "Avatar upload failed", "err");
      }
    };
    reader.readAsDataURL(file);
  }

  async function saveField() {
    if (!editing) return;
    const { field, value } = editing;
    setBusy(true);
    try {
      const updatedUser = await updateProfile({ [field]: value });
      setMe(updatedUser);
      setEditing(null);
      showToast("Saved ✅");
    } catch (e) {
      showToast(e?.message || "Update failed", "err");
    } finally {
      setBusy(false);
    }
  }

  async function savePassword() {
    if (pwd.next !== pwd.confirm) {
      showToast("Passwords do not match", "err");
      return;
    }
    if ((pwd.next || "").length < 6) {
      showToast("Password too short (min 6)", "err");
      return;
    }
    setBusy(true);
    try {
      await changePassword(pwd.current, pwd.next);
      setPwd({ current: "", next: "", confirm: "" });
      setPwdOpen(false);
      showToast("Password changed ✅");
    } catch (e) {
      showToast(e?.message || "Password change failed", "err");
    } finally {
      setBusy(false);
    }
  }

  const avatarSrc =
    me?.avatarUrl ||
    "https://api.dicebear.com/7.x/initials/svg?seed=" +
      encodeURIComponent(me?.name || me?.email || "U");

  return (
    <div className="container" style={{ maxWidth: 960 }}>
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
            style={{
              position: "absolute",
              bottom: -6,
              right: -6,
              fontSize: 12,
              padding: "6px 10px",
            }}
          >
            Change
          </label>
          <input
            id="avatarPick"
            type="file"
            accept="image/*"
            onChange={onPickAvatar}
            style={{ display: "none" }}
          />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>My Profile</div>
          <div style={{ color: "#666", fontSize: 12 }}>
            Role: {me.role} • Grade: {me.grade}
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ fontWeight: 600, margin: "2px 0 8px 0" }}>Account</div>
        <Row label="Email" value={me.email} onEdit={() => setEditing({ field: "email", title: "Email", value: me.email })} />
        <Row label="Username" value={me.username} onEdit={() => setEditing({ field: "username", title: "Username", value: me.username })} />
        <Row label="Full name" value={me.name} onEdit={() => setEditing({ field: "name", title: "Full name", value: me.name })} />
        <Row label="Phone" value={me.phone} onEdit={() => setEditing({ field: "phone", title: "Phone", value: me.phone })} />
        <Row label="Discord" value={me.discord} onEdit={() => setEditing({ field: "discord", title: "Discord", value: me.discord })} />
      </div>

      <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 600 }}>Security</div>
        <button className="btn" onClick={() => setPwdOpen(true)}>Change password</button>
      </div>

      {editing && (
        <Modal title={editing.title} onClose={() => setEditing(null)} onSave={saveField} saving={busy}>
          <input
            autoFocus
            type={editing.field === "email" ? "email" : "text"}
            value={editing.value ?? ""}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            style={{ width: "100%" }}
          />
          <div style={{ marginTop: 10, color: "#666", fontSize: 12 }}>
            This will update your account {editing.title.toLowerCase()}.
          </div>
        </Modal>
      )}

      {pwdOpen && (
        <Modal title="Change password" onClose={() => setPwdOpen(false)} onSave={savePassword} saving={busy}>
          <div className="grid grid-1" style={{ gap: 10 }}>
            <div>
              <div>Current password</div>
              <input type="password" value={pwd.current} onChange={(e) => setPwd({ ...pwd, current: e.target.value })} />
            </div>
            <div>
              <div>New password</div>
              <input type="password" value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} />
            </div>
            <div>
              <div>Confirm new password</div>
              <input type="password" value={pwd.confirm} onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} />
            </div>
          </div>
        </Modal>
      )}

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
