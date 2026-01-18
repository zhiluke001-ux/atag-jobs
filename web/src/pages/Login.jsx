// web/src/pages/Login.jsx
import React, { useState, useEffect } from "react";
import { login, getToken, fetchCurrentUser, logout } from "../auth";

function isPendingVerificationError(e) {
  const data = e?.data || {};
  const code = data?.code || e?.code || null;
  const err = data?.error || data?.message || "";
  const msg = e?.message || "";

  return (
    code === "PENDING_VERIFICATION" ||
    String(err).toLowerCase() === "pending_verification" ||
    String(msg).toLowerCase().includes("pending_verification") ||
    String(err).toLowerCase().includes("pending") ||
    String(msg).toLowerCase().includes("pending")
  );
}

function parseLoginError(e) {
  const data = e?.data || {};
  const fallback =
    data?.error ||
    data?.message ||
    e?.message ||
    "Login failed. Check your email/username and password.";

  return {
    type: "error",
    title: "⚠️ Login failed",
    body: String(fallback),
  };
}

export default function Login({ navigate, setUser }) {
  const [identifier, setIdentifier] = useState(""); // email or username
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState(null); // { type, title, body }
  const [busy, setBusy] = useState(false);
  const [checkingToken, setCheckingToken] = useState(true);

  const go = (hash) => {
    if (navigate) navigate(hash);
    else window.location.replace(hash);
  };

  // on mount: only redirect if the token is actually valid
  useEffect(() => {
    let cancelled = false;

    async function checkExistingToken() {
      const token = getToken();
      if (!token) {
        setCheckingToken(false);
        return;
      }

      try {
        const me = await fetchCurrentUser();
        if (cancelled) return;

        if (me) {
          if (setUser) setUser(me);
          go("#/");
          return;
        }

        // if me() returns null/falsey, treat as invalid token
        logout();
        setCheckingToken(false);
      } catch (e) {
        if (cancelled) return;

        // ✅ IMPORTANT: if backend says pending verification, go status page
        if (isPendingVerificationError(e)) {
          setCheckingToken(false);
          go("#/status");
          return;
        }

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
    setNotice(null);
    setBusy(true);

    try {
      const u = await login(identifier, password);

      // ✅ if login succeeded, user is verified (backend blocks otherwise)
      if (setUser) setUser(u);
      go("#/");
    } catch (e) {
      console.error("login failed:", e);

      // ✅ unverified users: route to status page (NO pending notice)
      if (isPendingVerificationError(e)) {
        // optional: you might still want to store identifier somewhere
        // localStorage.setItem("pending_identifier", identifier);

        go("#/status");
        return;
      }

      setNotice(parseLoginError(e));
    } finally {
      setBusy(false);
    }
  }

  if (checkingToken) {
    return (
      <div className="container">
        <div className="card">Checking session…</div>
      </div>
    );
  }

  const noticeStyle =
    notice?.type === "pending"
      ? { background: "#fff7ed", border: "1px solid #fdba74", color: "#9a3412" }
      : { background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b" };

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

        {notice && (
          <div
            style={{
              ...noticeStyle,
              marginTop: 10,
              padding: 10,
              borderRadius: 10,
              whiteSpace: "pre-line",
              lineHeight: 1.35,
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 6 }}>
              {notice.title}
            </div>
            <div style={{ fontSize: 13 }}>{notice.body}</div>
          </div>
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
