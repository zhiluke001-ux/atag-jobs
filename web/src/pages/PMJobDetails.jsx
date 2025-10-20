// web/src/pages/PMJobDetails.jsx
import React, { useEffect, useRef, useState, useMemo } from "react";
import dayjs from "dayjs";
import { apiGet, apiPost } from "../api";

function fmtRange(start, end) {
  try {
    const s = dayjs(start), e = dayjs(end);
    const sameDay = s.isSame(e, "day");
    const d = s.format("YYYY/MM/DD");
    const t1 = s.format("h:mm a");
    const t2 = e.format("h:mm a");
    return sameDay ? `${d}  ${t1} — ${t2}` : `${s.format("YYYY/MM/DD h:mm a")} — ${e.format("YYYY/MM/DD h:mm a")}`;
  } catch { return ""; }
}
const fmtTime = (t) => (t ? dayjs(t).format("HH:mm:ss") : "");

export default function PMJobDetails({ jobId }) {
  const [job, setJob] = useState(null);
  const [applicants, setApplicants] = useState([]);
  const [lu, setLU] = useState({ quota: 0, applicants: [], participants: [] });
  const [loading, setLoading] = useState(true);

  // Scanner state (inline)
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanDir, setScanDir] = useState("in");
  const [token, setToken] = useState("");
  const [scanMsg, setScanMsg] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const scannerCardRef = useRef(null);

  const videoRef = useRef(null);
  const detRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const [camActive, setCamActive] = useState(false);
  const [camSupported, setCamSupported] = useState(false);
  const [qrSupported, setQrSupported] = useState(false);

  const [loc, setLoc] = useState(null);
  const watchIdRef = useRef(null);
  const hbTimerRef = useRef(null);

  async function load() {
    setLoading(true);
    try {
      const j = await apiGet(`/jobs/${jobId}`);
      setJob(j);
      const a = await apiGet(`/jobs/${jobId}/applicants`).catch(()=>[]);
      setApplicants(a);
      const l = await apiGet(`/jobs/${jobId}/loading`).catch(()=>({quota:0,applicants:[],participants:[]}));
      setLU(l);
    } finally { setLoading(false); }
  }
  useEffect(()=>{ load(); }, [jobId]);

  useEffect(() => {
    setCamSupported(!!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia));
    (async () => {
      if (!("BarcodeDetector" in window)) { setQrSupported(false); return; }
      try {
        const fmts = (await window.BarcodeDetector.getSupportedFormats?.()) || [];
        setQrSupported(fmts.includes("qr_code"));
      } catch { setQrSupported(true); }
    })();
  }, []);

  const statusPill = useMemo(() => {
    const s = job?.status || "upcoming";
    const bg = s === "ongoing" ? "#d1fae5" : s === "ended" ? "#fee2e2" : "#e5e7eb";
    const fg = s === "ongoing" ? "#065f46" : s === "ended" ? "#991b1b" : "#374151";
    return <span className="status" style={{ background:bg, color:fg }}>{s}</span>;
  }, [job]);

  async function setApproval(userId, approve) {
    await apiPost(`/jobs/${jobId}/approve`, { userId, approve });
    await load();
  }

  async function startAndOpen() {
    try { await apiPost(`/jobs/${jobId}/start`, {}); } catch {}
    await load();
    openScanner();
  }
  async function endEvent() { await apiPost(`/jobs/${jobId}/end`, {}); await load(); }
  async function resetEvent(keepAttendance) { await apiPost(`/jobs/${jobId}/reset`, { keepAttendance }); await load(); }

  function openScanner() {
    setScanMsg(""); setToken(""); setScanDir("in"); setScannerOpen(true);
    setTimeout(()=>{ scannerCardRef.current?.scrollIntoView({ behavior:"smooth", block:"start" }); }, 60);
  }
  function closeScanner() {
    setScannerOpen(false);
    stopCamera(); stopHeartbeat();
  }

  useEffect(() => {
    if (!scannerOpen) return;
    if ("geolocation" in navigator) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos)=>setLoc({ lat:pos.coords.latitude, lng:pos.coords.longitude }),
        ()=>{},
        { enableHighAccuracy:true, maximumAge:2000, timeout:10000 }
      );
    }
    hbTimerRef.current = setInterval(() => {
      if (loc) apiPost(`/jobs/${jobId}/scanner/heartbeat`, { lat: loc.lat, lng: loc.lng }).catch(()=>{});
    }, 15000);
    return () => { stopHeartbeat(); };
    // eslint-disable-next-line
  }, [scannerOpen, jobId, loc?.lat, loc?.lng]);

  function stopHeartbeat() {
    if (watchIdRef.current != null) {
      try { navigator.geolocation.clearWatch(watchIdRef.current); } catch {}
      watchIdRef.current = null;
    }
    if (hbTimerRef.current) { clearInterval(hbTimerRef.current); hbTimerRef.current = null; }
  }

  async function startCamera() {
    if (!camSupported) { setScanMsg("Camera not available on this device."); return; }
    try {
      if (qrSupported && "BarcodeDetector" in window) detRef.current = new window.BarcodeDetector({ formats:["qr_code"] });
      const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"environment" }, audio:false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setCamActive(true);
      if (detRef.current) loopDetect(); else setScanMsg("Camera opened (preview only). Paste the token below.");
    } catch { setScanMsg("Could not open camera. Paste the token instead."); }
  }
  function stopCamera() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (videoRef.current?.srcObject) {
      try { videoRef.current.srcObject.getTracks().forEach((t)=>t.stop()); } catch {}
      videoRef.current.srcObject = null;
    }
    if (streamRef.current) {
      try { streamRef.current.getTracks().forEach((t)=>t.stop()); } catch {}
      streamRef.current = null;
    }
    setCamActive(false);
  }
  async function loopDetect() {
    if (!detRef.current || !videoRef.current) return;
    try {
      const codes = await detRef.current.detect(videoRef.current);
      if (codes && codes[0]?.rawValue) setToken(codes[0].rawValue);
    } catch {}
    rafRef.current = requestAnimationFrame(loopDetect);
  }
  useEffect(()=>()=>stopCamera(), []);

  async function pasteFromClipboard() {
    try { const t = await navigator.clipboard.readText(); if (t) setToken(t.trim()); } catch {}
  }

  async function doScan() {
    if (!token) { setScanMsg("No token. Paste the QR token or use the camera."); return; }
    if (!loc) { setScanMsg("Getting your location… allow location and try again."); return; }
    setScanBusy(true); setScanMsg("");
    try {
      const r = await apiPost("/scan", { token, scannerLat: loc.lat, scannerLng: loc.lng });
      setScanMsg(`✅ ${scanDir.toUpperCase()} recorded at ${dayjs(r.time).format("HH:mm:ss")}`);
      setToken(""); await load();
    } catch (e) {
      let msg = "Scan failed.";
      try {
        const j = JSON.parse(String(e));
        if (j.error === "jwt_error") msg = "Invalid/expired QR. Ask the part-timer to refresh.";
        else if (j.error === "too_far") msg = `Too far from user (> ${j.maxDistanceMeters} m).`;
        else if (j.error === "event_not_started") msg = "Event not started.";
        else if (j.error) msg = j.error;
      } catch {}
      setScanMsg("❌ " + msg);
    } finally { setScanBusy(false); }
  }

  async function toggleLU(userId, present) {
    await apiPost(`/jobs/${jobId}/loading/mark`, { userId, present });
    const l = await apiGet(`/jobs/${jobId}/loading`);
    setLU(l);
  }

  if (loading || !job) return <div className="container">Loading…</div>;

  const approvedRows = (job.approved || []).map((uid) => {
    const app = (job.applications || []).find((a) => a.userId === uid);
    const rec = (job.attendance || {})[uid] || {};
    return { email: app?.email || uid, in: rec.in, out: rec.out, late: rec.lateMinutes ?? "" };
  });

  return (
    <div className="container" style={{ paddingTop: 16 }}>
      <div className="card">
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8 }}>
          <div>
            <div style={{ fontSize:22, fontWeight:800 }}>{job.title}</div>
            <div style={{ color:"#374151", marginTop:6 }}>{job.description || ""}</div>
            <div style={{ marginTop:10, display:"flex", gap:16, flexWrap:"wrap", color:"#374151" }}>
              <div><strong>{job.venue}</strong></div>
              <div>{fmtRange(job.startTime, job.endTime)}</div>
              <div>Headcount: {job.headcount}</div>
              <div>Early call: {job.earlyCall?.enabled ? `Yes (RM ${job.earlyCall.amount})` : "No"}</div>
            </div>
          </div>
          <div>{statusPill}</div>
        </div>

        <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginTop:14 }}>
          <button className="btn red" onClick={startAndOpen}>Start event & open scanner</button>
          {!scannerOpen ? null : <button className="btn gray" onClick={closeScanner}>Hide scanner</button>}
          <button className="btn" onClick={() => resetEvent(true)}>Reset (keep attendance)</button>
          <button className="btn danger" onClick={() => resetEvent(false)}>Reset (delete attendance)</button>
          <button className="btn" onClick={endEvent}>End event</button>
        </div>
      </div>

      {/* Applicants */}
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ fontWeight:800, marginBottom:8 }}>Applicants</div>
        <div className="table">
          <div className="thead">
            <div>Email</div><div>Transport</div><div>Status</div><div>L&U</div><div>Actions</div>
          </div>
          {applicants.length === 0 ? (
            <div className="trow"><div style={{ gridColumn:"1 / -1", color:"#6b7280" }}>No applicants yet.</div></div>
          ) : applicants.map(a=>(
            <div className="trow" key={a.userId}>
              <div>{a.email}</div>
              <div>{a.transport || "-"}</div>
              <div>{a.status}</div>
              <div>
                {a.luApplied ? (
                  <label style={{ display:"inline-flex", gap:6, alignItems:"center" }}>
                    <input
                      type="checkbox"
                      checked={a.luConfirmed}
                      onChange={(e)=>toggleLU(a.userId, e.target.checked)}
                    /> Confirmed
                  </label>
                ) : "—"}
              </div>
              <div style={{ display:"flex", gap:6 }}>
                <button className="btn green" onClick={()=>setApproval(a.userId,true)}>Approve</button>
                <button className="btn danger" onClick={()=>setApproval(a.userId,false)}>Reject</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Attendance */}
      <div className="card" style={{ marginTop:14 }}>
        <div style={{ fontWeight:800, marginBottom:8 }}>Approved List & Attendance</div>
        <table className="table">
          <thead><tr><th>Email</th><th style={{ width:120 }}>In</th><th style={{ width:120 }}>Out</th><th style={{ width:120 }}>Late (min)</th></tr></thead>
        </table>
        <div style={{ maxHeight:340, overflow:"auto", border:"1px solid var(--border)", borderTop:0, borderRadius:"0 0 8px 8px" }}>
          <table className="table" style={{ border:"none", margin:0 }}>
            <tbody>
              {approvedRows.length === 0 ? (
                <tr><td colSpan={4} style={{ color:"#6b7280" }}>No approved users yet.</td></tr>
              ) : approvedRows.map((r)=>(
                <tr key={r.email}>
                  <td>{r.email}</td>
                  <td>{fmtTime(r.in)}</td>
                  <td>{fmtTime(r.out)}</td>
                  <td>{r.late === "" ? "" : r.late}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inline scanner */}
      {scannerOpen && (
        <div ref={scannerCardRef} className="card" style={{ marginTop:14 }}>
          <div style={{ fontWeight:800, marginBottom:10 }}>Scanner — {job.title}</div>
          <div className="card" style={{ marginBottom:12 }}>
            <div style={{ display:"flex", gap:12, alignItems:"center" }}>
              <label style={{ fontWeight:700 }}>Direction</label>
              <label><input type="radio" name="dir" checked={scanDir==="in"} onChange={()=>setScanDir("in")} /> In</label>
              <label><input type="radio" name="dir" checked={scanDir==="out"} onChange={()=>setScanDir("out")} /> Out</label>
            </div>
          </div>

          <div className="grid">
            <div className="card" style={{ gridColumn:"span 8" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
                <label style={{ fontWeight:700 }}>
                  Camera {qrSupported ? "(auto-scan)" : "(preview only)"}
                </label>
                {!camActive ? (
                  <button className="btn" onClick={startCamera} disabled={!camSupported}>
                    {camSupported ? (qrSupported ? "Use camera (auto-scan)" : "Open camera (preview)") : "Camera not available"}
                  </button>
                ) : (
                  <button className="btn gray" onClick={stopCamera}>Stop camera</button>
                )}
              </div>
              <video
                ref={videoRef}
                muted
                playsInline
                style={{ width:"100%", maxHeight:360, background:"#000", borderRadius:8, display:camActive ? "block" : "none" }}
              />
              {!camActive && (
                <div style={{ padding:8, color:"#6b7280" }}>
                  Tip: if your browser can’t decode QR, open the camera for preview and <b>paste</b> the token below.
                </div>
              )}
            </div>

            <div className="card" style={{ gridColumn:"span 4" }}>
              <label style={{ fontWeight:700 }}>Token (from QR)</label>
              <div style={{ display:"flex", gap:8 }}>
                <input value={token} onChange={(e)=>setToken(e.target.value)} placeholder="Paste decoded QR token here…" />
                <button className="btn" type="button" onClick={pasteFromClipboard}>Paste</button>
              </div>
              <div style={{ color:"#6b7280", fontSize:13, marginTop:10 }}>
                {loc ? <>Scanner location: {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)} (heartbeat active)</>
                     : <>Waiting for location… allow permission.</>}
              </div>
              {scanMsg && <div style={{ marginTop:10, padding:8, background:"#f8fafc", border:"1px solid var(--border)", borderRadius:8 }}>{scanMsg}</div>}
              <div style={{ display:"flex", justifyContent:"flex-end", gap:8, marginTop:12 }}>
                <button className="btn" onClick={closeScanner}>Hide</button>
                <button className="btn primary" disabled={scanBusy} onClick={doScan}>
                  {scanBusy ? "Scanning…" : "Scan"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
