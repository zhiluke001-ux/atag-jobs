import { randomId } from "./lib/security.js";

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const MAX_IMAGE_BYTES = Number(process.env.IMAGE_MAX_BYTES || 5 * 1024 * 1024);

function requireStorageConfig() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required for file operations.");
  }
}

function authHeaders(extra = {}) {
  requireStorageConfig();
  // Current sb_secret_... keys are API keys, not JWTs. Sending them as
  // Authorization: Bearer causes "Invalid JWT" on Supabase. Legacy
  // service_role keys are JWTs and can still be supplied as Bearer tokens.
  const headers = { apikey: SUPABASE_SECRET_KEY };
  if (!SUPABASE_SECRET_KEY.startsWith("sb_secret_")) {
    headers.Authorization = `Bearer ${SUPABASE_SECRET_KEY}`;
  }
  return { ...headers, ...extra };
}

function encodedPath(value) {
  return String(value || "").split("/").map(encodeURIComponent).join("/");
}

async function storageRequest(path, { method = "GET", headers = {}, body, json = false, ok = [200, 201] } = {}) {
  requireStorageConfig();
  const res = await fetch(`${SUPABASE_URL}/storage/v1${path}`, {
    method,
    headers: authHeaders({ ...(json ? { "Content-Type": "application/json" } : {}), ...headers }),
    body: json && body !== undefined ? JSON.stringify(body) : body,
  });
  if (!ok.includes(res.status)) {
    const raw = await res.text().catch(() => "");
    let message = raw;
    try { message = JSON.parse(raw)?.message || JSON.parse(raw)?.error || raw; } catch {}
    const e = new Error(`supabase_storage_${res.status}: ${message || res.statusText}`);
    e.status = res.status;
    throw e;
  }
  return res;
}

export const STORAGE_BUCKETS = {
  avatar: "avatars",
  verification: "verification-photos",
  "parking-receipt": "parking-receipts",
};

export function parseImageDataUrl(dataUrl) {
  const s = String(dataUrl || "");
  const m = s.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i);
  if (!m) throw new Error("invalid_image_data");
  const mime = m[1].toLowerCase();
  const ext = m[2].toLowerCase() === "jpeg" ? "jpg" : m[2].toLowerCase();
  const buffer = Buffer.from(m[3], "base64");
  if (!buffer.length) throw new Error("invalid_image_data");
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error("image_too_large");
  return { mime, ext, buffer, size: buffer.length };
}

export function makeStorageRef(bucket, objectPath) {
  return `storage://${bucket}/${objectPath}`;
}

export function parseStorageRef(ref) {
  const s = String(ref || "");
  const m = s.match(/^storage:\/\/([^/]+)\/(.+)$/);
  return m ? { bucket: m[1], objectPath: m[2] } : null;
}

export function fileApiPath(ref) {
  const parsed = parseStorageRef(ref);
  if (!parsed) return ref || "";
  return `/files/${encodeURIComponent(parsed.bucket)}/${encodedPath(parsed.objectPath)}`;
}

export async function uploadBuffer(buffer, { bucket, objectPath, contentType, upsert = true } = {}) {
  if (!bucket || !objectPath || !Buffer.isBuffer(buffer)) throw new Error("invalid_storage_upload");
  await storageRequest(`/object/${encodeURIComponent(bucket)}/${encodedPath(objectPath)}`, {
    method: "POST",
    headers: {
      "Content-Type": contentType || "application/octet-stream",
      "x-upsert": upsert ? "true" : "false",
      "cache-control": bucket === "avatars" ? "max-age=3600" : "no-store",
    },
    body: buffer,
    ok: [200, 201],
  });
  return makeStorageRef(bucket, objectPath);
}

export async function uploadImageDataUrl(dataUrl, { kind, ownerUserId, jobId, deterministicName } = {}) {
  const parsed = parseImageDataUrl(dataUrl);
  const bucket = STORAGE_BUCKETS[kind];
  if (!bucket) throw new Error("unsupported_storage_kind");
  const owner = String(ownerUserId || "unowned").replace(/[^a-zA-Z0-9_-]/g, "_");
  const scope = jobId ? `${String(jobId).replace(/[^a-zA-Z0-9_-]/g, "_")}/` : "";
  const name = deterministicName || `${Date.now()}-${randomId("", 8)}.${parsed.ext}`;
  const objectPath = `${scope}${owner}/${name}`;
  await uploadBuffer(parsed.buffer, { bucket, objectPath, contentType: parsed.mime, upsert: !!deterministicName });
  return { ref: makeStorageRef(bucket, objectPath), bucket, objectPath, mime: parsed.mime, size: parsed.size };
}

export async function removeStoredFile(ref) {
  const parsed = parseStorageRef(ref);
  if (!parsed) return false;
  try {
    await storageRequest(`/object/${encodeURIComponent(parsed.bucket)}`, {
      method: "DELETE",
      json: true,
      body: { prefixes: [parsed.objectPath] },
      ok: [200],
    });
    return true;
  } catch (e) {
    console.warn("[storage] delete failed", parsed.bucket, parsed.objectPath, e.message);
    return false;
  }
}

export async function createSignedUrl(ref, expiresIn = 300) {
  const parsed = parseStorageRef(ref);
  if (!parsed) return ref || "";
  if (parsed.bucket === "avatars") {
    return `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(parsed.bucket)}/${encodedPath(parsed.objectPath)}`;
  }
  try {
    const res = await storageRequest(`/object/sign/${encodeURIComponent(parsed.bucket)}/${encodedPath(parsed.objectPath)}`, {
      method: "POST", json: true, body: { expiresIn: Number(expiresIn) || 300 }, ok: [200],
    });
    const data = await res.json();
    const signed = data?.signedURL || data?.signedUrl || "";
    return signed ? (signed.startsWith("http") ? signed : `${SUPABASE_URL}/storage/v1${signed}`) : fileApiPath(ref);
  } catch {
    return fileApiPath(ref);
  }
}

export async function downloadStoredFile(ref) {
  const parsed = parseStorageRef(ref);
  if (!parsed) throw new Error("invalid_storage_ref");
  const res = await storageRequest(`/object/authenticated/${encodeURIComponent(parsed.bucket)}/${encodedPath(parsed.objectPath)}`, { ok: [200] });
  return {
    buffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") || "application/octet-stream",
    ...parsed,
  };
}

export async function ensureBuckets() {
  const desired = [
    { id: "avatars", public: true },
    { id: "verification-photos", public: false },
    { id: "parking-receipts", public: false },
  ];
  const listRes = await storageRequest("/bucket", { ok: [200] });
  const buckets = await listRes.json();
  const existing = new Map((Array.isArray(buckets) ? buckets : []).map((b) => [b.id || b.name, b]));
  for (const item of desired) {
    if (!existing.has(item.id)) {
      await storageRequest("/bucket", {
        method: "POST", json: true,
        body: { id: item.id, name: item.id, public: item.public, file_size_limit: MAX_IMAGE_BYTES, allowed_mime_types: ["image/png", "image/jpeg", "image/webp"] },
        ok: [200, 201],
      });
    } else if (!!existing.get(item.id)?.public !== item.public) {
      await storageRequest(`/bucket/${encodeURIComponent(item.id)}`, {
        method: "PUT", json: true,
        body: { public: item.public, file_size_limit: MAX_IMAGE_BYTES, allowed_mime_types: ["image/png", "image/jpeg", "image/webp"] },
        ok: [200],
      });
    }
  }
}
