'use client';
import { useAuth } from '../components/Auth';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard');
  }, [loading, user, router]);

  return (
    <section className="card" style={{ maxWidth: 860, margin: '0 auto' }}>
      <h2>Welcome to ATAG Jobs</h2>
      <p className="kv">
        Lightweight system to hire part-timers per event, approve applicants, and capture attendance
        with secure, single-use QR codes synced to Google Sheets.
      </p>
      <div className="row" style={{marginTop:10}}>
        <a className="btn primary" href={user ? '/dashboard' : '/available'}>{user?'Go to Dashboard':'Browse Jobs'}</a>
        {!user && <a className="btn" href="/login">Log In</a>}
      </div>
    </section>
  );
}
