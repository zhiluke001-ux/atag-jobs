// web/src/auth.js
const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_SERVER_URL ||
  "https://atag-jobs.onrender.com"; // change if needed

export function getToken() {
  return localStorage.getItem("token") || "";
}

export function setToken(t) {
  if (!t) localStorage.removeItem("token");
  else localStorage.setItem("token", t);
}

async function apiFetch(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const resp = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  const text = await resp.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!resp.ok) {
    const msg = data?.error || data?.message || `Request failed (${resp.status})`;
    const err = new Error(msg);
    err.status = resp.status;
    err.data = data; // ✅ keep consistent for UI
    throw err;
  }

  return data;
}

/* ---------------- Auth ---------------- */

export async function login(identifier, password) {
  const res = await apiFetch("/login", {
    method: "POST",
    body: { identifier, password },
    auth: false,
  });

  if (res?.token) setToken(res.token);
  return res?.user || null;
}

export async function register(payload) {
  const res = await apiFetch("/register", {
    method: "POST",
    body: payload,
    auth: false,
  });
  return res;
}

// ✅ ADD THIS: Register.jsx expects registerUser()
export async function registerUser(payload) {
  return register(payload);
}

export function logout() {
  setToken("");
}

export async function fetchCurrentUser() {
  const token = getToken();
  if (!token) return null;

  try {
    const res = await apiFetch("/me", { method: "GET", auth: true });
    return res?.user || null;
  } catch {
    setToken("");
    return null;
  }
}

/* ---------------- Profile ---------------- */

export async function updateProfile(fields) {
  const res = await apiFetch("/me/profile", {
    method: "PATCH",
    body: fields,
    auth: true,
  });

  if (res?.token) setToken(res.token);
  return res?.user || null;
}

export async function changePassword(currentPassword, newPassword) {
  return apiFetch("/me/password", {
    method: "POST",
    body: { currentPassword, newPassword },
    auth: true,
  });
}

export async function uploadAvatarDataUrl(dataUrl) {
  return apiFetch("/me/avatar", {
    method: "POST",
    body: { dataUrl },
    auth: true,
  });
}

/* ---------------- Password reset ---------------- */

export async function forgotPassword(email) {
  return apiFetch("/forgot-password", {
    method: "POST",
    body: { email },
    auth: false,
  });
}

export async function resetPassword(token, password) {
  return apiFetch("/reset-password", {
    method: "POST",
    body: { token, password },
    auth: false,
  });
}
