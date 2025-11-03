import React, { useMemo, useState } from "react";
import { resetPassword } from "../auth";

function useResetToken() {
  // Works for hash router: #/reset?token=... or #/reset?code=...
  const search =
    (typeof window !== "undefined" && window.location.hash.split("?")[1]) ||
    (typeof window !== "undefined" && window.location.search.slice(1)) ||
    "";
  const qs = new URLSearchParams(search);
  return qs.get("token") || qs.get("code") || "";
}

export default function Reset() {
  const token = useResetToken();
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = useMemo(
    () => token && pw1.length >= 8 && pw1 === pw2,
    [token, pw1, pw2]
  );

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await resetPassword(token, pw1);
      setOk(true);
    } catch (e) {
      setError(e?.message || "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="container">
        <div className="card">
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
            Reset password
          </div>
          <div style={{ color: "crimson" }}>
            Missing token. Please use the link from your email.
          </div>
          <div style={{ marginTop: 10 }}>
            <a href="#/forgot">Back to forgot password</a>
          </div>
        </div>
      </div>
    );
  }

  if (ok) {
    return (
      <div className="container">
        <div className="card">
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
            Password reset successful 🎉
          </div>
          <div>You can now log in with your new password.</div>
          <div style={{ marginTop: 10 }}>
            <a className="btn primary" href="#/login">Go to Login</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <form className="card" onSubmit={onSubmit}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
          Set a new password
        </div>

        <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
          Token: <code>{token.slice(0, 6)}…{token.slice(-6)}</code>
        </div>

        <div>New password</div>
        <input
          value={pw1}
          onChange={(e) => setPw1(e.target.value)}
          type="password"
          placeholder="At least 8 characters"
          style={{ width: "100%", marginTop: 6 }}
          minLength={8}
          required
        />

        <div style={{ marginTop: 10 }}>Confirm new password</div>
        <input
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          type="password"
          placeholder="Re-enter password"
          style={{ width: "100%", marginTop: 6 }}
          minLength={8}
          required
        />

        {pw1 && pw2 && pw1 !== pw2 && (
          <div style={{ color: "crimson", marginTop: 8 }}>
            Passwords do not match.
          </div>
        )}

        {error && (
          <div style={{ color: "crimson", marginTop: 8 }}>{error}</div>
        )}

        <div style={{ marginTop: 12 }}>
          <button className="btn primary" type="submit" disabled={!canSubmit || busy}>
            {busy ? "Resetting…" : "Reset password"}
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 12 }}>
          <a href="#/login">Back to login</a>
        </div>
      </form>
    </div>
  );
}
