'use client';
import React, { createContext, useContext, useEffect, useState } from 'react';

export type Role = 'PART_TIMER' | 'PM' | 'ADMIN';
export type UserRecord = { id: string; name: string; role: Role; email: string };
type User = UserRecord | null;

type AuthCtx = {
  user: User;
  loading: boolean;
  csrf: string | null;
  // KEEP: we don't rely on a return value from login
  login: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null,
  loading: true,
  csrf: null,
  login: async () => {},
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

  // EXPLICITLY return void so inference can't drift
  async function login(email: string): Promise<void> {
    await fetch(api('/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email }),
    });
    await refresh();
    return; // ensure Promise<void>
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

  // Make TS verify the shape exactly
  const value: AuthCtx = { user, loading, csrf, login, logout, refresh };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
