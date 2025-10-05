'use client';
import React, { createContext, useContext, useEffect, useState } from 'react';

export type Role = 'PART_TIMER' | 'PM' | 'ADMIN';
export type UserRecord = { id: string; name: string; role: Role; email: string };
type User = UserRecord | null;

type AuthCtx = {
  user: User;
  loading: boolean;
  csrf: string | null;
  // NOTE: return the logged-in user or null
  login: (email: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null,
  loading: true,
  csrf: null,
  // default implementation to satisfy TS at runtime
  login: async () => null,
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
    (async () => {
      await refresh();
    })();
  }, []);

  async function login(email: string): Promise<User> {
    const r = await fetch(api('/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email }),
    });
    const j = await r.json();
    await refresh();
    // return the user we just logged in as
    return (j?.user as User) ?? null;
  }

  async function logout() {
    await fetch(api('/auth/logout'), {
      method: 'POST',
      headers: { 'x-csrf-token': csrf || '' },
      credentials: 'include',
    });
    setUser(null);
    setCsrf(null);
    await fetchMe();
  }

  return (
    <Ctx.Provider value={{ user, loading, csrf, login, logout, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
