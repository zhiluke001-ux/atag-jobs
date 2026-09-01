import crypto from "crypto";

export function hashPassword(password) {
  const iterations = 150000;
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.pbkdf2Sync(String(password), salt, iterations, 32, "sha256").toString("hex");
  return `pbkdf2_sha256$${iterations}$${salt}$${derived}`;
}

export function verifyPassword(password, encoded) {
  try {
    const [algo, iterStr, salt, hash] = String(encoded || "").split("$");
    if (algo !== "pbkdf2_sha256") return false;
    const iterations = Number.parseInt(iterStr, 10);
    if (!Number.isFinite(iterations) || !salt || !hash) return false;
    const derived = crypto.pbkdf2Sync(String(password), salt, iterations, 32, "sha256").toString("hex");
    const a = Buffer.from(derived, "hex"), b = Buffer.from(hash, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

export function randomId(prefix = "", bytes = 8) {
  const token = crypto.randomBytes(Math.max(4, Number(bytes) || 8)).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, Math.max(6, Number(bytes) || 8)).toLowerCase();
  return `${prefix || ""}${token}`;
}

export function stableRequestHash(value) {
  const seen = new WeakSet();
  const stable = (v) => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return "[Circular]";
    seen.add(v);
    if (Array.isArray(v)) return v.map(stable);
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  };
  return sha256(JSON.stringify(stable(value)));
}
