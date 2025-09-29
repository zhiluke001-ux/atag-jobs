'use client';
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { useAuth } from '../../../../components/Auth';

const API = () => (process.env.NEXT_PUBLIC_API_URL?.trim() || `${location.protocol}//${location.hostname}:4000`).replace(/\/+$/,'');

export default function MyJobQR({ params }:{ params:{ jobId:string } }){
  const { user } = useAuth();
  const { jobId } = params;
  const [action,setAction]=useState<'in'|'out'>('in');
  const [token,setToken]=useState<string>(''); const [ttl,setTtl]=useState<number>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [err,setErr]=useState<string>('');

  async function refreshToken(){
    try{
      const r = await fetch(`${API()}/jobs/${jobId}/qr-token`,{
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ action })
      });
      const j = await r.json();
      if(!r.ok || j?.error) throw new Error(j?.error||'Failed to get token');
      setToken(j.token); setTtl(j.ttl||60);
      const payload = JSON.stringify({ token: j.token });
      if (canvasRef.current) await QRCode.toCanvas(canvasRef.current, payload, { margin: 1, width: 280 });
    } catch(e:any){ setErr(e?.message||'Token error'); }
  }

  useEffect(()=>{ if(!user) return; refreshToken(); },[user, action, jobId]);

  useEffect(()=>{
    const t = setInterval(()=>{ refreshToken().catch(()=>{}); }, 8000);
    return ()=>clearInterval(t);
  },[action, jobId]);

  if (!user) return <section className="card"><h3>QR</h3><div className="kv">Please log in.</div></section>;

  return (
    <section className="card" style={{maxWidth:420}}>
      <h3>Show this QR to PM</h3>
      <div className="row" style={{gap:8, marginBottom:10}}>
        <button className={`btn ${action==='in'?'primary':''}`} onClick={()=>setAction('in')}>Clock In</button>
        <button className={`btn ${action==='out'?'primary':''}`} onClick={()=>setAction('out')}>Clock Out</button>
      </div>
      <canvas ref={canvasRef} style={{border:'1px solid var(--border)', borderRadius:8}} />
      <div className="kv" style={{marginTop:8}}>Auto-refreshing… (TTL ≤ {ttl || 60}s)</div>
      {err && <div style={{color:'#b60603', marginTop:8}}>⚠ {err}</div>}
    </section>
  );
}
