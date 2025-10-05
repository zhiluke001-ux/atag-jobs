import { cookies } from 'next/headers';
import { randomBytes } from 'crypto';

const CSRF_COOKIE = 'csrf';

export function getCsrf() {
  return cookies().get(CSRF_COOKIE)?.value || '';
}

export async function ensureCsrf() {
  let token = cookies().get(CSRF_COOKIE)?.value;
  if (!token) {
    token = randomBytes(16).toString('hex');
    cookies().set(CSRF_COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/' });
  }
  return token;
}

export function verifyCsrf(header?: string | null) {
  const token = getCsrf();
  return !!token && !!header && token === header;
}
