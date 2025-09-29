'use client';
import { useEffect, useState } from 'react';

type Payment = { jobId:string; jobTitle:string; amount:number; status:'Pending'|'Approved'|'Paid' };

const API = () => (process.env.NEXT_PUBLIC_API_URL?.trim() || `${location.protocol}//${location.hostname}:4000`).replace(/\/+$/,'');

export default function Payments(){
  const [rows,setRows]=useState<Payment[]>([]);
  useEffect(()=>{ (async()=>{ const r=await fetch(`${API()}/me/payments`,{credentials:'include'}); if(r.ok) setRows(await r.json()); })(); },[]);
  const th={textAlign:'left' as const, borderBottom:'1px solid var(--border)', padding:'10px 8px', fontWeight:600};
  const td={borderBottom:'1px solid var(--border)', padding:'10px 8px'};
  return (
    <section className="card">
      <h2>Payment Summary</h2>
      <div style={{overflowX:'auto', marginTop:10}}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr><th style={th}>Job</th><th style={th}>Amount</th><th style={th}>Status</th></tr></thead>
          <tbody>
            {rows.map((r,i)=>(
              <tr key={i}><td style={td}>{r.jobTitle}</td><td style={td}>${r.amount.toFixed(2)}</td><td style={td}><span className="badge">{r.status}</span></td></tr>
            ))}
            {!rows.length && <tr><td style={td} colSpan={3}><span className="kv">No payments yet.</span></td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
