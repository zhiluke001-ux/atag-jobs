// server/storage.js
import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import { Pool } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FILE = path.join(__dirname, "db.json");

// If DATABASE_URL is set, use Postgres; else fall back to the file (dev).
const usePG = !!process.env.DATABASE_URL;
let pool = null;
if (usePG) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // required by many free tiers
  });
}

export async function loadDB() {
  if (!usePG) return fs.readJSON(FILE);

  await pool.query(`create table if not exists kv (
    k text primary key,
    v jsonb not null
  )`);
  const { rows } = await pool.query("select v from kv where k = $1", ["db"]);
  if (rows.length) return rows[0].v;

  // Seed once from local file if table empty
  const seed = await fs.readJSON(FILE);
  await pool.query("insert into kv(k,v) values($1,$2)", ["db", seed]);
  return seed;
}

export async function saveDB(db) {
  if (!usePG) return fs.writeJSON(FILE, db, { spaces: 2 });
  await pool.query(
    "insert into kv(k,v) values($1,$2) on conflict (k) do update set v = excluded.v",
    ["db", db]
  );
  return true;
}
