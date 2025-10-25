// web/src/api.js

const TOKEN_KEY = "token";
// Prefer new key but read legacy too
const LS_BASE_KEYS = ["atag.apiBase", "apiBase"];

/* ---------- Dev fallback (:5173 -> :4000) ---------- */
function detectDevFallbackBase() {
  if (typeof window === "undefined") return "";
  const { hostname, port } = window.location;
  const isLocal =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (isLocal && port === "5173") return "http://localhost:4000";
  return "";
}

/* ---------- Helpers ---------- */
function readLocalBase() {
  try {
    for (const k of LS_BASE_KEYS) {
      const v = localStorage.getItem(k);
      if (v && v.trim()) return v.trim();
    }
  } catch {}
  return "";
}

function writeLocalBase(url) {
  try {
    if (url) localStorage.setItem(LS_BASE_KEYS[0], String(url));
    else localStorage.removeItem(LS_BASE_KEYS[0]);
    // Clear legacy keys
    for (let i = 1; i < LS_BASE_KEYS.length; i++) {
      localStorage.removeItem(LS_BASE_KEYS[i]);
    }
  } catch {}
}

function sanitizeBase(url) {
  if (!url) return "";
  const trimmed = String(url).trim().replace(/\/+$/, "");
  // Only accept absolute http(s) URLs in production
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return "";
}

/* ---------- Resolve API base (priority) ----------
   1) localStorage (atag.apiBase -> apiBase)
   2) Env: VITE_API_BASE (preferred) or VITE_API_URL (legacy)
   3) Dev fallback http://localhost:4000 (when on :5173)
   4) "" => relative (dev proxy only)
-------------------------------------------------- */
function resolveBase() {
  const fromLS = readLocalBase();
  const envBase =
    (import.meta?.env?.VITE_API_BASE ||
      import.meta?.env?.VITE_API_URL ||
      "").trim();
  const fallback = detectDevFallbackBase();

  const chosen = sanitizeBase(fromLS) || sanitizeBase(envBase) || fallback || "";
  return chosen.replace(/\/+$/, "");
}

let API_BASE = resolveBase();
export { API_BASE };

export function getApiBase() {
  return API_BASE;
}

export function setApiBase(url) {
  writeLocalBase(url || "");
  API_BASE = resolveBase();
}

export function debugApiBase() {
  // Handy in the console to confirm where we're pointing
  // e.g. window.debugApiBase && debugApiBase()
  console.log("API_BASE =", API_BASE || "(relative)");
}

/* ---------- Auth token helpers ---------- */
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
  return API_BASE ? API_BASE + path : path; // relative only in dev/proxy
}

async function doFetch(path, { method = "GET", body, headers } = {}) {
  const url = fullUrl(path);
  const res = await fetch(url, {
    method,
    headers: {
      ...(body != null ? { "Content-Type": "application/json" } : {}),
      ...authHeaders(),
      ...(headers || {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const raw = await res.text().catch(() => "");

  // Error path: try to parse JSON payload for message first
  if (!res.ok) {
    try {
      const json = raw ? JSON.parse(raw) : {};
      const msg = json?.error || json?.message || `${res.status} ${res.statusText}`;
      const err = new Error(msg);
      err.status = res.status;
      err.payload = json;
      throw err;
    } catch {
      const err = new Error(raw || `${res.status} ${res.statusText}`);
      err.status = res.status;
      throw err;
    }
  }

  // Expect JSON for all app APIs; fail fast if we got HTML/text by mistake
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    throw new Error(
      `Expected JSON from API but got "${ct}" at ${url}. ` +
      `Your API base is likely misconfigured. ` +
      `Set localStorage 'atag.apiBase' or 'apiBase' to your Render URL, ` +
      `or set VITE_API_BASE during build.`
    );
  }

  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    // Shouldn't happen with valid API; keep it defensive
    return {};
  }
}

/* ----------------------------
   Public API helpers
---------------------------- */
export const apiGet    = (path)       => doFetch(path, { method: "GET" });
export const apiPost   = (path, body) => doFetch(path, { method: "POST", body });
export const apiPatch  = (path, body) => doFetch(path, { method: "PATCH", body });
export const apiDelete = (path)       => doFetch(path, { method: "DELETE" });

export async function apiGetBlob(path) {
  const res = await fetch(fullUrl(path), { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.blob();
}
