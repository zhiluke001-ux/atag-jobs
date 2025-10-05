'use client';
import { useState } from 'react';
import { useAuth } from '../../components/Auth';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;
    setBusy(true);
    try {
      await login(value);
      router.replace('/dashboard');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ maxWidth: 520, margin: '0 auto' }}>
      <h3>Log In</h3>
      <p className="kv">
        Try: <code>alice@example.com</code> (PART_TIMER), <code>pm@example.com</code>,{' '}
        <code>admin@example.com</code>
      </p>
      <form onSubmit={onSubmit} className="row" style={{ marginTop: 10 }}>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          style={{
            flex: 1,
            padding: 10,
            border: '1px solid var(--border)',
            borderRadius: 8,
          }}
        />
        <button className="btn primary" disabled={busy || !email.trim()}>
          {busy ? 'Logging in…' : 'Log In'}
        </button>
      </form>
    </section>
  );
}
