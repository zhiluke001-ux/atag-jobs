// web/src/pages/Login.jsx
import React, { useState, useEffect } from "react";
import { login, getToken, fetchCurrentUser, logout } from "../auth";

function parseLoginError(e) {
  // ✅ your auth.js throws Error with e.data
  const data = e?.data || {};
  const code = data?.code || e?.code || null;
  const err = data?.error || data?.message || "";
  const msg = e?.message || "";

  const isPending =
    code === "PENDING_VERIFICATION" ||
    String(err).toLowerCase() === "pending_verification" ||
    String(msg).toLowerCase().includes("pending_verification") ||
    String(err).toLowerCase().includes("pending");

  if (isPending) {
    return {
      type: "pending",
      title: "⏳ Account pending verification",
      body:
        "Your registration is received, but your account is not verified yet.\n\n" +
        "What to do:\n" +
        "• Please wait for admin to approve your account\n" +
        "• If it takes too long, contact the admin (WhatsApp) and tell them your email/username",
    };
  }

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

  // on mount: only redirect if the token is actually valid
  useEffect(() => {
    let cancelled = false;

    async function checkExistingToken() {
      const token = getToken();
      if (!token) {
        setCheckingToken(false);
        return;
      }

      const me = await fetchCurrentUser();
      if (cancelled) return;

      if (me) {
        if (setUser) setUser(me);
        window.location.replace("#/");
      } else {
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
      if (setUser) setUser(u);
      window.location.replace("#/");
      // or: if (navigate) navigate("#/");
    } catch (e) {
      console.error("login failed:", e);
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
