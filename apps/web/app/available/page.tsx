// apps/web/app/available/page.tsx
'use client';

import { useEffect, useState } from 'react';

type Job = {
  id: string;
  title: string;
  venue?: string | null;
  callTimeUtc: string; // ISO
  endTimeUtc?: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'CLOSED';
};

export default function AvailableJobsPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/jobs', {
          method: 'GET',
          credentials: 'include',
          cache: 'no-store',
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setErr(`Failed to load jobs (${res.status})${body?.error ? `: ${body.error}` : ''}`);
          setJobs([]);
          return;
        }
        const data: Job[] = await res.json();
        setJobs(data);
      } catch (e: any) {
        setErr(e?.message || 'Network error');
        setJobs([]);
      }
    })();
  }, []);

  if (err) {
    return (
      <div className="max-w-xl mx-auto p-6">
        <h1 className="text-xl font-semibold mb-2">Available Jobs</h1>
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm">
          {err}
        </div>
      </div>
    );
  }

  if (jobs === null) {
    return (
      <div className="max-w-xl mx-auto p-6">
        <h1 className="text-xl font-semibold mb-2">Available Jobs</h1>
        <p className="text-sm opacity-70">Loading…</p>
      </div>
    );
  }

  if (jobs.length === 0) {
    return (
      <div className="max-w-xl mx-auto p-6">
        <h1 className="text-xl font-semibold mb-2">Available Jobs</h1>
        <p className="text-sm opacity-70">No open jobs right now.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <h1 className="text-xl font-semibold">Available Jobs</h1>
      {jobs.map((j) => {
        const start = new Date(j.callTimeUtc);
        const end = j.endTimeUtc ? new Date(j.endTimeUtc) : null;
        const fmt = (d: Date) =>
          d.toLocaleString(undefined, {
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: '2-digit',
          });
        return (
          <div key={j.id} className="rounded-xl border p-4">
            <div className="flex items-center justify-between">
              <div className="font-medium">{j.title}</div>
              <span className="text-xs rounded-full px-2 py-1 border">
                {j.status}
              </span>
            </div>
            <div className="text-sm mt-2">
              <div>Venue: {j.venue || '-'}</div>
              <div>
                Time: {fmt(start)}{end ? ` — ${fmt(end)}` : ''}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
