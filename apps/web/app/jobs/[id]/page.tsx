'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '../../../components/Auth';
import { useParams } from 'next/navigation';
import { formatJobRange } from '../../../lib/time';

type Job = { id:string; title:string; venue:string; callTimeUtc:string; endTimeUtc?:string|null; jobType:string };
const API = () => (process.env.NEXT_PUBLIC_API_URL?.trim() || `${location.protocol}//${location.hostname}:4000`).replace(/\/+$/,'');

export default function JobDetails(){
  const params = useParams<{id:string}>(); const id = params.id;
  const { user, csrf } = useAuth();
  const [job,setJob]=useState<Job|null>(null);
  const [transport,setTransport]=useState<'ATAG_BUS'|'OWN'>('OWN');
  const [err,setErr]=useState(''); const [ok,setOk]=useState('');

  useEffect(()=>{ (async()=>{ const r=await fetch(`${API()}/jobs/${id}`,{credentials:'include'}); if(r.ok) setJob(await r.json()); })(); },[id]);
  async function apply(){ setErr(''); setOk(''); try{
    const r = await fetch(`${API()}/jobs/${id}/apply`,{
      method:'POST', headers:{'Content-Type':'application/json','x-csrf-token': csrf || ''}, credentials:'include',
      body: JSON.stringify({ roleName:'Worker', transport })
    });
    const j=await r.json(); if(!r.ok||j?.error) throw new Error(j?.error||'apply_failed'); setOk('Applied! Wait for approval.');
  }catch(e:any){ setErr(e?.message||'Failed'); } }

  return (
    <section className="card">
      <h2>Job Details</h2>
      {!job && <div className="kv">Loading…</div>}
      {job && (<>
        <div style={{display:'flex',justifyContent:'space-between'}}>
          <div>
            <div style={{fontWeight:700}}>{job.title}</div>
            <div className="kv">{job.venue}</div>
            <div className="kv">{formatJobRange(job.callTimeUtc, job.endTimeUtc||undefined)}</div>
          </div>
          <span className="badge">{job.jobType}</span>
        </div>
        <div className="row" style={{marginTop:12, alignItems:'center'}}>
          <div className="kv">Transport</div>
          <select value={transport} onChange={e=>setTransport(e.target.value as any)} className="btn">
            <option value="OWN">Own Transport</option>
            <option value="ATAG_BUS">ATAG Bus</option>
          </select>
          <button className="btn primary" onClick={apply} disabled={!user || !csrf}>Apply</button>
        </div>
        {!user && <div className="kv" style={{marginTop:8}}>Please <a href="/login">log in</a> to apply.</div>}
        {ok && <div className="alert-success" style={{marginTop:10}}>✅ {ok}</div>}
        {err && <div style={{marginTop:10,color:'#b60603'}}>⚠ {err}</div>}
      </>)}
    </section>
  );
}
