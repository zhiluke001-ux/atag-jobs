'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '../../../components/Auth';
import { formatJobRange } from '../../../lib/time';

type Job = { id:string; title:string; venue:string; callTimeUtc:string; endTimeUtc?:string|null; jobType:string; status:'PUBLISHED'|'DRAFT'|'CLOSED' };
type Applicant = { id:string; userId:string; name:string; email:string; roleName:string; transport:'ATAG_BUS'|'OWN'; status:string; approvedBy?:string|null; approvedAt?:string|null };
const API = () => (process.env.NEXT_PUBLIC_API_URL?.trim() || `${location.protocol}//${location.hostname}:4000`).replace(/\/+$/,'');

export default function PMJobs(){
  const { user, csrf } = useAuth();
  const [jobs,setJobs]=useState<Job[]>([]);
  const [apps,setApps]=useState<Record<string,Applicant[]>>({});
  const [err,setErr]=useState('');

  useEffect(()=>{ (async()=>{
    if (!user || (user.role!=='PM' && user.role!=='ADMIN')) return;
    try{
      const r=await fetch(`${API()}/jobs`,{credentials:'include'}); const js:Job[]=await r.json(); setJobs(js);
      const map:Record<string,Applicant[]> = {};
      await Promise.all(js.map(async j=>{
        const a=await fetch(`${API()}/jobs/${j.id}/applicants`,{credentials:'include'});
        if(a.ok) map[j.id]=await a.json();
      }));
      setApps(map);
    }catch(e:any){ setErr(e?.message||'Failed to load'); }
  })(); },[user]);

  if (!user || (user.role!=='PM' && user.role!=='ADMIN'))
    return <section className="card"><h2>Restricted</h2><div className="kv">Log in as PM/Admin.</div></section>;

  const ongoing = jobs.filter(j=>j.status==='PUBLISHED');
  const ended   = jobs.filter(j=>j.status==='CLOSED');

  async function approve(jobId:string, assignmentId:string){
    await fetch(`${API()}/jobs/${jobId}/approve`,{
      method:'POST',credentials:'include',headers:{'Content-Type':'application/json','x-csrf-token': csrf || ''},
      body: JSON.stringify({ assignmentId })
    }); location.reload();
  }
  async function reject(jobId:string, assignmentId:string){
    await fetch(`${API()}/jobs/${jobId}/reject`,{
      method:'POST',credentials:'include',headers:{'Content-Type':'application/json','x-csrf-token': csrf || ''},
      body: JSON.stringify({ assignmentId })
    }); location.reload();
  }

  function Section({title,children}:{title:string;children:any}){ return (<div className="card" style={{gridColumn:'span 12'}}><h3>{title}</h3>{children}</div>); }

  return (
    <section className="grid cards">
      <div className="card" style={{gridColumn:'span 12',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <h2>Jobs</h2>
        <button className="btn primary" onClick={()=>alert('Add your Create Job modal here')}>+ Create Job</button>
      </div>

      {err && <div className="kv" style={{color:'#b60603'}}>{err}</div>}

      <Section title="Ongoing">
        {ongoing.length===0 && <div className="kv">No ongoing jobs.</div>}
        {ongoing.map(j=>(
          <div key={j.id} className="list"><li style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <div style={{fontWeight:700}}><span className="badge" style={{background:'#e7f6e7',borderColor:'#b9e2b9'}}>Ongoing</span> {j.title}</div>
              <div className="kv">{j.venue} · {formatJobRange(j.callTimeUtc, j.endTimeUtc||undefined)}</div>
            </div>
            <div className="row">
              <a className="btn" href={`/attendance/today/${j.id}`}>View Details</a>
              <a className="btn" href={`/pm/${j.id}/scan`}>Open Scanner</a>
            </div>
          </li></div>
        ))}
      </Section>

      <Section title="Ended">
        {ended.length===0 && <div className="kv">No ended jobs.</div>}
        {ended.map(j=>(
          <div key={j.id} className="list"><li style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <div style={{fontWeight:700}}><span className="badge">Ended</span> {j.title}</div>
              <div className="kv">{j.venue} · {formatJobRange(j.callTimeUtc, j.endTimeUtc||undefined)}</div>
            </div>
            <div className="row"><a className="btn" href={`/attendance/today/${j.id}`}>View Details</a></div>
          </li></div>
        ))}
      </Section>

      <Section title="Applications">
        {jobs.map(j=>{
          const rows = (apps[j.id]||[]).filter(a=>a.status==='APPLIED'); if(!rows.length) return null;
          return (
            <div key={j.id} className="card" style={{marginTop:8}}>
              <div style={{fontWeight:700,marginBottom:8}}>{j.title}</div>
              <div className="list">
                {rows.map(a=>(
                  <li key={a.id} className="row" style={{justifyContent:'space-between',alignItems:'center'}}>
                    <div>
                      <div>{a.name} · <span className="kv">{a.email}</span></div>
                      <div className="kv">{a.roleName} · Transport: <b>{a.transport}</b></div>
                    </div>
                    <div className="row">
                      <button className="btn primary" onClick={()=>approve(j.id, a.id)}>Approve</button>
                      <button className="btn" onClick={()=>reject(j.id, a.id)}>Reject</button>
                    </div>
                  </li>
                ))}
              </div>
            </div>
          );
        })}
      </Section>
    </section>
  );
}
