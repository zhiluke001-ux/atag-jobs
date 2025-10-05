'use client';
import { useState } from 'react';
import { useAuth } from '@/components/Auth';
import { useRouter } from 'next/navigation';

type Role = 'PART_TIMER' | 'PM' | 'ADMIN';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      // 1) Perform login (we do not depend on its return type)
      await login(email.trim());

      // 2) Fetch current user and redirect by role
      const me = await fetch('/api/auth/me', { credentials: 'include' }).then(r => r.json()).catch(() => null);
      const role = (me?.user?.role ?? '') as Role;

      if (role === 'PART_TIMER') router.replace('/available');
      else router.replace('/dashboard'); // PM or ADMIN
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
