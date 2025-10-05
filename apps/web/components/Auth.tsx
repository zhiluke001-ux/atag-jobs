'use client';
import React, { createContext, useContext, useEffect, useState } from 'react';

type Role = 'PART_TIMER' | 'PM' | 'ADMIN';
type AuthUser = { id: string; name: string; role: Role; email: string } | null;

type AuthCtx = {
  user: AuthUser;
  loading: boolean;
  csrf: string | null;
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
  const [user, setUser] = useState<AuthUser>(null);
  const [csrf, setCsrf] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMe: AuthCtx['refresh'] = async () => {
    try {
      const r = await fetch(api('/auth/me'), { credentials: 'include' });
      const j = await r.json();
      setUser(j?.user || null);
    } catch {
      setUser(null);
    }
  };

  const fetchCsrf: AuthCtx['refresh'] = async () => {
    try {
      const r = await fetch(api('/auth/csrf'), { credentials: 'include' });
      if (r.ok) {
        const j = await r.json();
        setCsrf(j?.token || null);
      }
    } catch {}
  };

  const refresh: AuthCtx['refresh'] = async () => {
    await fetchMe();
    await fetchCsrf();
    setLoading(false);
  };

  useEffect(() => { (async () => { await refresh(); })(); }, []);

  const login: AuthCtx['login'] = async (email: string) => {
    await fetch(api('/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email }),
    });
    await refresh();
  };

  const logout: AuthCtx['logout'] = async () => {
    await fetch(api('/auth/logout'), {
      method: 'POST',
      headers: { 'x-csrf-token': csrf || '' },
      credentials: 'include',
    });
    setUser(null);
    setCsrf(null);
    await fetchMe();
  };

  return (
    <Ctx.Provider value={{ user, loading, csrf, login, logout, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() { return useContext(Ctx); }
