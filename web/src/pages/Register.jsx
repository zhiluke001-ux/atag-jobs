import React, { useState } from "react";
import { registerUser } from "../auth";

export default function Register({ navigate }) {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [discord, setDiscord] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [verificationDataUrl, setVerificationDataUrl] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  function onPickFile(e) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file.");
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

    if (!email || !username || !name || !discord || !phone || !password || !confirm) {
      setError("All fields are required.");
      return;
    }
    if (!verificationDataUrl) {
      setError("Verification photo is required.");
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

    setBusy(true);
    try {
      await registerUser({
        email,
        username,
        name,
        discord,
        phone,
        password,
        verificationDataUrl,
      });

      setDone(true);
      // go login page (show pending msg)
      navigate("#/login?pending=1");
    } catch (e) {
      setError(e?.message || "Registration failed.");
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

        {/* ... your existing fields ... */}

        <div style={{ marginTop: 10 }}>Verification Photo (from WhatsApp)</div>
        <input
          type="file"
          accept="image/*"
          onChange={onPickFile}
          required
          style={{ width: "100%", marginTop: 6 }}
        />

        {verificationDataUrl && (
          <img
            alt="verification preview"
            src={verificationDataUrl}
            style={{ marginTop: 8, width: 160, borderRadius: 8, border: "1px solid #eee" }}
          />
        )}

        {error && <div style={{ color: "crimson", marginTop: 8 }}>{error}</div>}

        <div style={{ marginTop: 12 }}>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Submitting..." : "Submit for verification"}
          </button>
        </div>

        {done && (
          <div style={{ marginTop: 10, color: "#1a7f37" }}>
            Submitted! Pending admin verification.
          </div>
        )}
      </form>
    </div>
  );
}
    
