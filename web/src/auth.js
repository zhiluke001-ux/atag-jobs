// web/src/auth.js
const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_SERVER_URL ||
  "https://atag-jobs.onrender.com"; // change if needed

function getToken() {
  return localStorage.getItem("token") || "";
}

function setToken(t) {
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

  // try parse json safely
  let data = null;
  const text = await resp.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!resp.ok) {
    const msg =
      data?.error ||
      data?.message ||
      `Request failed (${resp.status})`;
    const err = new Error(msg);
    err.status = resp.status;
    err.data = data;
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

  // backend returns { token, user: {...} }
  return res?.user || null;
}

export async function register(payload) {
  // payload should include: email, password, name, role, phone, discord, verificationDataUrl, username
  const res = await apiFetch("/register", {
    method: "POST",
    body: payload,
    auth: false,
  });

  // register returns pending:true (no token)
  return res;
}

export function logout() {
  setToken("");
}

export async function fetchCurrentUser() {
  const token = getToken();
  if (!token) return null;

  try {
    const res = await apiFetch("/me", { method: "GET", auth: true });
    // backend returns { user: {...} }
    return res?.user || null;
  } catch {
    // token invalid/expired
    setToken("");
    return null;
  }
}

/* ---------------- Profile ---------------- */

export async function updateProfile(fields) {
  // backend: PATCH /me or PATCH /me/profile both exist
  const res = await apiFetch("/me/profile", {
    method: "PATCH",
    body: fields,
    auth: true,
  });

  // backend returns { ok, token, user }
  if (res?.token) setToken(res.token);
  return res?.user || null;
}

export async function changePassword(currentPassword, newPassword) {
  const res = await apiFetch("/me/password", {
    method: "POST",
    body: { currentPassword, newPassword },
    auth: true,
  });
  return res;
}

export async function uploadAvatarDataUrl(dataUrl) {
  const res = await apiFetch("/me/avatar", {
    method: "POST",
    body: { dataUrl },
    auth: true,
  });
  return res;
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
