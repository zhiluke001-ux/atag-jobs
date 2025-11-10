// web/src/pages/Login.jsx
import React, { useState, useEffect } from "react";
import {
  login,
  getToken,
  fetchCurrentUser,
  logout,
} from "../auth";

export default function Login({ navigate, setUser }) {
  const [identifier, setIdentifier] = useState(""); // email or username
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [checkingToken, setCheckingToken] = useState(true);

  // on mount: only redirect if the token is actually valid
  useEffect(() => {
    let cancelled = false;

    async function checkExistingToken() {
      const token = getToken();
      if (!token) {
        setCheckingToken(false);
        return;
      }

      // try to verify token with backend
      const me = await fetchCurrentUser();
      if (cancelled) return;

      if (me) {
        // token is good → set user and go home
        if (setUser) setUser(me);
        window.location.replace("#/");
      } else {
        // token in localStorage was bad/stale → clear it so user can log in
        logout();
        setCheckingToken(false);
      }
    }

    checkExistingToken();

    return () => {
      cancelled = true;
    };
  }, [setUser]);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const u = await login(identifier, password);
      if (setUser) setUser(u);

      // go to home and REPLACE the current entry so Back won't return to /login
      window.location.replace("#/");
      // or: if (navigate) navigate("#/");
    } catch (e) {
      console.error("login failed:", e);
      // show server message if available
      const msg =
        e?.payload?.error ||
        e?.message ||
        "Login failed. Check your email/username and password.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  // while we're checking the old token, don't flash the form
  if (checkingToken) {
    return (
      <div className="container">
        <div className="card">Checking session…</div>
      </div>
    );
  }

  return (
    <div className="container">
      <form className="card" onSubmit={onSubmit}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
          Log in
        </div>

        <div>Email or Username</div>
        <input
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="Email or Username"
          style={{ width: "100%", marginTop: 6 }}
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

        {error && (
          <div style={{ color: "crimson", marginTop: 8 }}>{error}</div>
        )}

        <div style={{ marginTop: 10 }}>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Signing in..." : "Log in"}
          </button>
        </div>

        <div style={{ marginTop: 10, fontSize: 12 }}>
          <a href="#/forgot">Forgot password?</a> &nbsp;•&nbsp;{" "}
          <a href="#/register">Create an account</a>
        </div>
      </form>
    </div>
  );
}
