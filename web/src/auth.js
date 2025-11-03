// src/auth.js
import { apiPost, setToken, clearToken } from "./api";

/* ================================
   Auth API helpers (frontend)
   - Works with either:
     • New routes:   /auth/forgot, /auth/reset
     • Legacy routes:/forgot-password, /reset-password
   - Graceful fallbacks included
================================== */

/** Try multiple endpoints until one succeeds */
async function apiPostWithFallback(paths, body) {
  let lastErr;
  for (const p of paths) {
    try {
      return await apiPost(p, body);
    } catch (e) {
      // Keep the last error and try next path
      lastErr = e;
    }
  }
  // If none worked, throw the last error
  throw lastErr || new Error("Request failed");
}

/* ---------- Login / Register ---------- */
export async function login(identifier, password) {
  const res = await apiPost("/login", { identifier, password });
  // Expecting { token, user }
  if (!res?.token) throw new Error("Login failed: missing token");
  setToken(res.token);
  return res.user;
}

// Allow role selection at sign-up
const VALID_ROLES = ["part-timer", "pm", "admin"];

export async function registerUser({ email, username, name, password, role = "part-timer" }) {
  const pickedRole = VALID_ROLES.includes(role) ? role : "part-timer";
  const res = await apiPost("/register", { email, username, name, password, role: pickedRole });
  // Expecting { token, user }
  if (!res?.token) throw new Error("Register failed: missing token");
  setToken(res.token);
  return res.user;
}

/* ---------- Forgot / Reset password ---------- */
export async function forgotPassword(email) {
  // Returns { ok: true } in prod; in dev may include { token, resetLink }
  return apiPostWithFallback(
    ["/auth/forgot", "/forgot-password"],
    { email }
  );
}

export async function resetPassword(token, password) {
  // Returns { ok: true } on success
  return apiPostWithFallback(
    ["/auth/reset", "/reset-password"],
    { token, password }
  );
}

/* ---------- Logout ---------- */
export function logout() {
  clearToken();
}
