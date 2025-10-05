'use client';
import { useAuth } from '@/components/Auth';
import { useEffect, useState } from 'react';
import { formatJobRange } from '@/lib/time';

type Job = { id:string; title:string; venue:string; jobType:string; callTimeUtc:string; endTimeUtc?:string|null; status:'PUBLISHED'|'DRAFT'|'CLOSED' };
type ApplicantRow = { id:string; status:string };

const API = (p:string) => `/api${p}`;

export default function Dashboard(){
  const { user } = useAuth();
  const [jobs,setJobs]=useState<Job[]>([]);
  const [appCounts,setAppCounts]=useState<Record<string,number>>({});

  useEffect(()=>{ (async()=>{
    if (!user) return;
    if (user.role==='PM' || user.role==='ADMIN') {
      const r=await fetch(API('/jobs'),{credentials:'include'}); const js:Job[]=await r.json(); setJobs(js);
      const counts:Record<string,number> = {};
      await Promise.all(js.map(async j=>{
        const resp=await fetch(API(`/jobs/${j.id}/applicants`),{credentials:'include'});
        if(resp.ok){ const a:ApplicantRow[]=await resp.json(); counts[j.id]=a.length; }
      }));
      setAppCounts(counts);
    }
  })(); },[user]);

  if (!user) {
    return (
      <section className="card" style={{maxWidth:860,margin:'0 auto'}}>
        <h2>Welcome to ATAG Jobs</h2>
        <p className="kv">Hire, approve, and track event part-timers with secure, single-use QR attendance.</p>
        <div className="row" style={{marginTop:10}}>
          <a className="btn primary" href="/available">Browse Jobs</a>
          <a className="btn" href="/login">Log In</a>
        </div>
      </section>
    );
  }

  if (user.role==='PM' || user.role==='ADMIN') {
    const ongoing = jobs.filter(j=>j.status==='PUBLISHED');
    return (
      <section className="grid cards">
        <div className="card" style={{gridColumn:'span 12'}}>
          <h3>Welcome, {user.name}</h3>
          <p className="kv">Quick view of ongoing jobs and total applicants.</p>
        </div>
        {ongoing.map(j=>(
          <div key={j.id} className="card" style={{gridColumn:'span 6'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div>
                <div style={{fontWeight:700}}>{j.title}</div>
                <div className="kv">{j.venue}</div>
                <div className="kv">{formatJobRange(j.callTimeUtc, j.endTimeUtc||undefined)}</div>
              </div>
              <span className="badge">{j.jobType}</span>
            </div>
            <div className="row" style={{marginTop:10}}>
              <a className="btn primary" href={`/attendance/today/${j.id}`}>Today’s Attendance</a>
              <a className="btn" href={`/pm/${j.id}/scan`}>Open Scanner</a>
              <a className="btn" href="/pm/jobs">Manage</a>
            </div>
            <div className="kv" style={{marginTop:8}}>Applicants: <b>{appCounts[j.id] ?? 0}</b></div>
          </div>
        ))}
        {ongoing.length===0 && <div className="hint" style={{gridColumn:'span 12'}}>No ongoing jobs.</div>}
      </section>
    );
  }

  return (
    <section className="grid cards">
      <div className="card" style={{gridColumn:'span 12'}}>
        <h3>Welcome, {user.name}</h3>
        <p className="kv">See open jobs, apply, and check your confirmed assignments.</p>
        <div className="row" style={{marginTop:10}}>
          <a className="btn primary" href="/available">Find Jobs</a>
          <a className="btn" href="/my-jobs">My Jobs</a>
        </div>
      </div>
    </section>
  );
}
