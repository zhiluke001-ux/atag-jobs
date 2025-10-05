'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage(){
  const [email,setEmail]=useState('');
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState<string|undefined>();
  const router = useRouter();

  async function onSubmit(e:React.FormEvent){
    e.preventDefault();
    if(!email.trim()) return;
    setBusy(true); setErr(undefined);
    try{
      // 1) Log in (sets cookie)
      const r = await fetch('/api/auth/login', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        credentials:'include',
        body: JSON.stringify({ email: email.trim() })
      });
      if(!r.ok){ throw new Error('Login failed'); }

      // 2) Ask who I am, then redirect by role (no AuthProvider dependency)
      const me = await fetch('/api/auth/me', { credentials:'include' });
      const j  = await me.json();
      const role = j?.user?.role as 'PART_TIMER'|'PM'|'ADMIN'|undefined;

      if (role === 'PART_TIMER') {
        router.replace('/available');
      } else {
        // PM or ADMIN (change to '/pm/jobs' if you prefer)
        router.replace('/dashboard');
      }
    } catch (e:any){
      setErr(e?.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card elevated centered">
      <h3>Log In</h3>
      <p className="kv">
        Try: <code>alice@example.com</code> (PART_TIMER), <code>pm@example.com</code> (PM), <code>admin@example.com</code> (ADMIN)
      </p>
      {err && <div className="kv" style={{color:'#b60603',marginTop:8}}>Error: {err}</div>}
      <form o
