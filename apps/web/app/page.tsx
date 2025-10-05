// apps/web/app/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Me = { id: string; email?: string | null } | null;

export default function Home() {
  const router = useRouter();
  const [me, setMe] = useState<Me | 'loading'>('loading');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/me', {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!res.ok) {
          setMe(null);
          return;
        }
        const data = (await res.json()) as Me;
        setMe(data ?? null);
      } catch {
        setMe(null);
      }
    })();
  }, []);

  useEffect(() => {
    if (me && me !== 'loading') {
      // Only redirect if we have a valid object with an id.
      if (typeof me === 'object' && me?.id) router.replace('/dashboard');
    }
  }, [me, router]);

  return (
    <main className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-semibold">ATAG Jobs</h1>
      {me === 'loading' ? (
        <p className="opacity-70 mt-2">Checking session…</p>
      ) : me && typeof me === 'object' && me.id ? (
        <p className="opacity-70 mt-2">Redirecting…</p>
      ) : (
        <div className="mt-4 space-y-2">
          <a
            href="/login"
            className="inline-block rounded-lg border px-3 py-2"
          >
            Log in
          </a>
          <a
            href="/available"
            className="inline-block rounded-lg border px-3 py-2 ml-2"
          >
            View Available Jobs
          </a>
        </div>
      )}
    </main>
  );
}
