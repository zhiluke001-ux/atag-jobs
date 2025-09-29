'use client';
import { useEffect, useState } from 'react';

type Job = { id:string; title:string; callTimeUtc:string; venue:string };

const API = () => (process.env.NEXT_PUBLIC_API_URL?.trim() || `${location.protocol}//${location.hostname}:4000`).replace(/\/+$/,'');

export default function AdminAttendance(){
  const [jobs,setJobs]=useState<Job[]>([]);
  useEffect(()=>{ (async()=>{ const r=await fetch(`${API()}/jobs`); if(r.ok) setJobs(await r.json()); })(); },[]);
  return (
    <section className="card">
      <h2>Attendance Records</h2>
      <div className="grid" style={{gridTemplateColumns:'repeat(12,1fr)',gap:14,marginTop:10}}>
        {jobs.map(j=>(
          <div key={j.id} className="card" style={{gridColumn:'span 6'}}>
            <div style={{fontWeight:700}}>{j.title}</div>
            <div className="kv">{j.venue} · {new Date(j.callTimeUtc).toLocaleString()}</div>
            <a className="btn" href={`/attendance/today/${j.id}`}>Open Today</a>
          </div>
        ))}
        {!jobs.length && <div className="kv" style={{gridColumn:'span 12'}}>No jobs.</div>}
      </div>
    </section>
  );
}
