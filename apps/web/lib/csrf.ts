// apps/web/lib/csrf.ts
import { Redis } from '@upstash/redis';

const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null;

// Fallback in dev if no Redis is configured
const mem = new Map<string, { v: string; exp: number }>();

const CSRF_TTL_SECONDS = 6 * 60 * 60; // 6h
const key = (uid: string) => `csrf:${uid}`;

function rnd(): string {
  // 32-byte URL-safe token
  const a = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && 'getRandomValues' in crypto) {
    crypto.getRandomValues(a);
  } else {
    // node fallback
    const { randomBytes } = require('crypto');
    const b: Buffer = randomBytes(32);
    b.forEach((v, i) => (a[i] = v));
  }
  return Buffer.from(a).toString('base64url');
}

export async function ensureCsrf(uid: string): Promise<string> {
  if (!uid) throw new Error('uid required');

  const existing = await getCsrf(uid);
  if (existing) return existing;

  const token = rnd();

  if (redis) {
    await redis.setex(key(uid), CSRF_TTL_SECONDS, token);
  } else {
    mem.set(key(uid), { v: token, exp: Date.now() + CSRF_TTL_SECONDS * 1000 });
  }
  return token;
}

export async function getCsrf(uid: string): Promise<string | null> {
  if (!uid) return null;

  if (redis) {
    const v = await redis.get<string>(key(uid));
    return v ?? null;
  } else {
    const entry = mem.get(key(uid));
    if (!entry) return null;
    if (entry.exp < Date.now()) {
      mem.delete(key(uid));
      return null;
    }
    return entry.v;
  }
}

/**
 * Simple checker for route handlers.
 * Usage:
 *   const ok = await verifyCsrf(req, userId)
 *   if (!ok) return NextResponse.json({ error: 'csrf_invalid' }, { status: 403 })
 */
export async function verifyCsrf(req: Request, uid: string | null | undefined): Promise<boolean> {
  if (!uid) return false;
  // In development you might skip; keep strict in prod
  if (process.env.NODE_ENV !== 'production') return true;

  const expected = await getCsrf(uid);
  const sent = (req.headers.get('x-csrf-token') || '').trim();
  return !!expected && !!sent && sent === expected;
}
