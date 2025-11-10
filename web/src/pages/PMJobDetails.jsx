// web/src/pages/PMJobDetails.jsx
import React, { useEffect, useRef, useState, useMemo } from "react";
import dayjs from "dayjs";
import { apiGet, apiPost } from "../api";

/* ---------------- helpers ---------------- */
const toRad = (d) => (d * Math.PI) / 180;
function haversineMeters(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const aa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(aa)));
}

function fmtRange(start, end) {
  try {
    const s = dayjs(start);
    const e = dayjs(end);
    const sameDay = s.isSame(e, "day");
    const d = s.format("YYYY/MM/DD");
    const t1 = s.format("h:mm a");
    const t2 = e.format("h:mm a");
    return sameDay
      ? `${d}  ${t1} — ${t2}`
      : `${s.format("YYYY/MM/DD h:mm a")} — ${e.format("YYYY/MM/DD h:mm a")}`;
  } catch {
    return "";
  }
}
const fmtTime = (t) => (t ? dayjs(t).format("HH:mm:ss") : "");
const fmtDateTime = (t) => (t ? dayjs(t).format("YYYY/MM/DD HH:mm:ss") : "");

/* ----- Token decode (optional distance precheck) ----- */
function b64urlDecode(str) {
  try {
    const pad = (s) => s + "===".slice((s.length + 3) % 4);
    return decodeURIComponent(
      atob(pad(str).replace(/-/g, "+").replace(/_/g, "/"))
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
  } catch {
    return "";
  }
}
function extractLatLngFromToken(token) {
  if (!token || typeof token !== "string") return null;

  // A) JWT-ish token
  if (token.includes(".")) {
    const parts = token.split(".");
    if (parts[1]) {
      try {
        const payload = JSON.parse(b64urlDecode(parts[1]));
        if (typeof payload.lat === "number" && typeof payload.lng === "number") {
          return { lat: payload.lat, lng: payload.lng };
        }
      } catch {}
    }
  }
  // B) querystring
  try {
    const qs = token.includes("?") ? token.split("?")[1] : token;
    const sp = new URLSearchParams(qs);
    const lat = Number(sp.get("lat"));
    const lng = Number(sp.get("lng"));
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  } catch {}
  // C) "3.1,101.6"
  const m = token.match(/(-?\d+(?:\.\d+)?)[:|,](-?\d+(?:\.\d+)?)(?:[^0-9-].*)?$/);
  if (m) {
    const lat = Number(m[1]),
      lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}
function extractDirFromToken(token) {
  try {
    if (!token || !token.includes(".")) return null;
    const payload = JSON.parse(b64urlDecode(token.split(".")[1]));
    return payload?.dir ?? null;
  } catch {
    return null;
  }
}

/* ---------- Applicants grid ---------- */
const applGrid = {
  display: "grid",
  gridTemplateColumns:
    "minmax(220px,1.4fr) minmax(140px,1.1fr) minmax(120px,1fr) minmax(140px,1.1fr) 0.8fr 0.8fr 0.7fr 1fr",
  alignItems: "center",
  gap: 8,
  padding: "10px 12px",
};
const applHeaderRow = {
  ...applGrid,
  fontWeight: 700,
  borderBottom: "1px solid var(--border, #e5e7eb)",
  color: "#111827",
};
const applBodyRow = {
  ...applGrid,
  borderBottom: "1px solid var(--border, #f1f5f9)",
};

/* robust virtual detector */
function isVirtualJob(j) {
  if (!j) return false;
  if (j.isVirtual === true) return true;
  if (j.scanRequired === false) return true;

  const isVirtualStr = (v) => v && String(v).toLowerCase() === "virtual";
  if (isVirtualStr(j.mode)) return true;
  if (isVirtualStr(j.sessionMode)) return true;
  if (isVirtualStr(j.type)) return true;
  if (isVirtualStr(j.attendanceMode)) return true;
  if (isVirtualStr(j.sessionKind)) return true;
  if (isVirtualStr(j.session?.mode)) return true;
  if (isVirtualStr(j.rate?.sessionKind)) return true;
  if (isVirtualStr(j.physicalSubtype)) return true;
  if (isVirtualStr(j.physicalType)) return true;
  if (isVirtualStr(j.session?.physicalType)) return true;
  return false;
}

/* better error extraction */
function readApiError(err) {
  if (!err) return {};
  if (typeof err === "string") {
    try {
      return JSON.parse(err);
    } catch {
      return { message: err };
    }
  }
  if (err.message) {
    try {
      return JSON.parse(err.message);
    } catch {
      return { message: err.message };
    }
  }
  if (err.response && typeof err.response.json === "function") {
    try {
      return err.response.json();
    } catch {}
  }
  return {};
}

/* --------------- html5-qrcode loader --------------- */
const QR_LIB_SRC =
  "https://unpkg.com/html5-qrcode@2.3.10/dist/html5-qrcode.min.js";
function loadHtml5QrLib() {
  return new Promise((resolve, reject) => {
    if (window.Html5Qrcode) return resolve(true);
    const s = document.createElement("script");
    s.src = QR_LIB_SRC;
    s.async = true;
    s.onload = () => (window.Html5Qrcode ? resolve(true) : reject(new Error("html5-qrcode failed")));
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export default function PMJobDetails({ jobId }) {
  const [job, setJob] = useState(null);
  const [applicants, setApplicants] = useState([]);
  const [lu, setLU] = useState({ quota: 0, applicants: [], participants: [] });
  const [loading, setLoading] = useState(true);

  const [statusForce, setStatusForce] = useState(null);
  const effectiveStatus = (s) => statusForce ?? s ?? "upcoming";

  // scanner state
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanDir, setScanDir] = useState("in");
  const [token, setToken] = useState("");
  const [scanMsg, setScanMsg] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [scanSuccess, setScanSuccess] = useState(false);
  const [scanSuccessMsg, setScanSuccessMsg] = useState("");
  const scannerCardRef = useRef(null);

  // html5-qrcode instance
  const qrRef = useRef(null);
  const lastScannedRef = useRef("");

  // geo
  const [loc, setLoc] = useState(null);
  const watchIdRef = useRef(null);
  const hbTimerRef = useRef(null);

  // Persist end time
  const endedAtRef = useRef(null);
  const LOCAL_KEY = (id) => `atag.jobs.${id}.actualEndAt`;

  /* inject CSS for overlay once */
  useEffect(() => {
    if (document.getElementById("pm-scan-css")) return;
    const style = document.createElement("style");
    style.id = "pm-scan-css";
    style.textContent = `
      .pm-scan-box{
        position:absolute;
        top:52%;
        left:50%;
        transform:translate(-50%, -50%);
        width:min(75vw, 70vh);
        aspect-ratio:1/1;
        border:2px solid rgba(255,255,255,0.25);
      }
      .pm-scan-corner{
        position:absolute;
        width:30px;
        height:30px;
        border:4px solid #0ea5e9;
      }
      .pm-scan-corner.tl{top:-2px;left:-2px;border-right:none;border-bottom:none;}
      .pm-scan-corner.tr{top:-2px;right:-2px;border-left:none;border-bottom:none;}
      .pm-scan-corner.bl{bottom:-2px;left:-2px;border-right:none;border-top:none;}
      .pm-scan-corner.br{bottom:-2px;right:-2px;border-left:none;border-top:none;}
      @keyframes pm-scan-line {
        0% { top: 6px; }
        50% { top: calc(100% - 10px); }
        100% { top: 6px; }
      }
      .pm-scan-line{
        position:absolute;
        left:0;
        width:100%;
        height:3px;
        background:#ef4444;
        animation:pm-scan-line 2.4s ease-in-out infinite;
        filter:drop-shadow(0 0 6px rgba(239,68,68,0.55));
      }
    `;
    document.head.appendChild(style);
  }, []);

  /* ---------------- load data ---------------- */
  async function load() {
    setLoading(true);
    const bust = `?_=${Date.now()}`;
    try {
      const j = await apiGet(`/jobs/${jobId}${bust}`);
      let merged = statusForce ? { ...j, status: statusForce } : j;

      const serverAltEnd =
        merged.actualEndAt ||
        merged.endedAt ||
        merged.finishedAt ||
        merged.closedAt ||
        null;

      const cachedEnd = LOCAL_KEY(jobId)
        ? localStorage.getItem(LOCAL_KEY(jobId))
        : null;

      if (statusForce === "ended" || merged.status === "ended") {
        if (!serverAltEnd) {
          const actual = endedAtRef.current || cachedEnd;
          if (actual) merged = { ...merged, actualEndAt: actual };
        } else if (!merged.actualEndAt) {
          merged = { ...merged, actualEndAt: serverAltEnd };
        }
      }

      setJob(merged);

      const a = await apiGet(`/jobs/${jobId}/applicants${bust}`).catch(() => []);
      setApplicants(a);

      const l = await apiGet(`/jobs/${jobId}/loading${bust}`).catch(() => ({
        quota: 0,
        applicants: [],
        participants: [],
      }));
      setLU(l);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const isVirtual = useMemo(() => isVirtualJob(job), [job]);

  /* start / end / reset */
  async function startAndOpen() {
    if (!job) return;
    if (effectiveStatus(job.status) !== "upcoming") return;
    setStartBusy(true);
    try {
      setStatusForce("ongoing");
      setJob((prev) => (prev ? { ...prev, status: "ongoing" } : prev));
      await apiPost(`/jobs/${jobId}/start`, {});
      if (!isVirtual) {
        openScanner();
      } else {
        setScannerOpen(false);
        stopHeartbeat();
      }
      setTimeout(load, 200);
    } catch {
      await load();
    } finally {
      setStartBusy(false);
    }
  }

  async function endEvent() {
    try {
      const actualEndAt = new Date().toISOString();
      endedAtRef.current = actualEndAt;
      try {
        localStorage.setItem(LOCAL_KEY(jobId), actualEndAt);
      } catch {}
      setStatusForce("ended");
      setJob((prev) => (prev ? { ...prev, status: "ended", actualEndAt } : prev));

      await apiPost(`/jobs/${jobId}/end`, { actualEndAt });

      if (isVirtual && job) {
        const attendance = job.attendance || {};
        const presentIds = Object.keys(attendance).filter((uid) => !!attendance[uid]?.in);
        await Promise.all(
          presentIds.map((uid) =>
            apiPost(`/jobs/${jobId}/attendance/mark`, { userId: uid, outAt: actualEndAt }).catch(() => {})
          )
        );
      }

      setScannerOpen(false);
      stopHtml5Scanner();
      stopHeartbeat();
      setTimeout(load, 200);
    } catch {
      await load();
    }
  }

  async function resetEvent(keepAttendance) {
    try {
      await apiPost(`/jobs/${jobId}/reset`, { keepAttendance });
      endedAtRef.current = null;
      try {
        localStorage.removeItem(LOCAL_KEY(jobId));
      } catch {}
      setStatusForce("upcoming");
      setJob((prev) => (prev ? { ...prev, status: "upcoming", actualEndAt: null } : prev));
      setScannerOpen(false);
      stopHtml5Scanner();
      stopHeartbeat();
      setTimeout(load, 300);
    } catch (e) {
      await load();
      alert("Reset failed: " + e);
    }
  }

  /* scanner open/close */
  function openScanner() {
    setScanMsg("");
    setToken("");
    lastScannedRef.current = "";
    setScanSuccess(false);
    setScannerOpen(true);
    setTimeout(() => {
      scannerCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }
  function closeScanner() {
    setScannerOpen(false);
    stopHtml5Scanner();
    stopHeartbeat();
  }

  /* start html5-qrcode when scanner is open */
  useEffect(() => {
    if (scannerOpen && !isVirtual) {
      startHtml5Scanner();
    }
    return () => {
      stopHtml5Scanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerOpen, isVirtual]);

  /* auto close if job becomes virtual or ended */
  useEffect(() => {
    if ((isVirtual || effectiveStatus(job?.status) === "ended") && scannerOpen) {
      closeScanner();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVirtual, job?.status, scannerOpen]);

  /* heartbeat while scanner open */
  useEffect(() => {
    if (!scannerOpen) return;
    if ("geolocation" in navigator) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => setLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {},
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
      );
    }
    hbTimerRef.current = setInterval(() => {
      if (loc) apiPost(`/jobs/${jobId}/scanner/heartbeat`, { lat: loc.lat, lng: loc.lng }).catch(() => {});
    }, 10000);
    return () => {
      stopHeartbeat();
    };
    // eslint-disable-next-line
  }, [scannerOpen, jobId, loc?.lat, loc?.lng]);

  function stopHeartbeat() {
    if (watchIdRef.current != null) {
      try {
        navigator.geolocation.clearWatch(watchIdRef.current);
      } catch {}
      watchIdRef.current = null;
    }
    if (hbTimerRef.current) {
      clearInterval(hbTimerRef.current);
      hbTimerRef.current = null;
    }
  }

  function vibrateOk() {
    try {
      if (navigator.vibrate) navigator.vibrate(120);
    } catch {}
  }

  /* ------------ html5-qrcode setup ------------ */
  async function startHtml5Scanner() {
    try {
      await loadHtml5QrLib();
    } catch (e) {
      console.error("QR lib failed", e);
      setScanMsg("QR library failed to load. Try manual token.");
      return;
    }
    if (!document.getElementById("pm-qr-reader")) {
      // the overlay not rendered yet
      return;
    }
    if (qrRef.current) {
      // already started
      return;
    }

    try {
      const qr = new window.Html5Qrcode("pm-qr-reader", { verbose: false });
      qrRef.current = qr;

      const onSuccess = async (decodedText /*, decodedResult */) => {
        if (!decodedText) return;
        if (decodedText === lastScannedRef.current) return;
        lastScannedRef.current = decodedText;
        setToken(decodedText);
        await doScan(decodedText);
      };
      const onError = () => {
        // ignore errors
      };

      await qr.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: (w, h) => {
            const minEdge = Math.min(w, h);
            const box = Math.floor(minEdge * 0.7);
            return { width: box, height: box };
          },
        },
        onSuccess,
        onError
      );

      setScanMsg("Camera ready — point at QR code.");
    } catch (e) {
      console.error("startHtml5Scanner error", e);
      setScanMsg("Could not start camera. Allow camera or paste token.");
    }
  }

  async function stopHtml5Scanner() {
    if (qrRef.current) {
      try {
        await qrRef.current.stop();
      } catch {}
      try {
        await qrRef.current.clear();
      } catch {}
      qrRef.current = null;
    }
  }

  async function pasteFromClipboard() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setToken(t.trim());
    } catch {}
  }

  async function doScan(useTokenArg) {
    const useToken = useTokenArg || token;
    if (!useToken) {
      setScanMsg("No token. Paste the QR token or use the camera.");
      return;
    }
    if (!loc) {
      setScanMsg("Getting your location… allow location and try again.");
      return;
    }

    // optional local precheck
    const applicantLL = extractLatLngFromToken(useToken);
    const maxM = Number(job?.scanMaxMeters) || 500;
    if (applicantLL) {
      const d = haversineMeters(loc, applicantLL);
      if (d != null && d > maxM) {
        setScanMsg("❌ Too far based on local check.");
        return;
      }
    }

    const tokenDir = extractDirFromToken(useToken);
    if (tokenDir && tokenDir !== scanDir) {
      setScanMsg(
        `Heads up: token is for "${tokenDir.toUpperCase()}" but you selected "${scanDir.toUpperCase()}". Proceeding…`
      );
    } else {
      setScanMsg("");
    }

    setScanBusy(true);
    try {
      const r = await apiPost("/scan", {
        token: useToken,
        scannerLat: loc.lat,
        scannerLng: loc.lng,
      });
      const msg = `✅ ${tokenDir ? tokenDir.toUpperCase() : scanDir.toUpperCase()} recorded at ${dayjs(
        r.time
      ).format("HH:mm:ss")}`;
      setScanMsg(msg);
      setScanSuccess(true);
      setScanSuccessMsg(msg);
      vibrateOk();
      setTimeout(() => setScanSuccess(false), 2000);
      await load();
    } catch (e) {
      let msg = "Scan failed.";
      try {
        const j = readApiError(e);
        if (j?.error === "jwt_error") msg = "Invalid/expired QR. Ask the part-timer to regenerate.";
        else if (j?.error === "too_far") msg = `Too far from user (> ${j.maxDistanceMeters ?? maxM} m).`;
        else if (j?.error === "event_not_started") msg = "Event not started.";
        else if (j?.error === "bad_token_type") msg = "Bad token type.";
        else if (j?.error === "token_missing_location") msg = "QR code was generated without location.";
        else if (j?.error === "scanner_location_required")
          msg = "Scanner location missing. Allow location on this device.";
        else if (j?.error === "job_not_found") msg = "Job not found for this QR. Maybe for another job.";
        else if (j?.error) msg = String(j.error);
        else if (j?.message) msg = String(j.message);
      } catch {}
      setScanMsg("❌ " + msg);
      console.error("scan error", e);
    } finally {
      setScanBusy(false);
    }
  }

  async function toggleLU(userId, present) {
    await apiPost(`/jobs/${jobId}/loading/mark`, { userId, present });
    const l = await apiGet(`/jobs/${jobId}/loading?_=${Date.now()}`);
    setLU(l);
  }

  /* virtual attendance */
  async function markVirtualPresent(userId, present) {
    if (!job) return;
    try {
      if (present) {
        await apiPost(`/jobs/${jobId}/attendance/mark`, {
          userId,
          inAt: job.startTime,
          outAt: job.endTime,
        });
      } else {
        await apiPost(`/jobs/${jobId}/attendance/mark`, { userId, clear: true });
      }
      await load();
    } catch {
      alert("Mark virtual attendance failed. Make sure the server has /jobs/:id/attendance/mark implemented.");
    }
  }

  /* OT calc */
  const scheduledEndDJ = useMemo(() => (job?.endTime ? dayjs(job.endTime) : null), [job?.endTime]);
  const actualEndIso =
    job?.actualEndAt ||
    job?.endedAt ||
    job?.finishedAt ||
    job?.closedAt ||
    endedAtRef.current ||
    null;
  const actualEndDJ = actualEndIso ? dayjs(actualEndIso) : null;
  const otRoundedHours = useMemo(() => {
    if (!scheduledEndDJ || !actualEndDJ) return 0;
    const minutes = actualEndDJ.diff(scheduledEndDJ, "minute");
    if (minutes <= 0) return 0;
    const baseHours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return baseHours + (remainder > 30 ? 1 : 0);
  }, [scheduledEndDJ, actualEndDJ]);

  if (loading || !job) return <div className="container">Loading…</div>;

  // display rows
  const approvedRows = (job.approved || []).map((uid) => {
    const app = (job.applications || []).find((a) => a.userId === uid) || {};
    const rec = (job.attendance || {})[uid] || {};
    return {
      userId: uid,
      email: app.email || uid,
      name: app.name || app.fullName || app.displayName || "",
      phone: app.phone || app.phoneNumber || "",
      discord: app.discord || app.discordHandle || app.username || "",
      in: rec.in,
      out: rec.out,
    };
  });

  const statusEff = effectiveStatus(job.status);
  const canStart = statusEff === "upcoming";
  const isOngoing = statusEff === "ongoing";

  const precheck = (() => {
    if (!token || !loc) return null;
    const ll = extractLatLngFromToken(token);
    if (!ll) return null;
    const d = haversineMeters(loc, ll);
    if (d == null) return null;
    const maxM = Number(job?.scanMaxMeters) || 500;
    return { d, ok: d <= maxM, maxM };
  })();
  const tokenDir = extractDirFromToken(token);
  const dirMismatch = token && tokenDir && tokenDir !== scanDir;

  const pill = useMemo(() => {
    const s = effectiveStatus(job?.status);
    const bg = s === "ongoing" ? "#d1fae5" : s === "ended" ? "#fee2e2" : "#e5e7eb";
    const fg = s === "ongoing" ? "#065f46" : s === "ended" ? "#991b1b" : "#374151";
    return (
      <span className="status" style={{ background: bg, color: fg }}>
        {s}
      </span>
    );
  }, [job]);

  return (
    <div className="container" style={{ paddingTop: 16 }}>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{job.title}</div>
            <div style={{ color: "#374151", marginTop: 6 }}>{job.description || ""}</div>

            <div style={{ marginTop: 10, display: "flex", gap: 16, flexWrap: "wrap", color: "#374151" }}>
              <div>
                <strong>{job.venue}</strong>
              </div>
              <div>{fmtRange(job.startTime, job.endTime)}</div>
              <div>Headcount: {job.headcount}</div>
              <div>Early call: {job.earlyCall?.enabled ? `Yes (RM ${job.earlyCall.amount})` : "No"}</div>
              {isVirtual && <div style={{ fontWeight: 700, color: "#7c3aed" }}>Mode: Virtual (no scanning)</div>}
            </div>

            <div
              className="card"
              style={{
                marginTop: 10,
                padding: 10,
                background: "#f8fafc",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <div>
                  <b>Initial End Time:</b>
                  <br />
                  {fmtDateTime(job.endTime) || "-"}
                </div>
                <div>
                  <b>PM Ended At:</b>
                  <br />
                  {actualEndDJ ? fmtDateTime(actualEndDJ.toISOString()) : "— (not ended)"}
                </div>
                <div>
                  <b>OT (rounded hours):</b>
                  <br />
                  {actualEndDJ ? (otRoundedHours > 0 ? `${otRoundedHours} hour(s)` : "0 (no OT)") : "—"}
                </div>
              </div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                OT rule: whole hours only — ≤30 min rounds down, &gt;30 min rounds up.
              </div>
            </div>
          </div>
          <div>{pill}</div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
          {canStart ? (
            <button className="btn red" onClick={startAndOpen} disabled={startBusy}>
              {startBusy ? "Starting…" : isVirtual ? "Start event" : "Start event & open scanner"}
            </button>
          ) : isOngoing ? (
            <button className="btn gray" disabled>
              Started
            </button>
          ) : (
            <button className="btn gray" disabled>
              Ended
            </button>
          )}

          {isOngoing && !isVirtual && !scannerOpen && (
            <button className="btn" onClick={openScanner}>
              Open scanner
            </button>
          )}
          {!isVirtual && scannerOpen && (
            <button className="btn gray" onClick={closeScanner}>
              Hide scanner
            </button>
          )}

          <button className="btn" onClick={() => resetEvent(true)}>
            Reset (keep attendance)
          </button>
          <button className="btn danger" onClick={() => resetEvent(false)}>
            Reset (delete attendance)
          </button>
          <button className="btn" onClick={endEvent}>
            End event
          </button>
        </div>
      </div>

      {/* Applicants */}
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Applicants</div>

        <div style={applHeaderRow}>
          <div>Email</div>
          <div>Name</div>
          <div>Phone</div>
          <div>Discord</div>
          <div>Transport</div>
          <div>Status</div>
          <div>L&amp;U</div>
          <div>Actions</div>
        </div>

        {applicants.length === 0 ? (
          <div style={{ padding: 12, color: "#6b7280" }}>No applicants yet.</div>
        ) : (
          applicants.map((a) => (
            <div key={a.userId} style={applBodyRow}>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{a.email}</div>
              <div>{a.name || a.fullName || a.displayName || "-"}</div>
              <div>{a.phone || a.phoneNumber || "-"}</div>
              <div>{a.discord || a.discordHandle || a.username || "-"}</div>
              <div>{a.transport || "-"}</div>
              <div style={{ textTransform: "capitalize" }}>{a.status}</div>
              <div>
                {a.luApplied ? (
                  <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={a.luConfirmed}
                      onChange={(e) => toggleLU(a.userId, e.target.checked)}
                    />
                    <span>Confirmed</span>
                  </label>
                ) : (
                  "—"
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="btn green" onClick={() => setApproval(a.userId, true)}>
                  Approve
                </button>
                <button className="btn danger" onClick={() => setApproval(a.userId, false)}>
                  Reject
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Attendance */}
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Approved List & Attendance</div>

        {isVirtual && (
          <div className="card" style={{ padding: 12, marginBottom: 8, border: "1px dashed #e5e7eb" }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Virtual attendance</div>
            <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 6 }}>
              Tick <b>Present</b> to include a person for base hours. Overtime is computed automatically when you click{" "}
              <b>End event</b>.
            </div>
            <div style={{ overflowX: "auto" }}>
              <table width="100%" cellPadding="8" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #ddd" }}>
                    <th align="left">Email</th>
                    <th align="center">Present</th>
                  </tr>
                </thead>
                <tbody>
                  {(job.approved || []).length === 0 ? (
                    <tr>
                      <td colSpan={2} style={{ color: "#6b7280" }}>
                        No approved users yet.
                      </td>
                    </tr>
                  ) : (
                    (job.approved || []).map((uid) => {
                      const app = (job.applications || []).find((a) => a.userId === uid);
                      const rec = (job.attendance || {})[uid] || {};
                      const present = !!rec.in && !!rec.out;
                      return (
                        <tr key={uid} style={{ borderBottom: "1px solid #f0f0f0" }}>
                          <td>{app?.email || uid}</td>
                          <td align="center">
                            <input
                              type="checkbox"
                              checked={present}
                              onChange={(e) => markVirtualPresent(uid, e.target.checked)}
                            />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!isVirtual && (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th style={{ width: 180 }}>Name</th>
                  <th style={{ width: 130 }}>Phone</th>
                  <th style={{ width: 160 }}>Discord</th>
                  <th style={{ width: 120, textAlign: "center" }}>In</th>
                  <th style={{ width: 120, textAlign: "center" }}>Out</th>
                </tr>
              </thead>
            </table>
            <div
              style={{
                maxHeight: 340,
                overflow: "auto",
                border: "1px solid var(--border)",
                borderTop: 0,
                borderRadius: "0 0 8px 8px",
              }}
            >
              <table className="table" style={{ border: "none", margin: 0 }}>
                <tbody>
                  {approvedRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ color: "#6b7280" }}>
                        No approved users yet.
                      </td>
                    </tr>
                  ) : (
                    approvedRows.map((r) => (
                      <tr key={r.email}>
                        <td>{r.email}</td>
                        <td>{r.name || "-"}</td>
                        <td>{r.phone || "-"}</td>
                        <td>{r.discord || "-"}</td>
                        <td
                          style={{
                            width: 120,
                            textAlign: "center",
                            fontFamily:
                              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {fmtTime(r.in)}
                        </td>
                        <td
                          style={{
                            width: 120,
                            textAlign: "center",
                            fontFamily:
                              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {fmtTime(r.out)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* FULLSCREEN SCANNER OVERLAY */}
      {!isVirtual && scannerOpen && (
        <div
          ref={scannerCardRef}
          style={{
            position: "fixed",
            inset: 0,
            background: "#000",
            zIndex: 999,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* this div is where html5-qrcode will put the video */}
          <div
            id="pm-qr-reader"
            style={{
              width: "100%",
              height: "100%",
            }}
          />
          {/* top bar */}
          <div
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              right: 12,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <button
              onClick={closeScanner}
              style={{
                background: "rgba(0,0,0,0.6)",
                color: "white",
                border: "none",
                padding: "6px 12px",
                borderRadius: 8,
                fontWeight: 600,
              }}
            >
              ← Back
            </button>
            <div
              style={{
                background: "rgba(0,0,0,0.4)",
                color: "white",
                padding: "4px 12px",
                borderRadius: 999,
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              <label>
                <input type="radio" name="dir" checked={scanDir === "in"} onChange={() => setScanDir("in")} /> IN
              </label>
              <label>
                <input type="radio" name="dir" checked={scanDir === "out"} onChange={() => setScanDir("out")} /> OUT
              </label>
            </div>
          </div>

          {/* overlay box + line */}
          <div className="pm-scan-box">
            <div className="pm-scan-corner tl" />
            <div className="pm-scan-corner tr" />
            <div className="pm-scan-corner bl" />
            <div className="pm-scan-corner br" />
            <div className="pm-scan-line" />
          </div>

          {/* bottom controls */}
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              padding: 12,
              background: "linear-gradient(transparent, rgba(0,0,0,0.45))",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste decoded QR token here…"
                style={{
                  flex: 1,
                  borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.35)",
                  background: "rgba(0,0,0,0.35)",
                  color: "white",
                  padding: "6px 8px",
                }}
              />
              <button
                onClick={pasteFromClipboard}
                style={{
                  background: "rgba(255,255,255,0.12)",
                  color: "white",
                  border: "none",
                  padding: "6px 10px",
                  borderRadius: 6,
                }}
              >
                Paste
              </button>
              <button
                onClick={() => doScan()}
                disabled={scanBusy || !token}
                style={{
                  background: scanBusy ? "rgba(148,163,184,0.7)" : "#22c55e",
                  color: "white",
                  border: "none",
                  padding: "6px 10px",
                  borderRadius: 6,
                  fontWeight: 600,
                }}
              >
                {scanBusy ? "Scanning…" : "Scan"}
              </button>
            </div>
            <div style={{ color: "white", fontSize: 12 }}>
              {loc
                ? `Scanner location: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`
                : "Waiting for location… allow permission."}
            </div>
            {precheck && (
              <div
                style={{
                  background: precheck.ok ? "rgba(34,197,94,0.15)" : "rgba(248,113,113,0.25)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 6,
                  padding: 6,
                  color: "white",
                  fontSize: 12,
                }}
              >
                Distance to applicant (precheck): <b>{precheck.d} m</b>{" "}
                {precheck.ok ? "(OK)" : ` (> ${precheck.maxM} m)`}
              </div>
            )}
            {dirMismatch && (
              <div
                style={{
                  background: "rgba(250,204,21,0.3)",
                  border: "1px solid rgba(250,204,21,0.5)",
                  borderRadius: 6,
                  padding: 6,
                  color: "white",
                  fontSize: 12,
                }}
              >
                Token is for <b>{tokenDir.toUpperCase()}</b> but you selected <b>{scanDir.toUpperCase()}</b>.
              </div>
            )}
            {scanMsg && (
              <div
                style={{
                  background: "rgba(15,23,42,0.45)",
                  borderRadius: 6,
                  padding: 6,
                  color: "white",
                  fontSize: 12,
                }}
              >
                {scanMsg}
              </div>
            )}
          </div>

          {/* success bubble */}
          {scanSuccess && (
            <div
              style={{
                position: "absolute",
                top: "45%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                background: "rgba(34,197,94,0.9)",
                color: "white",
                padding: "10px 18px",
                borderRadius: 999,
                fontWeight: 700,
                boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
              }}
            >
              {scanSuccessMsg || "Scan successful"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
