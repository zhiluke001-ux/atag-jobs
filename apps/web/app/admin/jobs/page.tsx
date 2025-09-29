'use client';
import { useEffect, useState } from 'react';

type Job = { id:string; title:string; venue:string; jobType:string; callTimeUtc:string; endTimeUtc?:string|null };

const API = () => (process.env.NEXT_PUBLIC_API_URL?.trim() || `${location.protocol}//${location.hostname}:4000`).replace(/\/+$/,'');

export default function AdminJobs(){
  const [jobs,setJobs]=useState<Job[]>([]);
  useEffect(()=>{ (async()=>{ const r=await fetch(`${API()}/jobs`); if(r.ok) setJobs(await r.json()); })(); },[]);
  return (
    <section className="card">
      <h2>Jobs Management</h2>
      <div className="grid" style={{gridTemplateColumns:'repeat(12,1fr)',gap:14,marginTop:10}}>
        {jobs.map(j=>(
          <div key={j.id} className="card" style={{gridColumn:'span 6'}}>
            <div style={{display:'flex',justifyContent:'space-between'}}>
              <div>
                <div style={{fontWeight:700}}>{j.title}</div>
                <div className="kv">{j.venue}</div>
                <div className="kv">{new Date(j.callTimeUtc).toLocaleString()}</div>
              </div>
              <span className="badge">{j.jobType}</span>
            </div>
            <div className="row" style={{marginTop:10}}>
              <a className="btn" href={`/attendance/today/${j.id}`}>Today’s Attendance</a>
            </div>
          </div>
        ))}
        {!jobs.length && <div className="kv" style={{gridColumn:'span 12'}}>No jobs.</div>}
      </div>
    </section>
  );
}
