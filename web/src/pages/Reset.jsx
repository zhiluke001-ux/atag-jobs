// web/src/pages/Reset.jsx
import React, { useState, useMemo } from "react";
import { resetPassword } from "../auth";

export default function Reset() {
  // get token from hash: #/reset?token=abc
  const token = useMemo(() => {
    const hash = window.location.hash || "";
    const q = hash.split("?")[1] || "";
    const params = new URLSearchParams(q);
    return params.get("token") || params.get("code") || "";
  }, []);

  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (!token) {
      setError("Missing token. Please use the link from your email.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err?.message || "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <form className="card" onSubmit={onSubmit}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
          Reset password
        </div>

        {!token && (
          <div style={{ color: "crimson", marginBottom: 8 }}>
            Invalid or missing token.
          </div>
        )}

        {!done ? (
          <>
            <div>New password</div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{ width: "100%", marginTop: 6 }}
              required
            />

            {error && (
              <div style={{ color: "crimson", marginTop: 8 }}>{error}</div>
            )}

            <div style={{ marginTop: 10 }}>
              <button className="btn primary" type="submit" disabled={busy || !token}>
                {busy ? "Saving..." : "Reset password"}
              </button>
            </div>
          </>
        ) : (
          <div className="notice" style={{ marginTop: 12 }}>
            Password updated. You can now{" "}
            <a href="#/login">log in with your new password</a>.
          </div>
        )}

        <div style={{ marginTop: 10, fontSize: 12 }}>
          <a href="#/login">Back to login</a>
        </div>
      </form>
    </div>
  );
}
