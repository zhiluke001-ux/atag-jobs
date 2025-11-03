import React, { useEffect, useState } from "react";
import { exchangeResetCode, updatePassword } from "../auth";

export default function Reset() {
  const [phase, setPhase] = useState("checking"); // checking | ready | done | error
  const [error, setError] = useState(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  // Read ?code= from URL, exchange it for a session
  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        if (!code) throw new Error("Missing reset code in URL.");
        await exchangeResetCode(code); // sets a session
        setPhase("ready");
      } catch (e) {
        setError(e?.message || "Invalid or expired reset link.");
        setPhase("error");
      }
    })();
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    if (pw.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (pw !== pw2) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updatePassword(pw);
      setPhase("done");
    } catch (e) {
      setError(e?.message || "Failed to update password.");
    } finally {
      setBusy(false);
    }
  }

  if (phase === "checking") {
    return (
      <div className="container">
        <div className="card">Verifying reset link…</div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="container">
        <div className="card">
          <div style={{ color: "crimson", marginBottom: 8 }}>{error || "Reset link invalid."}</div>
          <a className="btn" href="#/forgot">Request a new reset link</a>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="container">
        <div className="card">
          <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Password updated</div>
          <div style={{ marginBottom: 10 }}>You can now log in with your new password.</div>
          <a className="btn primary" href="#/login">Back to login</a>
        </div>
      </div>
    );
  }

  // phase === "ready"
  return (
    <div className="container">
      <form className="card" onSubmit={onSubmit}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
          Set a new password
        </div>

        <div>New password</div>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Enter new password"
          style={{ width: "100%", marginTop: 6 }}
          required
        />

        <div style={{ marginTop: 10 }}>Confirm password</div>
        <input
          type="password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          placeholder="Re-enter new password"
          style={{ width: "100%", marginTop: 6 }}
          required
        />

        {error && <div style={{ color: "crimson", marginTop: 8 }}>{error}</div>}

        <div style={{ marginTop: 10 }}>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Saving..." : "Save new password"}
          </button>
        </div>
      </form>
    </div>
  );
}
