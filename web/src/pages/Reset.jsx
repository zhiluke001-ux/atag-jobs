// src/pages/Reset.jsx
import React, { useEffect, useState } from "react";
import { getResetTokenFromLocation, resetPassword } from "../auth";

export default function Reset() {
  const [token, setToken] = useState("");
  const [manualMode, setManualMode] = useState(false);

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [okMsg, setOkMsg] = useState(null);

  useEffect(() => {
    const t = getResetTokenFromLocation();
    if (t) setToken(t);
  }, []);

  function validate() {
    if (!token) return "Missing or invalid reset token. Open the email link again or paste the token manually.";
    if (!pw) return "Please enter a new password.";
    if (pw.length < 8) return "Password must be at least 8 characters.";
    if (pw !== pw2) return "Passwords do not match.";
    return null;
    // Add more rules as you like (numbers, symbols, etc.)
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setOkMsg(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setBusy(true);
    try {
      const res = await resetPassword(token, pw);
      setOkMsg(res?.message || "Password updated. You can now sign in.");
    } catch (e2) {
      setError(e2?.message || "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  async function pasteToken() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setToken(t.trim());
    } catch {
      setError("Could not read from clipboard. Paste manually.");
    }
  }

  return (
    <div className="container">
      <form className="card" onSubmit={onSubmit}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
          Reset password
        </div>

        {/* Token area */}
        {!manualMode && token ? (
          <div style={{ marginBottom: 8, fontSize: 13, color: "#374151" }}>
            Token detected from link: <code style={{ wordBreak: "break-all" }}>{token}</code>
            <div>
              <button
                type="button"
                className="btn"
                style={{ marginTop: 6 }}
                onClick={() => setManualMode(true)}
              >
                Use a different token
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 10 }}>
            <div style={{ marginBottom: 6 }}>Reset token</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste token from email link"
                style={{ width: "100%" }}
                required
              />
              <button className="btn" type="button" onClick={pasteToken}>
                Paste
              </button>
            </div>
            {!manualMode && !token && (
              <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
                No token in the URL. You can paste it here.
              </div>
            )}
          </div>
        )}

        {/* New password */}
        <div style={{ marginTop: 6 }}>New password</div>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="At least 8 characters"
          style={{ width: "100%", marginTop: 6 }}
          required
        />

        {/* Confirm password */}
        <div style={{ marginTop: 10 }}>Confirm new password</div>
        <input
          type="password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          placeholder="Re-enter new password"
          style={{ width: "100%", marginTop: 6 }}
          required
        />

        {/* Messages */}
        {error && (
          <div style={{ color: "crimson", marginTop: 10 }}>{error}</div>
        )}
        {okMsg && (
          <div className="notice" style={{ marginTop: 10, color: "#065f46" }}>
            {okMsg}
          </div>
        )}

        {/* Actions */}
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Updating..." : "Update password"}
          </button>
          <a className="btn" href="#/login">Back to login</a>
        </div>

        <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
          If you opened this page directly, ensure your link looks like
          <code> #/reset?token=… </code> or <code> #/reset?code=…</code>.
        </div>
      </form>
    </div>
  );
}
