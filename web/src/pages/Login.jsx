// web/src/pages/Login.jsx
import React, { useState, useEffect } from "react";
import { login, getToken, fetchCurrentUser, logout } from "../auth";

/** More defensive pending detection */
function isPendingVerificationError(e) {
  const data = e?.data || {};
  const status = e?.status || e?.response?.status || data?.status;
  const code = data?.code || e?.code || null;

  const err = data?.error || data?.message || "";
  const msg = e?.message || "";
  const asText = String(e || "");

  const looksPending =
    code === "PENDING_VERIFICATION" ||
    /pending_verification/i.test(String(err)) ||
    /pending_verification/i.test(String(msg)) ||
    /pending_verification/i.test(asText) ||
    /pending/i.test(String(err)) ||
    /pending/i.test(String(msg));

  // Your backend uses 403 only for pending verification at /login
  if (Number(status) === 403 && looksPending) return true;

  // fallback: even if status is missing, treat explicit pending text as pending
  if (looksPending) return true;

  return false;
}

function parseLoginError(e) {
  const data = e?.data || {};
  const fallback =
    data?.error ||
    data?.message ||
    e?.message ||
    "Login failed. Check your email/username and password.";

  return {
    title: "⚠️ Login failed",
    body: String(fallback),
  };
}

export default function Login({ navigate, setUser }) {
  const [identifier, setIdentifier] = useState(""); // email or username
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState(null); // { title, body }
  const [busy, setBusy] = useState(false);
  const [checkingToken, setCheckingToken] = useState(true);

  // ✅ reliable hash navigation
  const go = (hash) => {
    const h = String(hash || "#/").trim();
    if (navigate) return navigate(h);
    // location.hash expects WITHOUT the leading '#'
    const clean = h.startsWith("#") ? h.slice(1) : h;
    window.location.hash = clean;
  };

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

        // invalid session
        logout();
        setCheckingToken(false);
      } catch (e) {
        if (cancelled) return;

        // ✅ if /me fails due to pending, go status page
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

      // ✅ login succeeded means verified (your backend blocks otherwise)
      if (setUser) setUser(u);
      go("#/");
    } catch (e) {
      // keep a log, but don't block redirect
      console.error("login failed:", e);

      // ✅ pending → status page (NO pending notice)
      if (isPendingVerificationError(e)) {
        // optional: your status page can read this to show which account
        localStorage.setItem("pending_identifier", identifier);
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
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#991b1b",
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
