// web/src/api.js

const TOKEN_KEY = "token";

// Legacy/runtime override keys are still supported,
// but build-time VITE_API_BASE has highest priority.
const LS_BASE_KEYS = ["atag.apiBase", "apiBase"];

/* -------------------------------------------------------
   Base URL helpers
------------------------------------------------------- */

function sanitizeBase(url) {
  if (!url) return "";

  const trimmed = String(url).trim().replace(/\/+$/, "");

  // Only accept absolute http(s) URLs.
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return "";
}

function readEnvBase() {
  try {
    return sanitizeBase(
      import.meta.env.VITE_API_BASE ||
        import.meta.env.VITE_API_URL ||
        ""
    );
  } catch {
    return "";
  }
}

function readGlobalBase() {
  try {
    if (typeof window === "undefined") return "";
    return sanitizeBase(window.ATAG_API_BASE || "");
  } catch {
    return "";
  }
}

function readLocalBase() {
  if (typeof window === "undefined") return "";

  try {
    for (const key of LS_BASE_KEYS) {
      const value = window.localStorage.getItem(key);

      if (value && value.trim()) {
        return sanitizeBase(value);
      }
    }
  } catch {
    // localStorage may be unavailable in some browser/privacy modes.
  }

  return "";
}

function writeLocalBase(url) {
  if (typeof window === "undefined") return;

  try {
    const clean = sanitizeBase(url);

    if (clean) {
      window.localStorage.setItem(LS_BASE_KEYS[0], clean);
    } else {
      window.localStorage.removeItem(LS_BASE_KEYS[0]);
    }

    // Always clear the legacy key.
    for (let i = 1; i < LS_BASE_KEYS.length; i += 1) {
      window.localStorage.removeItem(LS_BASE_KEYS[i]);
    }
  } catch {
    // Ignore localStorage failures.
  }
}

/* ---------- Dev fallback (:5173 -> :4000) ---------- */

function detectDevFallbackBase() {
  if (typeof window === "undefined") return "";

  const { hostname, port } = window.location;

  const isLocal =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1";

  if (isLocal && port === "5173") {
    return "http://localhost:4000";
  }

  return "";
}

/* -------------------------------------------------------
   Resolve API base

   Priority:
   1. VITE_API_BASE / VITE_API_URL
   2. window.ATAG_API_BASE (legacy runtime override)
   3. localStorage override
   4. localhost:4000 during Vite development
------------------------------------------------------- */

function resolveBase() {
  const fromEnv = readEnvBase();
  const fromGlobal = readGlobalBase();
  const fromLocalStorage = readLocalBase();
  const fromDev = detectDevFallbackBase();

  return (
    fromEnv ||
    fromGlobal ||
    fromLocalStorage ||
    fromDev ||
    ""
  );
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
  console.log("ATAG API_BASE =", API_BASE || "(not configured)");
}

/* -------------------------------------------------------
   URL helpers
------------------------------------------------------- */

function isLocalFrontend() {
  if (typeof window === "undefined") return false;

  const hostname = window.location.hostname;

  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}

export function fullUrl(path) {
  let p = String(path || "");

  // Already absolute URL: leave it unchanged.
  if (/^https?:\/\//i.test(p)) {
    return p;
  }

  if (!p.startsWith("/")) {
    p = `/${p}`;
  }

  if (API_BASE) {
    return `${API_BASE}${p}`;
  }

  // In local development, allow relative URLs if using a Vite proxy.
  if (isLocalFrontend()) {
    return p;
  }

  // Do NOT silently call Cloudflare Pages in production.
  throw new Error(
    "ATAG API base is not configured. " +
      "Set VITE_API_BASE to your Railway backend URL in Cloudflare Pages " +
      "and rebuild/redeploy the frontend."
  );
}

// For backend-returned "/uploads/xxx.jpg", "/blob/xxx", etc.
export function assetUrl(value) {
  const s = String(value || "").trim();

  if (!s) return "";

  if (/^(data:|blob:|https?:\/\/)/i.test(s)) {
    return s;
  }

  return fullUrl(s);
}

/* -------------------------------------------------------
   Auth token helpers
------------------------------------------------------- */

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
  const token = getToken();

  return token
    ? {
        Authorization: `Bearer ${token}`,
      }
    : {};
}

/* -------------------------------------------------------
   Core fetch helper
------------------------------------------------------- */

async function doFetch(
  path,
  {
    method = "GET",
    body,
    headers,
    expectJson = true,
  } = {}
) {
  const url = fullUrl(path);

  let res;

  try {
    res = await fetch(url, {
      method,
      headers: {
        ...(body != null
          ? {
              "Content-Type": "application/json",
            }
          : {}),
        ...authHeaders(),
        ...(headers || {}),
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
  } catch (networkError) {
    const err = new Error(
      `Unable to reach API at ${url}. ` +
        "Check that the Railway backend is running and that CORS allows this website."
    );

    err.cause = networkError;
    throw err;
  }

  const raw = await res.text().catch(() => "");
  const contentType = res.headers.get("content-type") || "";

  if (!res.ok) {
    let payload = null;

    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = null;
      }
    }

    const message =
      payload?.error ||
      payload?.message ||
      raw ||
      `${res.status} ${res.statusText}`;

    const err = new Error(message);
    err.status = res.status;
    err.payload = payload;
    err.url = url;

    throw err;
  }

  if (res.status === 204 || raw === "") {
    return {};
  }

  if (!expectJson) {
    return raw;
  }

  try {
    return JSON.parse(raw);
  } catch {
    const isHtml =
      contentType.includes("text/html") ||
      /^\s*<!doctype html/i.test(raw) ||
      /^\s*<html/i.test(raw);

    if (isHtml) {
      throw new Error(
        `Expected JSON from API but received HTML at ${url}. ` +
          "This usually means the frontend is calling Cloudflare Pages instead of the backend. " +
          "Set VITE_API_BASE to your Railway URL and rebuild/redeploy Cloudflare Pages."
      );
    }

    throw new Error(
      `Expected JSON from API but got "${contentType || "unknown content-type"}" at ${url}.`
    );
  }
}

/* -------------------------------------------------------
   Public API helpers
------------------------------------------------------- */

export const apiGet = (path) =>
  doFetch(path, {
    method: "GET",
  });

export const apiPost = (path, body) =>
  doFetch(path, {
    method: "POST",
    body,
  });

export const apiPatch = (path, body) =>
  doFetch(path, {
    method: "PATCH",
    body,
  });

export const apiPut = (path, body) =>
  doFetch(path, {
    method: "PUT",
    body,
  });

export const apiDelete = (path) =>
  doFetch(path, {
    method: "DELETE",
  });

export async function apiGetBlob(path) {
  const url = fullUrl(path);

  let res;

  try {
    res = await fetch(url, {
      headers: {
        ...authHeaders(),
      },
    });
  } catch (networkError) {
    const err = new Error(`Unable to reach API at ${url}.`);
    err.cause = networkError;
    throw err;
  }

  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText);

    const err = new Error(
      message || `${res.status} ${res.statusText}`
    );

    err.status = res.status;
    err.url = url;

    throw err;
  }

  return res.blob();
}
