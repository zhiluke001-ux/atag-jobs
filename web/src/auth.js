// web/src/auth.js
import { apiPost, apiGet, setToken, clearToken } from "./api";

const TOKEN_KEY = "token";

/* ---------------- helpers: avatar ---------------- */
function initialsFrom(str = "") {
  const s = String(str || "").trim();
  if (!s) return "U";
  // If it's an email, use the part before @
  const base = s.includes("@") ? s.split("@")[0] : s;
  const parts = base
    .replace(/[_.-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function avatarFromUser(user, size = 128) {
  // 1) Prefer explicit fields if your backend ever adds them
  const explicit = user?.avatar || user?.picture || user?.photoUrl;
  if (explicit && /^https?:\/\//i.test(explicit)) return explicit;

  // 2) Fallback: generate initials-based avatar
  const base = user?.name || user?.email || user?.username || "User";
  const initials = initialsFrom(base);
  // ui-avatars supports text + background/color. Using random bg keeps it vibrant.
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(
    initials
  )}&size=${size}&background=random&color=fff&bold=true`;
}

function attachAvatar(user) {
  if (!user || typeof user !== "object") return user;
  return { ...user, avatarUrl: avatarFromUser(user) };
}

/* ---------------- token helpers ---------------- */
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

/* ---------------- auth flows ---------------- */
export async function login(identifier, password) {
  // will throw if /login returns 4xx
  const res = await apiPost("/login", { identifier, password });
  setToken(res.token);
  // Some backends return { user: {...} }, keep consistent:
  const user = res?.user || res;
  return attachAvatar(user);
}

// call this to see if current token is actually usable
export async function fetchCurrentUser() {
  try {
    const me = await apiGet("/me");
    const user = me?.user || me;
    return attachAvatar(user) || null;
  } catch {
    return null;
  }
}

export async function registerUser({
  email,
  username,
  name,
  password,
  phone,    // supported by your server
  discord,  // supported by your server
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
  const user = res?.user || res;
  return attachAvatar(user);
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
