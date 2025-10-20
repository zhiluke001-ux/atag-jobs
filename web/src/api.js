// web/src/api.js

const TOKEN_KEY = "token";
const LS_BASE_KEY = "apiBase";

// Decide API base:
// - If localStorage.apiBase is set, use it (handy for ngrok).
// - Else if VITE_API_URL is set, use it.
// - Else use "" so we hit relative paths and Vite dev proxy.
function resolveBase() {
  let fromLS = "";
  try { fromLS = localStorage.getItem(LS_BASE_KEY) || ""; } catch {}
  const fromEnv = (import.meta?.env?.VITE_API_URL || "").trim();
  const base = (fromLS || fromEnv || "").replace(/\/+$/, ""); // strip trailing /
  return base; // "" => use relative URL (Vite proxy)
}
let API_BASE = resolveBase();

export { API_BASE }; // some files may import this

export function setApiBase(url) {
  try {
    if (!url) {
      localStorage.removeItem(LS_BASE_KEY);
    } else {
      localStorage.setItem(LS_BASE_KEY, String(url));
    }
  } catch {}
  API_BASE = resolveBase();
}

export function setToken(token) {
  try { localStorage.setItem(TOKEN_KEY, token); } catch {}
}
export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}
export function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
}

function authHeaders() {
  const t = getToken();
  return t ? { Authorization: "Bearer " + t } : {};
}

function fullUrl(path) {
  // path is like "/jobs", "/login", etc.
  if (!path.startsWith("/")) path = "/" + path;
  return API_BASE ? API_BASE + path : path; // relative if no base
}

async function doFetch(path, { method = "GET", body, headers } = {}) {
  const init = {
    method,
    headers: {
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...authHeaders(),
      ...(headers || {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  };
  const res = await fetch(fullUrl(path), init);

  // read body once
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    // Try to surface clean error
    throw new Error(text || res.statusText || String(res.status));
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try { return JSON.parse(text); } catch { return {}; }
  }
  return text;
}

/* ----------------------------
   Public API helpers
---------------------------- */
export const apiGet    = (path)         => doFetch(path, { method: "GET" });
export const apiPost   = (path, body)   => doFetch(path, { method: "POST", body });
export const apiPatch  = (path, body)   => doFetch(path, { method: "PATCH", body });
export const apiDelete = (path)         => doFetch(path, { method: "DELETE" });

export async function apiGetBlob(path) {
  const res = await fetch(fullUrl(path), { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.blob();
}
