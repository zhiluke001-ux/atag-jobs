'use client';
import React, { createContext, useContext, useEffect, useState } from 'react';

export type Role = 'PART_TIMER' | 'PM' | 'ADMIN';
export type UserRecord = { id: string; name: string; role: Role; email: string };
type User = UserRecord | null;

type AuthCtx = {
  user: User;
  loading: boolean;
  csrf: string | null;
  // Allow either Promise<void> or Promise<User> implementations
  login: (email: string) => Promise<unknown>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null,
  loading: true,
  csrf: null,
  login: async () => {},   // ok: Promise<void>
  logout: async () => {},
  refresh: async () => {},
});

const api = (p: string) => `/api${p}`;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [csrf, setCsrf] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchMe() {
    try {
      const r = await fetch(api('/auth/me'), { credentials: 'include' });
      const j = await r.json();
      setUser((j?.user as User) || null);
    } catch {
      setUser(null);
    }
  }

  async function fetchCsrf() {
    try {
      const r = await fetch(api('/auth/csrf'), { credentials: 'include' });
      if (r.ok) {
        const j = await r.json();
        setCsrf(j?.token || null);
      }
    } catch {}
  }

  async function refresh() {
    await fetchMe();
    await fetchCsrf();
    setLoading(false);
  }

  useEffect(() => {
    (async () => { await refresh(); })();
  }, []);

  // You can return void *or* the user; both satisfy Promise<unknown>
  async function login(email: string): Promise<unknown> {
    const r = await fetch(api('/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email }),
    });
    const j = await r.json().catch(() => null);
    await refresh();
    return j?.user ?? null; // ok even if callers ignore it
  }

  async function logout(): Promise<void> {
    await fetch(api('/auth/logout'), {
      method: 'POST',
      headers: { 'x-csrf-token': csrf || '' },
      credentials: 'include',
    });
    setUser(null);
    setCsrf(null);
    await fetchMe();
  }

  const value: AuthCtx = { user, loading, csrf, login, logout, refresh };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
