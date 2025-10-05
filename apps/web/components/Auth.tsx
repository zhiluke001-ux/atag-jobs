'use client';
import React, { createContext, useContext, useEffect, useState } from 'react';

type Role = 'PART_TIMER'|'PM'|'ADMIN';
type User = { id:string; name:string; role:Role; email:string } | null;

type AuthCtx = {
  user: User;
  loading: boolean;
  csrf: string | null;
  login: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx>({
  user: null, loading: true, csrf: null,
  login: async () => {}, logout: async () => {}, refresh: async () => {}
});

const apiBase = () => '/api'; // <<< important: single API

export function AuthProvider({ children }:{children:React.ReactNode}){
  const [user,setUser]  = useState<User>(null);
  const [csrf,setCsrf]  = useState<string|null>(null);
  const [loading,setLoading] = useState(true);

  async function fetchMe(){
    try{
      const r = await fetch(`${apiBase()}/auth/me`, { credentials:'include' });
      const j = await r.json();
      setUser(j?.user || null);
    }catch{ setUser(null); }
  }

  async function fetchCsrf(){
    try{
      const r = await fetch(`${apiBase()}/auth/csrf`, { credentials:'include' });
      if (r.ok){ const j = await r.json(); setCsrf(j?.token || null); }
    }catch{}
  }

  async function refresh(){ await fetchMe(); await fetchCsrf(); setLoading(false); }

  useEffect(()=>{ (async()=>{ await refresh(); })(); },[]);

  async function login(email:string){
    await fetch(`${apiBase()}/auth/login`,{
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      credentials:'include',
      body: JSON.stringify({ email })
    });
    await refresh();
  }

  async function logout(){
    await fetch(`${apiBase()}/auth/logout`,{
      method:'POST',
      headers:{ 'x-csrf-token': csrf || '' },
      credentials:'include'
    });
    setUser(null); setCsrf(null);
    await fetchMe();
  }

  return <Ctx.Provider value={{user,loading,csrf,login,logout,refresh}}>{children}</Ctx.Provider>;
}

export function useAuth(){ return useContext(Ctx); }
