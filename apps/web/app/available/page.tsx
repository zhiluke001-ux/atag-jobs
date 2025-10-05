'use client';
import { useEffect, useState } from 'react';
import { formatJobRange } from '@/lib/time';

type Job = {
  id:string; title:string; venue:string; jobType:string;
  callTimeUtc:string; endTimeUtc?:string|null; status:string
};

export default function AvailablePage(){
  const [jobs,setJobs]=useState<Job[]>([]);
  const [err,setErr]=useState<string|undefined>();

  useEffect(()=>{ (async()=>{
    try{
      const r=await fetch('/api/jobs',{credentials:'include'});
      if(!r.ok) {
        const txt = await r.text().catch(()=> '');
        throw new Error(`Fetching jobs failed (${r.status}). ${txt || ''}`.trim());
      }
      setJobs(await r.json());
    }catch(e:any){ setErr(e?.message||'Failed to fetch'); }
  })(); },[]);

  return (
    <div className="container" style={{marginTop:16}}>
      <section className="card">
        <h2>Available Jobs</h2>
        {err && <div className="kv" style={{color:'#b60603',marginTop:8}}>Error: {err}</div>}
        <div className="grid cards" style={{marginTop:10}}>
          {jobs.map(j=>(
            <div key={j.id} className="card" style={{gridColumn:'span 6'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'start'}}>
                <div>
                  <div style={{fontWeight:700}}>{j.title}</div>
                  <div className="kv">{j.venue}</div>
                  <div className="kv">{formatJobRange(j.callTimeUtc, j.endTimeUtc||undefined)}</div>
                </div>
                <span className="badge">{j.jobType}</span>
              </div>
              <div className="row" style={{marginTop:10}}>
                <a className="btn primary" href={`/jobs/${j.id}`}>View & Apply</a>
              </div>
            </div>
          ))}
          {(!jobs.length && !err) && <div className="kv" style={{gridColumn:'span 12'}}>No open jobs right now.</div>}
        </div>
      </section>
    </div>
  );
}
