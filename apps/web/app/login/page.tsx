'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;

    setBusy(true);
    setErr(null);

    try {
      // 1) Log in (sets HttpOnly cookie)
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: value }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(t || 'Login failed');
      }

      // 2) Read role → redirect (keeps this page independent of AuthProvider)
      const me = await fetch('/api/auth/me', { credentials: 'include' });
      const j = await me.json();
      const role = j?.user?.role as 'PART_TIMER' | 'PM' | 'ADMIN' | undefined;

      if (role === 'PART_TIMER') router.replace('/available');
      else router.replace('/dashboard'); // change to '/pm/jobs' if you prefer for PM/ADMIN
    } catch (e: any) {
      setErr(e?.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ marginTop: 16 }}>
      <section className="card elevated centered">
        <h3>Log In</h3>
        <p className="kv">
          Try: <code>alice@example.com</code> (PART_TIMER), <code>pm@example.com</code> (PM),
          <code>admin@example.com</code> (ADMIN)
        </p>
        {err && <div className="kv" style={{ color: '#b60603', marginTop: 8 }}>Error: {err}</div>}
        <form onSubmit={onSubmit} className="row" style={{ marginTop: 10 }}>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={{ flex: 1, padding: 10, border: '1px solid var(--border)', borderRadius: 8 }}
          />
          <button className="btn primary" disabled={busy || !email.trim()}>
            {busy ? 'Logging in…' : 'Log In'}
          </button>
        </form>
      </section>
    </div>
  );
}
