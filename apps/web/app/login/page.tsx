'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { loginAndGetRole } from '@/lib/authClient';

export default function LoginPage(){
  const [email,setEmail]=useState('');
  const [busy,setBusy]=useState(false);
  const router = useRouter();

  async function onSubmit(e:React.FormEvent){
    e.preventDefault();
    if(!email.trim()) return;
    setBusy(true);
    try{
      const role = await loginAndGetRole(email.trim());
      if (role === 'PART_TIMER') router.replace('/available');
      else router.replace('/dashboard'); // PM/ADMIN
    } finally { setBusy(false); }
  }

  return (
    <section className="card elevated centered">
      <h3>Log In</h3>
      <p className="kv">
        Try: <code>alice@example.com</code> (PART_TIMER), <code>pm@example.com</code> (PM), <code>admin@example.com</code> (ADMIN)
      </p>
      <form onSubmit={onSubmit} className="row" style={{marginTop:10}}>
        <input
          value={email}
          onChange={e=>setEmail(e.target.value)}
          placeholder="you@example.com"
          style={{flex:1,padding:10,border:'1px solid var(--border)',borderRadius:8}}
        />
        <button className="btn primary" disabled={busy||!email.trim()}>
          {busy?'Logging in…':'Log In'}
        </button>
      </form>
    </section>
  );
}
