// web/src/auth.js
import { apiPost, setToken, clearToken } from "./api";
import { createClient } from "@supabase/supabase-js";

/* ---------------- Supabase (optional) ---------------- */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const HAS_SUPABASE = !!(SUPABASE_URL && SUPABASE_ANON);

const sb = HAS_SUPABASE ? createClient(SUPABASE_URL, SUPABASE_ANON) : null;

function friendlyError(e, fallback = "Request failed") {
  if (!e) return new Error(fallback);
  if (typeof e === "string") return new Error(e);
  if (e.message) return new Error(e.message);
  try {
    const parsed = JSON.parse(String(e));
    if (parsed?.error) return new Error(parsed.error);
    if (parsed?.message) return new Error(parsed.message);
  } catch {}
  return new Error(fallback);
}

/* ---------------- Session APIs (your existing backend) ---------------- */
export async function login(identifier, password) {
  try {
    const res = await apiPost("/login", { identifier, password });
    setToken(res.token);
    return res.user;
  } catch (e) {
    throw friendlyError(e, "Login failed");
  }
}

const VALID_ROLES = ["part-timer", "pm", "admin"];
export async function registerUser({ email, username, name, password, role = "part-timer" }) {
  try {
    const pickedRole = VALID_ROLES.includes(role) ? role : "part-timer";
    const res = await apiPost("/register", { email, username, name, password, role: pickedRole });
    setToken(res.token);
    return res.user;
  } catch (e) {
    throw friendlyError(e, "Registration failed");
  }
}

/* ---------------- Forgot / Reset (Smart: Supabase or Backend) ---------------- */

/**
 * Request a reset email.
 * - If Supabase env is present, uses Supabase email flow (redirects back to /reset?code=...).
 * - Otherwise, calls your backend /forgot-password (which may return { token, resetLink } in dev).
 */
export async function forgotPassword(email) {
  const addr = String(email || "").trim();
  if (!addr) throw new Error("Please enter your email");

  // Supabase flow
  if (HAS_SUPABASE && sb) {
    try {
      const redirectTo =
        typeof window !== "undefined"
          ? new URL("/reset", window.location.origin).toString()
          : "/reset";
      const { error } = await sb.auth.resetPasswordForEmail(addr, { redirectTo });
      if (error) throw error;
      return { ok: true, via: "supabase", redirectToUsed: redirectTo };
    } catch (e) {
      throw friendlyError(e, "Failed to send reset email");
    }
  }

  // Backend flow
  try {
    // Your server should email the link; it may also return { token, resetLink } for dev.
    return await apiPost("/forgot-password", { email: addr });
  } catch (e) {
    throw friendlyError(e, "Failed to send reset email");
  }
}

/**
 * Reset the password given a token/code.
 * - Supabase: `token` is the `code` query param from /reset?code=...
 *   We exchange it for a session, then update the user's password.
 * - Backend: calls /reset-password with { token, password }.
 */
export async function resetPassword(token, password) {
  const pw = String(password || "");
  if (!token) throw new Error("Missing reset token");
  if (pw.length < 6) throw new Error("Password must be at least 6 characters");

  if (HAS_SUPABASE && sb) {
    try {
      const { error: exErr } = await sb.auth.exchangeCodeForSession(token);
      if (exErr) throw exErr;
      const { error: upErr } = await sb.auth.updateUser({ password: pw });
      if (upErr) throw upErr;
      return { ok: true, via: "supabase" };
    } catch (e) {
      throw friendlyError(e, "Failed to reset password");
    }
  }

  try {
    return await apiPost("/reset-password", { token, password: pw });
  } catch (e) {
    throw friendlyError(e, "Failed to reset password");
  }
}

/* -------- Optional helpers (for pages using the split Supabase flow) --------
   If your Reset page uses a two-step flow (exchange first, then update),
   these helpers are provided. On non-Supabase setups they throw by design.
*/
export async function exchangeResetCode(code) {
  if (!(HAS_SUPABASE && sb)) {
    throw new Error("exchangeResetCode is only available with Supabase Auth");
  }
  const { data, error } = await sb.auth.exchangeCodeForSession(code);
  if (error) throw friendlyError(error, "Invalid or expired reset link");
  return data;
}

export async function updatePassword(newPassword) {
  if (!(HAS_SUPABASE && sb)) {
    throw new Error("updatePassword is only available with Supabase Auth");
  }
  if (!newPassword || String(newPassword).length < 6) {
    throw new Error("Password must be at least 6 characters");
  }
  const { data, error } = await sb.auth.updateUser({ password: newPassword });
  if (error) throw friendlyError(error, "Failed to update password");
  return data;
}

/* ---------------- Logout ---------------- */
export function logout() {
  clearToken();
  // If you also want to clear Supabase auth cookies when present:
  if (HAS_SUPABASE && sb) {
    try { sb.auth.signOut(); } catch {}
  }
}
