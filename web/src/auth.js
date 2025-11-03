// src/auth.js
import { apiPost, setToken, clearToken } from "./api";

/** ---------------------------
 * Error helper
 * --------------------------- */
function normalizeError(e) {
  if (!e) return new Error("Request failed");
  if (e instanceof Error) return e;
  try {
    const j = typeof e === "string" ? JSON.parse(e) : e;
    const msg = j?.error || j?.message || j?.msg || "Request failed";
    return new Error(String(msg));
  } catch {
    return new Error(typeof e === "string" ? e : "Request failed");
  }
}

/** ---------------------------
 * Auth: login / register / logout
 * --------------------------- */
export async function login(identifier, password) {
  try {
    const res = await apiPost("/login", { identifier, password });
    if (!res?.token || !res?.user) throw new Error("Invalid login response");
    setToken(res.token);
    return res.user;
  } catch (e) {
    throw normalizeError(e);
  }
}

// Allow role selection at sign-up
const VALID_ROLES = ["part-timer", "pm", "admin"];

export async function registerUser({ email, username, name, password, role = "part-timer" }) {
  try {
    const pickedRole = VALID_ROLES.includes(role) ? role : "part-timer";
    const res = await apiPost("/register", { email, username, name, password, role: pickedRole });
    if (!res?.token || !res?.user) throw new Error("Invalid register response");
    setToken(res.token);
    return res.user;
  } catch (e) {
    throw normalizeError(e);
  }
}

export function logout() {
  clearToken();
}

/** ---------------------------
 * Password reset flow (email link)
 * Backend endpoints expected:
 *   POST /forgot-password { email [, redirectUrl]? } -> { ok?, message?, token?, resetLink? }
 *   POST /reset-password  { token|code, password }   -> { ok?, message? }
 * --------------------------- */

/**
 * Optional helper to build your frontend reset URL.
 * Use this if your backend supports passing a redirect back to your app.
 */
export function buildResetRedirectUrl(origin) {
  const base = origin || (typeof window !== "undefined" ? window.location.origin : "");
  // Keep this path in your router so email links open correctly:
  return `${base}/reset`;
}

/**
 * Request a reset email to be sent.
 * Returns a normalized object so your UI can optionally show dev info
 * if the backend includes { token, resetLink } in non-production.
 */
export async function forgotPassword(email, opts = {}) {
  try {
    const payload = { email: String(email || "").trim() };
    // If your server accepts a redirect URL, pass it along:
    if (opts.redirectUrl) payload.redirectUrl = opts.redirectUrl;

    const res = await apiPost("/forgot-password", payload);

    // Normalize various possible backend shapes
    return {
      ok: !!(res?.ok ?? true),
      message: res?.message || res?.msg || null,
      token: res?.token || res?.resetToken || null,      // dev-only, if server returns
      resetLink: res?.resetLink || res?.link || null,    // dev-only, if server returns
    };
  } catch (e) {
    throw normalizeError(e);
  }
}

/**
 * Read the reset code/token from the current URL.
 * Looks for ?token= or ?code= (supports both).
 */
export function getResetTokenFromLocation(loc) {
  try {
    const url = new URL(loc || (typeof window !== "undefined" ? window.location.href : ""));
    const sp = url.searchParams;
    return sp.get("token") || sp.get("code") || sp.get("t") || "";
  } catch {
    return "";
  }
}

/**
 * Finalize password reset using the token from the email link.
 * We send both { token, code } for compatibility with different backends.
 */
export async function resetPassword(tokenOrCode, newPassword) {
  try {
    const token = String(tokenOrCode || "").trim();
    const password = String(newPassword || "");
    if (!token) throw new Error("Missing reset token");
    if (!password) throw new Error("Missing new password");

    const res = await apiPost("/reset-password", {
      token,
      code: token, // some servers expect 'code' instead of 'token'
      password,
    });

    return {
      ok: !!(res?.ok ?? true),
      message: res?.message || res?.msg || "Password updated",
    };
  } catch (e) {
    throw normalizeError(e);
  }
}

/** ---------------------------
 * (Optional) Change password when logged in
 * Backend: POST /change-password { currentPassword, newPassword }
 * --------------------------- */
export async function changePassword(currentPassword, newPassword) {
  try {
    const res = await apiPost("/change-password", { currentPassword, newPassword });
    return {
      ok: !!(res?.ok ?? true),
      message: res?.message || res?.msg || "Password changed",
    };
  } catch (e) {
    throw normalizeError(e);
  }
}
