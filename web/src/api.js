// web/src/api.js

const TOKEN_KEY = "token";
const LS_BASE_KEY = "apiBase";

// If not explicitly configured, and we're on Vite dev (:5173),
// default API base to the Node server (:4000) to avoid 404s.
function detectDevFallbackBase() {
  if (typeof window === "undefined") return "";
  const { hostname, port } = window.location;
  const isLocal =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (isLocal && port === "5173") {
    return "http://localhost:4000";
  }
  return "";
}

// Decide API base in priority:
// 1) localStorage.apiBase (handy for ngrok)
// 2) VITE_API_URL (env)
// 3) dev fallback to http://localhost:4000 when on :5173
// 4) "" => relative (only safe if Vite proxy is configured)
function resolveBase() {
  let fromLS = "";
  try { fromLS = localStorage.getItem(LS_BASE_KEY) || ""; } catch {}
  const fromEnv = (import.meta?.env?.VITE_API_URL || "").trim();
  const fallback = detectDevFallbackBase();
  const base = (fromLS || fromEnv || fallback || "").replace(/\/+$/, "");
  return base; // "" => use relative URL (requires Vite proxy)
}

let API_BASE = resolveBase();
export { API_BASE }; // some files import this

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
  if (!path.startsWith("/")) path = "/" + path;
  return API_BASE ? API_BASE + path : path;
}

async function doFetch(path, { method = "GET", body, headers } = {}) {
  const res = await fetch(fullUrl(path), {
    method,
    headers: {
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...authHeaders(),
      ...(headers || {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const text = await res.text().catch(() => "");

  // Try structured error first
  if (!res.ok) {
    try {
      const json = text ? JSON.parse(text) : {};
      const msg = json?.error || json?.message || `${res.status} ${res.statusText}`;
      const err = new Error(msg);
      err.status = res.status;
      err.payload = json;
      throw err;
    } catch {
      const err = new Error(text || `${res.status} ${res.statusText}`);
      err.status = res.status;
      throw err;
    }
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try { return text ? JSON.parse(text) : {}; } catch { return {}; }
  }
  return text;
}

/* ----------------------------
   Public API helpers
---------------------------- */
export const apiGet    = (path)        => doFetch(path, { method: "GET" });
export const apiPost   = (path, body)  => doFetch(path, { method: "POST", body });
export const apiPatch  = (path, body)  => doFetch(path, { method: "PATCH", body });
export const apiDelete = (path)        => doFetch(path, { method: "DELETE" });

export async function apiGetBlob(path) {
  const res = await fetch(fullUrl(path), { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.blob();
}
