import { cookies } from 'next/headers';
import crypto from 'crypto';

const CSRF_COOKIE = 'csrf';
export function getCsrf(){
  const v = cookies().get(CSRF_COOKIE)?.value;
  return v || null;
}
export function ensureCsrf(){
  let v = getCsrf();
  if (!v){
    v = crypto.randomBytes(20).toString('hex');
    cookies().set(CSRF_COOKIE, v, { httpOnly:false, secure:true, sameSite:'lax', path:'/' });
  }
  return v;
}
export function verifyCsrf(header?:string|null){
  const t = header || '';
  const v = getCsrf() || '';
  return t && v && t === v;
}
