// web/src/pages/Register.jsx
import React, { useState } from "react";
import { registerUser } from "../auth";

export default function Register({ navigate, setUser }) {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [discord, setDiscord] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  // verification photo (data url)
  const [verificationDataUrl, setVerificationDataUrl] = useState("");

  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // ✅ new: success message (so user knows what happened)
  const [success, setSuccess] = useState(null);

  function onPickVerificationPhoto(e) {
    setError(null);
    setSuccess(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const okTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (!okTypes.includes(file.type)) {
      setError("Only PNG/JPG/WEBP images are allowed.");
      return;
    }

    const MAX = 2 * 1024 * 1024; // 2MB
    if (file.size > MAX) {
      setError("Image too large (max 2MB).");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setVerificationDataUrl(String(reader.result || ""));
    reader.readAsDataURL(file);
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!email || !username || !name || !discord || !phone || !password || !confirm) {
      setError("All fields are required.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (!verificationDataUrl) {
      setError("Verification photo is required.");
      return;
    }

    setBusy(true);
    try {
      // ✅ send multiple keys so backend schema mismatch still works
      const res = await registerUser({
        email,
        username,
        name,
        discord,
        phone,
        password,

        // common variants (backend can pick any)
        verificationDataUrl,
        verifyImageDataUrl: verificationDataUrl,
        verifyImageUrl: verificationDataUrl,
      });

      // ✅ IMPORTANT CHANGE:
      // Do NOT set user / do NOT log them in if they are unverified.
      // Your backend register always creates verified=false, so treat as pending.

      // If you want to be extra safe:
      const createdUser = res?.user || res || {};
      const isVerified =
        createdUser?.verified === true ||
        String(createdUser?.verificationStatus || "").toUpperCase() === "APPROVED";

      if (isVerified) {
        // rare case: if you later change backend to auto-approve
        if (setUser) setUser(createdUser);
        navigate("#/");
        return;
      }

      // ✅ show message then redirect back to homepage (or login)
      setSuccess(
        "Account created! Your registration is pending admin approval. Please log in again after you are approved."
      );

      // clear local form states (optional)
      setPassword("");
      setConfirm("");
      setVerificationDataUrl("");

      // redirect after a short moment (no async/background promise; just immediate is fine)
      // choose ONE:
      // navigate("#/");      // go homepage
      // navigate("#/login"); // go login page (recommended)
      navigate("#/"); // per your request: go back to homepage
    } catch (e2) {
      const msg = e2?.data?.error || e2?.message || String(e2) || "Registration failed.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <form className="card" onSubmit={onSubmit}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
          Create account
        </div>

        <div>Email</div>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          style={{ width: "100%", marginTop: 6 }}
          type="email"
          required
        />

        <div style={{ marginTop: 10 }}>Username</div>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="your handle"
          style={{ width: "100%", marginTop: 6 }}
          required
        />

        <div style={{ marginTop: 10 }}>Full Name</div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          style={{ width: "100%", marginTop: 6 }}
          required
        />

        <div style={{ marginTop: 10 }}>Discord</div>
        <input
          value={discord}
          onChange={(e) => setDiscord(e.target.value)}
          placeholder="e.g. yourhandle"
          style={{ width: "100%", marginTop: 6 }}
          required
        />

        <div style={{ marginTop: 10 }}>Phone number</div>
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="e.g. +60 12-345 6789"
          style={{ width: "100%", marginTop: 6 }}
          inputMode="tel"
          required
        />

        <div style={{ marginTop: 10 }}>Password</div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          style={{ width: "100%", marginTop: 6 }}
          required
        />

        <div style={{ marginTop: 10 }}>Confirm Password</div>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="••••••••"
          style={{ width: "100%", marginTop: 6 }}
          required
        />

        <div style={{ marginTop: 10 }}>Verification Photo</div>
        <input
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp,image/*"
          onChange={onPickVerificationPhoto}
          style={{ width: "100%", marginTop: 6 }}
          required
        />

        {verificationDataUrl && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
              Preview
            </div>
            <img
              src={verificationDataUrl}
              alt="verification preview"
              style={{
                width: 180,
                maxWidth: "100%",
                borderRadius: 10,
                border: "1px solid #eee",
              }}
            />
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn"
                onClick={() => setVerificationDataUrl("")}
              >
                Remove photo
              </button>
            </div>
          </div>
        )}

        {error && <div style={{ color: "crimson", marginTop: 8 }}>{error}</div>}

        {success && (
          <div
            style={{
              marginTop: 10,
              background: "#ecfdf5",
              border: "1px solid #a7f3d0",
              color: "#065f46",
              padding: 10,
              borderRadius: 10,
              fontSize: 13,
              lineHeight: 1.35,
              whiteSpace: "pre-line",
            }}
          >
            {success}
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Creating..." : "Create account"}
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 12 }}>
          Already have an account? <a href="#/login">Log in</a>
        </div>
      </form>
    </div>
  );
}
