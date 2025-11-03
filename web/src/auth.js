// web/src/auth.js
import { apiPost, setToken, clearToken } from "./api";

/**
 * Frontend auth helpers
 * - Pure backend API (no Supabase import needed)
 * - Compatible with Forgot.jsx / Reset.jsx that call /forgot-password and /reset-password
 */

export async function login(identifier, password) {
  // identifier can be email or username, depending on your backend
  const res = await apiPost("/login", { identifier, password });
  if (res?.token) setToken(res.token);
  return res.user;
}

// Allow role selection at sign-up (server should verify/override)
const VALID_ROLES = ["part-timer", "pm", "admin"];

export async function registerUser({ email, username, name, password, role = "part-timer" }) {
  const pickedRole = VALID_ROLES.includes(role) ? role : "part-timer";
  const res = await apiPost("/register", { email, username, name, password, role: pickedRole });
  if (res?.token) setToken(res.token);
  return res.user;
}

/**
 * Forgot password -> server sends email (or returns dev link if email service not configured)
 * Returns: { ok, via: "email"|"noop"|"dev", token?, resetLink? }
 */
export async function forgotPassword(email) {
  if (!email || typeof email !== "string") {
    throw new Error("Please enter a valid email");
  }
  return apiPost("/forgot-password", { email });
}

/**
 * Reset password using token (from /reset?token=...)
 * Returns: { ok: true } on success
 */
export async function resetPassword(token, password) {
  if (!token) throw new Error("Missing token");
  if (!password || password.length < 8) throw new Error("Password must be at least 8 characters");
  return apiPost("/reset-password", { token, password });
}

/**
 * Helper to read reset token from current URL.
 * Accepts both ?token=... and legacy ?code=... for compatibility.
 */
export function getResetTokenFromLocation() {
  try {
    const u = new URL(window.location.href);
    const token = u.searchParams.get("token") || u.searchParams.get("code");
    return token || "";
  } catch {
    return "";
  }
}

export function logout() {
  clearToken();
}
