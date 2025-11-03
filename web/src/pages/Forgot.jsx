// web/src/pages/Forgot.jsx
import React, { useState } from "react";
import { forgotPassword } from "../auth";

export default function Forgot() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      const res = await forgotPassword(email);
      setSent(res); // { ok: true, redirectToUsed }
    } catch (e) {
      setError(e?.message || "Request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <form className="card" onSubmit={onSubmit}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
          Forgot password
        </div>

        <div>Email</div>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          style={{ width: "100%", marginTop: 6 }}
          required
          type="email"
          autoComplete="email"
        />

        {error && (
          <div style={{ color: "crimson", marginTop: 8 }}>{error}</div>
        )}

        <div style={{ marginTop: 10 }}>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Sending..." : "Send reset link"}
          </button>
        </div>

        {sent?.ok && (
          <div className="notice" style={{ marginTop: 12, fontSize: 13 }}>
            If that email exists, we’ve sent a reset link. Check your inbox (and spam).
            <div style={{ marginTop: 8, opacity: 0.8 }}>
              {/* Supabase doesn't return dev token/link. We show the redirect base for verification. */}
              <div>
                <b>Redirect URL used:</b>{" "}
                <code>{sent.redirectToUsed}</code>
              </div>
            </div>
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: 12 }}>
          <a href="#/login">Back to login</a>
        </div>
      </form>
    </div>
  );
}
