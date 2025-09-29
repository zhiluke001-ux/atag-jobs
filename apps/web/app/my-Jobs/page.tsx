'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '../../components/Auth';
import { formatJobRange } from '../../lib/time';

type Row = {
  id:string; status:'APPLIED'|'APPROVED'|'REJECTED'|'WITHDRAWN';
  transport:'ATAG_BUS'|'OWN'; roleName:string; approvedAt?:string|null;
  job:{ id:string; title:string; venue:string; callTimeUtc:string; endTimeUtc?:string|null; jobType:string; status:string };
};
const API = () => (process.env.NEXT_PUBLIC_API_URL?.trim() || `${location.protocol}//${location.hostname}:4000`).replace(/\/+$/,'');

export default function MyJobsPage(){
  const { user } = useAuth();
  const [rows,setRows]=useState<Row[]>([]); const [err,setErr]=useState('');

  useEffect(()=>{ (async()=>{ try{ const r=await fetch(`${API()}/me/assignments`,{credentials:'include'}); if(!r.ok){ setErr('Unable to load assignments'); return;} setRows(await r.json()); }catch(e:any){ setErr(e?.message||'Failed'); } })(); },[]);
  if (!user) return <section className="card"><h2>My Jobs</h2><div className="kv">Please <a href="/login">log in</a>.</div></section>;

  return (
    <section className="grid cards">
      <div className="card" style={{gridColumn:'span 12'}}><h2>My Jobs</h2></div>
      {err && <div className="kv" style={{color:'#b60603'}}>{err}</div>}
      {rows.map(r=>(
        <div key={r.id} className="card" style={{gridColumn:'span 6'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <div style={{fontWeight:700}}>{r.job.title}</div>
              <div className="kv">{r.job.venue}</div>
              <div className="kv">{formatJobRange(r.job.callTimeUtc, r.job.endTimeUtc||undefined)}</div>
            </div>
            <span className="badge">{r.status}</span>
          </div>
          <div className="row" style={{marginTop:10}}>
            {r.status==='APPROVED'
              ? <a className="btn primary" href={`/my-jobs/${r.job.id}/qr`}>Open My QR</a>
              : <button className="btn" disabled>Waiting Approval</button>}
          </div>
        </div>
      ))}
      {rows.length===0 && <div className="kv" style={{gridColumn:'span 12'}}>No applications yet. Go to <a href="/available">Jobs</a> to apply.</div>}
    </section>
  );
}
