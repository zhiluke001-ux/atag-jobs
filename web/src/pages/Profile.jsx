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
