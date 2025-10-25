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

  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);

    // basic validations
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

    setBusy(true);
    try {
      // No role sent — backend should default to "junior".
      const u = await registerUser({
        email,
        username,
        name,
        discord,
        phone,
        password,
      });
      setUser(u);
      navigate("#/"); // landing route
    } catch (e) {
      const msg = e?.message || String(e) || "Registration failed.";
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

        {error && (
          <div style={{ color: "crimson", marginTop: 8 }}>{error}</div>
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
