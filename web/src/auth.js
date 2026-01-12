// src/auth.js
import { apiGet, apiPost } from "./api";

/* ---------------- token helpers ---------------- */
const TOKEN_KEY = "atag_token";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (!token) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, token);
  } catch {}
}

/** ✅ this is what Header.jsx expects */
export function logout() {
  setToken(null);
  // optional: clear any other cached user data keys here if you have
}

/* ---------------- helpers ---------------- */
function withAvatarFallback(user) {
  if (!user) return user;
  // keep as-is if you already have this logic
  return user;
}

/* ---------------- auth APIs ---------------- */

// Example login (keep your own if already exist)
export async function login(identifier, password) {
  const res = await apiPost("/login", {
    identifier: String(identifier || "").trim(),
    password,
  });

  // If your backend returns token:
  if (res?.token) setToken(res.token);

  return withAvatarFallback(res?.user);
}

// Example current user (keep your own if already exist)
export async function fetchCurrentUser() {
  try {
    const me = await apiGet("/me");
    return withAvatarFallback(me?.user || me);
  } catch {
    return null;
  }
}

// ✅ Your existing registerUser can stay — just ensure it still imports apiPost from "./api"
export async function registerUser({
  email,
  username,
  name,
  password,
  phone,
  discord,
  role = "part-timer",
  verificationDataUrl,
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
    verificationDataUrl,
  };

  const res = await apiPost("/register", body);

  // DO NOT setToken here (must wait for admin verify)
  return withAvatarFallback(res?.user);
}
