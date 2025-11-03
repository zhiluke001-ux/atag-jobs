// web/src/pages/Reset.jsx
import React, { useEffect, useState } from "react";
import { exchangeResetCode, updatePassword } from "../auth";

/**
 * This page is opened by the email link:  https://YOUR_DOMAIN/reset?code=...
 * Flow:
 *  1) Read ?code from URL
 *  2) exchangeResetCode(code)  -> creates a session
 *  3) Show form to set new password, then updatePassword(newPass)
 */
export default function Reset() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("init"); // init | ready | done | error
  const [err, setErr] = useState("");

  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");

  // Grab ?code on first render
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const c = u.searchParams.get("code");
      setCode(c || "");
      if (!c) {
        setStage("error");
        setErr("Missing or invalid reset link.");
        return;
      }
      (async () => {
        setBusy(true);
        setErr("");
        try {
          await exchangeResetCode(c);
          setStage("ready");
        } catch (e) {
          setStage("error");
          setErr(e?.message || "Invalid or expired reset link. Please request a new one.");
        } finally {
          setBusy(false);
        }
      })();
    } catch {
      setStage("error");
      setErr("Invalid URL.");
    }
  }, []);

  async function onSubmit(e) {
    e.preventDefault();
    if (pw1 !== pw2) {
      setErr("Passwords do not match.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await updatePassword(pw1);
      setStage("done");
    } catch (e) {
      setErr(e?.message || "Failed to update password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 520 }}>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 8 }}>Reset password</div>

        {stage === "init" && (
          <div style={{ color: "#6b7280" }}>
            Verifying your reset link…
          </div>
        )}

        {stage === "error" && (
          <>
            <div style={{ color: "crimson" }}>{err || "Something went wrong."}</div>
            <div style={{ marginTop: 10, fontSize: 13 }}>
              <a href="#/forgot">Request a new reset link</a>
            </div>
          </>
        )}

        {stage === "ready" && (
          <form onSubmit={onSubmit}>
            <div>New password</div>
            <input
              type="password"
              value={pw1}
              onChange={(e) => setPw1(e.target.value)}
              placeholder="Enter new password"
              style={{ width: "100%", marginTop: 6 }}
              minLength={6}
              required
              autoComplete="new-password"
            />

            <div style={{ marginTop: 10 }}>Confirm password</div>
            <input
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              placeholder="Re-enter new password"
              style={{ width: "100%", marginTop: 6 }}
              minLength={6}
              required
              autoComplete="new-password"
            />

            {err && (
              <div style={{ color: "crimson", marginTop: 8 }}>{err}</div>
            )}

            <div style={{ marginTop: 12 }}>
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? "Updating..." : "Set new password"}
              </button>
            </div>
          </form>
        )}

        {stage === "done" && (
          <>
            <div style={{ color: "#065f46", background: "#ecfdf5", border: "1px solid #d1fae5", padding: 10, borderRadius: 8 }}>
              Password updated successfully.
            </div>
            <div style={{ marginTop: 10, fontSize: 13 }}>
              <a href="#/login">Back to login</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
