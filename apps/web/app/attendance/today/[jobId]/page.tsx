'use client';
import { useEffect, useState } from 'react';
type Row = { userId:string; user:string; email:string; firstInUtc:string|null; lastOutUtc:string|null; lateMinutes:string|null; totalIns:number };
type Resp = { jobId:string; date:string; records:Row[] };
const API = () => (process.env.NEXT_PUBLIC_API_URL?.trim() || `${location.protocol}//${location.hostname}:4000`).replace(/\/+$/,'');

export default function TodayAttendance({ params }:{ params:{ jobId:string } }){
  const { jobId } = params; const [data,setData]=useState<Resp|null>(null);
  useEffect(()=>{(async()=>{ const r=await fetch(`${API()}/jobs/${jobId}/attendance/today`,{credentials:'include'}); setData(await r.json()); })()},[jobId]);
  const th = { textAlign:'left' as const, borderBottom:'1px solid var(--border)', padding:'10px 8px', fontWeight:600 };
  const td = { borderBottom:'1px solid var(--border)', padding:'10px 8px' };
  return (
    <section className="card">
      <h3>Today’s Attendance</h3>
      <p className="kv">Job: <code>{jobId}</code> · Date: <code>{data?.date||''}</code></p>
      <div style={{overflowX:'auto',marginTop:10}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr><th style={th}>User</th><th style={th}>Email</th><th style={th}>First IN</th><th style={th}>Last OUT</th><th style={th}>Late</th><th style={th}># IN</th></tr></thead>
          <tbody>
            {data?.records?.map(r=>(
              <tr key={r.userId}><td style={td}>{r.user}</td><td style={td}>{r.email}</td>
                <td style={td}>{r.firstInUtc?new Date(r.firstInUtc).toLocaleTimeString():'-'}</td>
                <td style={td}>{r.lastOutUtc?new Date(r.lastOutUtc).toLocaleTimeString():'-'}</td>
                <td style={td}>{r.lateMinutes?`${r.lateMinutes} min`:'-'}</td>
                <td style={td}>{r.totalIns}</td></tr>
            ))}
            {!data?.records?.length && (<tr><td style={td} colSpan={6}><span className="kv">No scans yet today.</span></td></tr>)}
          </tbody>
        </table>
      </div>
    </section>
  );
}
