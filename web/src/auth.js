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
  // will throw if /login returns 4xx
  const res = await apiPost("/login", { identifier, password });
  setToken(res.token);
  return res.user;
}

// call this to see if current token is actually usable
export async function fetchCurrentUser() {
  try {
    const me = await apiGet("/me");
    // Some callers expect {user: {...}}, others just the user object:
    return me?.user || me;
  } catch {
    return null;
  }
}

export async function registerUser({
  email,
  username,
  name,
  password,
  phone,    // <-- now supported
  discord,  // <-- now supported
  role = "part-timer",
}) {
  const VALID_ROLES = ["part-timer", "pm", "admin"];
  const pickedRole = VALID_ROLES.includes(role) ? role : "part-timer";

  // Trim strings before sending
  const body = {
    email: String(email || "").trim(),
    username: String(username || "").trim(),
    name: String(name || "").trim(),
    password, // keep raw; server hashes
    phone: String(phone || "").trim(),
    discord: String(discord || "").trim(),
    role: pickedRole,
  };

  const res = await apiPost("/register", body);
  setToken(res.token);
  return res.user;
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
