'use client';
import React, { createContext, useContext, useEffect, useState } from 'react';

type Role = 'PART_TIMER' | 'PM' | 'ADMIN';
type User = { id: string; name: string; role: Role; email: string } | null;

type AuthCtx = {
  user: User;
  csrf: string | null;
  loading: boolean;
  login: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null,
  csrf: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
  refresh: async () => {},
});

const apiBase = () => ""; // same-origin API routes


export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [csrf, setCsrf] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const [m, c] = await Promise.all([
        fetch(`${apiBase()}/auth/me`, { credentials: 'include' }),
        fetch(`${apiBase()}/auth/csrf`, { credentials: 'include' }),
      ]);
      const mj = await m.json().catch(() => ({}));
      const cj = await c.json().catch(() => ({}));
      setUser(mj?.user || null);
      setCsrf(cj?.token || null);
    } catch {
      setUser(null);
      setCsrf(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  async function login(email: string) {
    const clean = email.trim();
    if (!clean) throw new Error('Email required');
    const r = await fetch(`${apiBase()}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf || '' },
      credentials: 'include',
      body: JSON.stringify({ email: clean }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j?.error || 'Login failed');
    }
    await refresh();
  }

  async function logout() {
    // Fire-and-forget to avoid visible “flash”; we’ll optimistically clear state, then await.
    setUser(null);
    const r = await fetch(`${apiBase()}/auth/logout`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrf || '' },
      credentials: 'include',
    }).catch(() => null);
    // Regardless of result, refresh will re-sync cookie state (cookie cleared server-side).
    await refresh();
  }

  return (
    <Ctx.Provider value={{ user, csrf, loading, login, logout, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
