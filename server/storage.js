// server/storage.js
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import { Pool } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FILE = path.join(__dirname, "db.json");

// If DATABASE_URL is set, use Postgres; otherwise fall back to the file (dev).
const usePG = !!process.env.DATABASE_URL;
let pool = null;

if (usePG) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Most free Postgres providers require SSL; Render/Supabase/Neon are ok with this:
    ssl: { rejectUnauthorized: false },
  });
}

/**
 * Load the whole DB object.
 *  - File mode: read server/db.json
 *  - PG mode:   read single-row kv(k='db') JSONB, seed from file if empty
 */
export async function loadDB() {
  if (!usePG) {
    return fs.readJSON(FILE);
  }

  await pool.query(`
    create table if not exists kv (
      k text primary key,
      v jsonb not null
    )
  `);

  const { rows } = await pool.query("select v from kv where k = $1", ["db"]);
  if (rows.length) return rows[0].v;

  // Seed from local file if exists, else minimal object
  let seed = { config: {}, users: [], jobs: [], audit: [] };
  try {
    seed = await fs.readJSON(FILE);
  } catch {}
  await pool.query("insert into kv(k, v) values ($1, $2)", ["db", seed]);
  return seed;
}

/**
 * Save the whole DB object.
 *  - File mode: write server/db.json
 *  - PG mode:   upsert kv(k='db') with JSONB
 */
export async function saveDB(db) {
  if (!usePG) {
    await fs.writeJSON(FILE, db, { spaces: 2 });
    return true;
  }
  await pool.query(
    "insert into kv(k, v) values ($1, $2) on conflict (k) do update set v = excluded.v",
    ["db", db]
  );
  return true;
}
