import { cookies } from "next/headers";
import { redis } from "./redis";
import { randomUUID } from "crypto";

const CSRF_PREFIX = "csrf:";
const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || "21600");

export async function ensureCsrf(uid: string) {
  const k = `${CSRF_PREFIX}${uid}`;
  const existing = await redis.get<string>(k);
  if (existing) return existing;
  const token = randomUUID();
  await redis.set(k, token, { ex: SESSION_TTL_SECONDS });
  return token;
}

export async function getCsrf(uid: string) {
  return (await redis.get<string>(`${CSRF_PREFIX}${uid}`)) || null;
}

export async function requireCsrf(req: Request) {
  if (process.env.NODE_ENV !== "production") return true;
  const cookieStore = cookies();
  const uid = cookieStore.get("uid")?.value;
  if (!uid) return false;
  const sent = req.headers.get("x-csrf-token")?.trim() || "";
  const expected = await getCsrf(uid);
  return !!expected && sent === expected;
}
