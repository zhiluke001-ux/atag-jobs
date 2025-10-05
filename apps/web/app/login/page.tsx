'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Role = 'PART_TIMER' | 'PM' | 'ADMIN';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>('');
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setErr('');
    try {
      // 1) Log in (sets cookie)
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(t || `Login failed (${r.status})`);
      }

      // 2) Read current user & redirect by role
      const me = await fetch('/api/auth/me', { credentials: 'include' })
        .then(x => x.json())
        .catch(() => null);
      const role = (me?.user?.role ?? '') as Role;

      if (role === 'PART_TIMER') router.replace('/available');
      else router.replace('/dashboard'); // PM or ADMIN
    } catch (e: any) {
      setErr(e?.message || 'Login error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card elevated centered">
      <h3>Log In</h3>
      {err && <div className="kv" style={{ color: '#b60603' }}>Error: {err}</div>}
      <p className="kv" style={{ marginTop: 6 }}>
        Try: <code>alice@example.com</code> (PART_TIMER), <code>pm@example.com</code> (PM), <code>admin@example.com</code> (ADMIN)
      </p>
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
  );
}
