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

/* ---------- Read runtime global (from index.html) ---------- */
function readGlobalBase() {
  try {
    const v = typeof window !== "undefined" && window.ATAG_API_BASE;
    return v ? String(v).trim() : "";
  } catch {
    return "";
  }
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
  // Only accept absolute http(s) URLs
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return "";
}

/* ---------- Resolve API base (priority) ----------
   1) window.ATAG_API_BASE (runtime, from index.html)
   2) localStorage (atag.apiBase -> apiBase)
   3) Env: VITE_API_BASE (preferred) or VITE_API_URL (legacy)
   4) Dev fallback http://localhost:4000 (when on :5173)
   5) "" => relative (dev proxy only)
-------------------------------------------------- */
function resolveBase() {
  const fromGlobal = sanitizeBase(readGlobalBase());
  const fromLS = sanitizeBase(readLocalBase());
  const fromEnv = sanitizeBase(
    (import.meta?.env?.VITE_API_BASE ||
      import.meta?.env?.VITE_API_URL ||
      "").trim()
  );
  const dev = detectDevFallbackBase();

  const chosen = fromGlobal || fromLS || fromEnv || dev || "";
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
  console.log("API_BASE =", API_BASE || "(relative)");
}

/* ---------- URL helpers ---------- */
export function fullUrl(path) {
  let p = String(path || "");
  if (!p.startsWith("/")) p = "/" + p;
  return API_BASE ? API_BASE + p : p; // relative only in dev/proxy
}

// ✅ IMPORTANT: for backend-returned "/uploads/xxx.jpg"
export function assetUrl(u) {
  const s = String(u || "");
  if (!s) return "";
  if (/^(data:|blob:|https?:\/\/)/i.test(s)) return s;
  return fullUrl(s); // uses same API_BASE logic
}

/* ---------- Auth token helpers ---------- */
export function setToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {}
}
export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}
export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

function authHeaders() {
  const t = getToken();
  return t ? { Authorization: "Bearer " + t } : {};
}

async function doFetch(path, { method = "GET", body, headers, expectJson = true } = {}) {
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

  // Error path: try JSON payload first
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

  // Some endpoints may legitimately return 204 No Content
  if (res.status === 204 || raw === "") return {};

  if (!expectJson) return raw;

  const ct = res.headers.get("content-type") || "";
  // Be a bit more tolerant (some servers forget to set content-type)
  if (!ct.includes("application/json")) {
    // Try parse anyway, else throw a helpful error
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(
        `Expected JSON from API but got "${ct}" at ${url}. ` +
          `Your API base may be misconfigured. ` +
          `Set localStorage 'atag.apiBase' to your Render URL or set VITE_API_BASE during build.`
      );
    }
  }

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/* ----------------------------
   Public API helpers
---------------------------- */
export const apiGet = (path) => doFetch(path, { method: "GET" });
export const apiPost = (path, body) => doFetch(path, { method: "POST", body });
export const apiPatch = (path, body) => doFetch(path, { method: "PATCH", body });
export const apiDelete = (path) => doFetch(path, { method: "DELETE" });

export async function apiGetBlob(path) {
  const res = await fetch(fullUrl(path), { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.blob();
}
