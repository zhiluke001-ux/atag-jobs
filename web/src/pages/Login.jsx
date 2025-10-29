import React, { useState } from "react";
import { login } from "../auth";

export default function Login({ navigate, setUser }) {
  const [identifier, setIdentifier] = useState(""); // email or username
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const u = await login(identifier, password);
      setUser(u);
      navigate("#/"); // go to Home after login
    } catch (e) {
      setError("Login failed. Check your email/username and password.");
    } finally {
      setBusy(false);
    }
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
