// web/src/auth.js
import { apiPost, apiGet, setToken, clearToken } from "./api";

const TOKEN_KEY = "token";

/* ------------------------------------ */
/* Token helpers                        */
/* ------------------------------------ */
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

/* ------------------------------------ */
/* Avatar fallback utility              */
/* ------------------------------------ */
function withAvatarFallback(user) {
  if (!user) return null;
  if (!user.avatarUrl) {
    const base = user.name || user.email || user.username || "User";
    const initials =
      String(base)
        .replace(/[_.-]+/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((s) => s[0])
        .join("")
        .toUpperCase() || "U";
    // lightweight CDN avatar
    user.avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(
      initials
    )}&size=128&background=random&color=fff&bold=true`;
  }
  return user;
}

/* ------------------------------------ */
/* Auth flows                           */
/* ------------------------------------ */
export async function login(identifier, password) {
  const res = await apiPost("/login", { identifier, password });
  setToken(res.token);
  return withAvatarFallback(res.user);
}

// Always return the user object (not {user})
export async function fetchCurrentUser() {
  try {
    const me = await apiGet("/me");
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
    password, // server hashes
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

/* ------------------------------------ */
/* Profile & security helpers           */
/* ------------------------------------ */

// Update own profile fields (email, username, name, phone, discord)
// Note: sending empty string will clear phone/discord.
export async function updateProfile({ name, username, email, phone, discord }) {
  const res = await apiPost("/me/profile", {
    // server treats undefined as "don't change"
    ...(name !== undefined ? { name: String(name).trim() } : {}),
    ...(username !== undefined ? { username: String(username).trim() } : {}),
    ...(email !== undefined ? { email: String(email).trim() } : {}),
    ...(phone !== undefined ? { phone: String(phone).trim() } : {}),
    ...(discord !== undefined ? { discord: String(discord).trim() } : {}),
  });
  return withAvatarFallback(res.user);
}

// Change password (requires currentPassword)
export async function changePassword(currentPassword, newPassword) {
  const res = await apiPost("/me/password", { currentPassword, newPassword });
  return res?.ok === true;
}

// Upload avatar via Data URL (from FileReader.readAsDataURL)
export async function uploadAvatarDataUrl(dataUrl) {
  const res = await apiPost("/me/avatar", { dataUrl });
  return res.avatarUrl; // string
}
