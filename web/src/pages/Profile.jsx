// web/src/pages/Profile.jsx
import React, { useEffect, useState } from "react";
import { fetchCurrentUser, updateProfile, changePassword, uploadAvatarDataUrl } from "../auth";

export default function Profile() {
  const [me, setMe] = useState(null);

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [discord, setDiscord] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [avatarPreview, setAvatarPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);         // { type: "ok"|"err", msg: string }

  function showToast(msg, type = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2200);
  }

  useEffect(() => {
    (async () => {
      const res = await fetchCurrentUser();
      if (res?.user) {
        setMe(res.user);
        setEmail(res.user.email || "");
        setUsername(res.user.username || "");
        setName(res.user.name || "");
        setPhone(res.user.phone || "");
        setDiscord(res.user.discord || "");
      }
    })();
  }, []);

  async function onSaveProfile(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const updated = await updateProfile({ email, username, name, phone, discord });
      setMe(updated);
      showToast("Profile updated ✅", "ok");
    } catch (e) {
      showToast(e?.message || "Update failed", "err");
    } finally {
      setBusy(false);
    }
  }

  async function onChangePassword(e) {
    e.preventDefault();
    if (newPassword !== confirm) {
      showToast("Passwords do not match", "err");
      return;
    }
    if ((newPassword || "").length < 6) {
      showToast("Password too short (min 6)", "err");
      return;
    }
    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
      showToast("Password changed ✅", "ok");
    } catch (e) {
      showToast(e?.message || "Password change failed", "err");
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
    const okTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (!okTypes.includes(file.type)) {
      showToast("Only PNG/JPG/WEBP", "err");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast("Max 2MB", "err");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setAvatarPreview(dataUrl);
      const resp = await uploadAvatarDataUrl(dataUrl);
      setMe((m) => ({ ...m, avatarUrl: resp?.avatarUrl || m?.avatarUrl }));
      showToast("Avatar updated ✅", "ok");
    } catch (e2) {
      showToast(e2?.message || "Avatar upload failed", "err");
    }
  }

  return (
    <div className="container" style={{ maxWidth: 900 }}>
      {/* Avatar + headline */}
      <div className="card" style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <div style={{ position: "relative", width: 96, height: 96 }}>
          <img
            src={avatarPreview || me?.avatarUrl || "https://api.dicebear.com/7.x/initials/svg?seed=" + encodeURIComponent(me?.name || me?.email || "U")}
            alt="avatar"
            style={{
              width: 96,
              height: 96,
              borderRadius: "9999px",
              objectFit: "cover",
              border: "2px solid #e5e7eb"
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
              padding: "6px 10px"
            }}
          >
            Change
          </label>
          <input id="avatarPick" type="file" accept="image/*" onChange={onPickAvatar} style={{ display: "none" }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>My Profile</div>
          <div style={{ color: "#666", fontSize: 12 }}>
            Role: {me?.role} • Grade: {me?.grade}
          </div>
        </div>
      </div>

      {/* Profile form */}
      <form className="card" onSubmit={onSaveProfile}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Account details</div>

        <div className="grid grid-2">
          <div>
            <div>Email</div>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
          </div>
          <div>
            <div>Username</div>
            <input value={username} onChange={(e) => setUsername(e.target.value)} required />
          </div>
          <div>
            <div>Full name</div>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <div>Phone</div>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          </div>
          <div>
            <div>Discord</div>
            <input value={discord} onChange={(e) => setDiscord(e.target.value)} />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>

      {/* Password form */}
      <form className="card" onSubmit={onChangePassword}>
        <div style={{ fontWeight: 600, marginBottom: 10 }}>Change password</div>
        <div className="grid grid-2">
          <div>
            <div>Current password</div>
            <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
          </div>
          <div>
            <div>New password</div>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
          </div>
          <div>
            <div>Confirm new password</div>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Updating..." : "Update password"}
          </button>
        </div>
      </form>

      {/* Center pop-up toast */}
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
            boxShadow: "0 8px 30px rgba(0,0,0,0.25)"
          }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
