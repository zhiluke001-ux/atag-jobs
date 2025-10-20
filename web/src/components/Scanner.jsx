import React, { useEffect, useRef, useState } from "react";
import { apiPost } from "../api";

/** Only support #/jobs/:id/scanner */
function resolveJobId() {
  if (typeof window === "undefined") return null;
  const h = window.location.hash || "";
  const m = h.match(/#\/jobs\/([^\/?#\s]+)\/scanner/i);
  return m && m[1] ? decodeURIComponent(m[1]).trim() : null;
}

export default function Scanner({ navigate }) {
  const jobId = resolveJobId();
  const [err, setErr] = useState("");
  const [scannerPos, setScannerPos] = useState(null);
  const geoWatchId = useRef(null);
  const hbTimer = useRef(null);

  useEffect(() => {
    if (!jobId) {
      setErr("Missing job id for scanner.");
      return;
    }
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setScannerPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (e) => setErr("Location error: " + e.message),
        { enableHighAccuracy: true, timeout: 10000 }
      );
      geoWatchId.current = navigator.geolocation.watchPosition(
        (pos) => setScannerPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { enableHighAccuracy: true }
      );
    } else {
      setErr("Geolocation not supported by browser.");
    }
    return () => {
      if (geoWatchId.current != null) navigator.geolocation.clearWatch(geoWatchId.current);
    };
  }, [jobId]);

  // Heartbeat so part-timers can see distance
  useEffect(() => {
    if (!jobId || !scannerPos) return;
    async function ping() {
      try {
        await apiPost(`/jobs/${jobId}/scanner/heartbeat`, {
          lat: scannerPos.lat,
          lng: scannerPos.lng,
        });
      } catch (e) {
        console.warn("Heartbeat error:", e?.message || e);
      }
    }
    ping();
    hbTimer.current = setInterval(ping, 10000);
    return () => clearInterval(hbTimer.current);
  }, [jobId, scannerPos]);

  const [token, setToken] = useState("");
  const [scanning, setScanning] = useState(false);

  async function submitScan() {
    if (!token) return alert("Paste the token from the part-timer’s QR first.");
    if (!scannerPos) return alert("Waiting for your location…");
    setScanning(true);
    try {
      const r = await apiPost(`/scan`, {
        token,
        scannerLat: scannerPos.lat,
        scannerLng: scannerPos.lng,
      });
      alert(`OK: ${r.direction.toUpperCase()} recorded at ${new Date(r.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
      setToken("");
    } catch (e) {
      alert("Scan failed: " + (e?.message || e));
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="container">
      <div className="card">
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontSize:18, fontWeight:800 }}>Scanner</div>
          <div className="status">Job: {jobId || "-"}</div>
        </div>

        {err && (
          <div style={{ marginTop:8, padding:8, background:"#fff4f4", color:"#b00", borderRadius:8 }}>
            {err}
          </div>
        )}

        <div style={{ marginTop:12, opacity:.9 }}>
          Your location: {scannerPos ? `${scannerPos.lat.toFixed(5)}, ${scannerPos.lng.toFixed(5)}` : "locating…"}
        </div>

        <div className="grid" style={{ marginTop:12 }}>
          <div className="card" style={{ gridColumn:"span 12" }}>
            <label>Paste QR token from part-timer</label>
            <input
              placeholder="eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <div style={{ display:"flex", gap:8, marginTop:10 }}>
              <button className="btn red" onClick={submitScan} disabled={scanning}>
                {scanning ? "Scanning…" : "Scan"}
              </button>
              <button className="btn" onClick={() => navigate(`#/jobs/${jobId}`)}>
                Back to job
              </button>
            </div>
          </div>
        </div>

        <div style={{ marginTop:12, fontSize:12, color:"#6b7280" }}>
          Keep this page open during the event so your GPS keeps sending the
          <em> scanner heartbeat</em> every 10s (lets part-timers see distance).
        </div>
      </div>
    </div>
  );
}
