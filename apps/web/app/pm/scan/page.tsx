'use client';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { useEffect, useRef, useState } from 'react';

function getJti(token:string):string|undefined{ try{ const b64=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'); return JSON.parse(atob(b64))?.jti; }catch{ return undefined; } }
const API = () => (process.env.NEXT_PUBLIC_API_URL?.trim() || `${location.protocol}//${location.hostname}:4000`).replace(/\/+$/,'');

export default function PMScan({ params }:{ params:{ jobId:string } }) {
  const { jobId } = params;
  const [sessionId,setSessionId]=useState<string>(''); const [result,setResult]=useState<any>(null);
  const videoRef=useRef<HTMLVideoElement>(null); const controlsRef=useRef<any>(null);
  const readerRef=useRef<BrowserMultiFormatReader|null>(null);
  const verifyingRef=useRef(false); const seenJtisRef=useRef<Set<string>>(new Set());
  const lastTextRef=useRef<string>(''); const lastVerifyAtRef=useRef<number>(0);
  const COOLDOWN_MS=1200; const pmDeviceId='pm-device-demo-1';

  async function startSession(){ const r=await fetch(`${API()}/jobs/${jobId}/session/start`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pmDeviceId})}); const j=await r.json(); if(j.sessionId) setSessionId(j.sessionId); }
  async function keepAlive(){ await fetch(`${API()}/jobs/${jobId}/session/keepalive`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pmDeviceId})}).catch(()=>{}); }
  useEffect(()=>{ startSession().catch(console.error); const t=setInterval(()=>keepAlive().catch(console.error),60_000); return ()=>clearInterval(t); },[jobId]);

  useEffect(()=>{
    if(!sessionId) return;
    const reader=new BrowserMultiFormatReader(); readerRef.current=reader;
    (async()=>{
      try{
        controlsRef.current = await reader.decodeFromVideoDevice(undefined, videoRef.current!, async(res)=>{
          if(!res) return; const now=Date.now(); if(verifyingRef.current || now-lastVerifyAtRef.current<COOLDOWN_MS) return;
          const text=res.getText(); if(text===lastTextRef.current) return; lastTextRef.current=text;
          let token=''; try{ token=String(JSON.parse(text).token||''); }catch{ setResult({result:'invalid',reason:'parse_error'}); return; }
          const jti=getJti(token); if(!jti){ setResult({result:'invalid',reason:'no_jti'}); return; } if(seenJtisRef.current.has(jti)) return;
          verifyingRef.current=true; lastVerifyAtRef.current=now;
          try{
            const verify=await fetch(`${API()}/scan/verify`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,pmDeviceId,sessionId})});
            const vr=await verify.json(); setResult(vr);
            try{ if('vibrate' in navigator){ if(vr?.result==='success')(navigator as any).vibrate?.(60); else if(vr?.result==='duplicate')(navigator as any).vibrate?.([60,40,60]); } }catch{}
            seenJtisRef.current.add(jti); setTimeout(()=>seenJtisRef.current.delete(jti),30_000);
          }catch{ setResult({result:'invalid',reason:'network_error'}); } finally{ verifyingRef.current=false; }
        });
      }catch(e){ console.error('scanner error',e); setResult({result:'invalid',reason:'camera_error'}); }
    })();

    return ()=>{ try{controlsRef.current?.stop?.();}catch{} try{ const s=videoRef.current?.srcObject as MediaStream|null; s?.getTracks().forEach(t=>t.stop()); }catch{}
      readerRef.current=null; controlsRef.current=null; verifyingRef.current=false; seenJtisRef.current.clear(); lastTextRef.current=''; lastVerifyAtRef.current=0; };
  },[sessionId,jobId]);

  const cardStyle = { marginTop:12, padding:12, borderRadius:8, border:'1px solid #ddd', background: result?.result==='success' ? '#E7F6E7' : result ? '#FDECEC' : '#f6f6f6' };
  return (
    <div>
      <h2>PM Scanner</h2>
      <p>Job: <code>{jobId}</code></p>
      <p>Session ID: <code>{sessionId || '(starting...)'}</code></p>
      <video ref={videoRef} style={{width:'100%',maxWidth:480,border:'1px solid #ddd',borderRadius:8}} playsInline muted />
      <div style={cardStyle}><b>Scan Result:</b> {result ? result.result : '—'}{result?.reason && <div>Reason: {result.reason}</div>}{typeof result?.minutesLate==='number' && <div>Late by: <b>{result.minutesLate} min</b></div>}</div>
    </div>
  );
}
