import { Pool } from "pg";

const DATABASE_URL = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("SUPABASE_DATABASE_URL or DATABASE_URL is required. The normalized backend no longer supports server/db.json or the legacy kv store.");
}

export const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false },
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10000),
});

pool.on("error", (err) => {
  console.error("[postgres pool] idle client error", err);
});

export async function query(text, params = []) {
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

export async function healthCheck() {
  const started = Date.now();
  await pool.query("SELECT 1 AS ok");
  return { ok: true, latencyMs: Date.now() - started };
}

export async function closePool() {
  await pool.end();
}
