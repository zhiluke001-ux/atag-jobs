// web/src/auth.js
import { apiPost, apiGet, setToken, clearToken } from "./api";

const TOKEN_KEY = "token";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

export function isLoggedIn() {
  return !!getToken();
}

export async function login(identifier, password) {
  const res = await apiPost("/login", { identifier, password });
  setToken(res.token);
  // normalize user shape & ensure avatar fallback
  return withAvatarFallback(res.user);
}

// Ensure we always return a user object with avatarUrl present
function withAvatarFallback(user) {
  if (!user) return null;
  if (!user.avatarUrl) {
    const base = user.name || user.email || user.username || "User";
    const initials = String(base)
      .replace(/[_.-]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0])
      .join("")
      .toUpperCase() || "U";
    user.avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(
      initials
    )}&size=128&background=random&color=fff&bold=true`;
  }
  return user;
}

// call this to see if current token is actually usable
export async function fetchCurrentUser() {
  try {
    const me = await apiGet("/me");
    // Some callers expect {user: {...}}, others the user object:
    const u = me?.user || me;
    return withAvatarFallback(u);
  } catch {
    return null;
  }
}

export async function registerUser({
  email,
  username,
  name,
  password,
  phone,
  discord,
  role = "part-timer",
}) {
  const VALID_ROLES = ["part-timer", "pm", "admin"];
  const pickedRole = VALID_ROLES.includes(role) ? role : "part-timer";

  const body = {
    email: String(email || "").trim(),
    username: String(username || "").trim(),
    name: String(name || "").trim(),
    password,
    phone: String(phone || "").trim(),
    discord: String(discord || "").trim(),
    role: pickedRole,
  };

  const res = await apiPost("/register", body);
  setToken(res.token);
  return withAvatarFallback(res.user);
}

export async function forgotPassword(email) {
  return apiPost("/forgot-password", { email });
}

export async function resetPassword(token, password) {
  return apiPost("/reset-password", { token, password });
}

export function logout() {
  clearToken();
}

/* ---------- Profile helpers (NEW) ---------- */

// Update own profile fields
export async function updateProfile({ name, username, email, phone, discord }) {
  const res = await apiPost("/me/profile", {
    name: String(name ?? "").trim(),
    username: String(username ?? "").trim(),
    email: String(email ?? "").trim(),
    phone: String(phone ?? "").trim(),
    discord: String(discord ?? "").trim(),
  });
  // server returns {user: {...}}
  return withAvatarFallback(res.user);
}

// Change password (current -> new)
export async function changePassword(currentPassword, newPassword) {
  const res = await apiPost("/me/password", {
    currentPassword,
    newPassword,
  });
  return res?.ok === true;
}

// Upload avatar via data URL (e.g. from <input type="file"> readAsDataURL)
export async function uploadAvatarDataUrl(dataUrl) {
  const res = await apiPost("/me/avatar", { dataUrl });
  // Expect { ok: true, avatarUrl: "..." }
  return res.avatarUrl;
}
