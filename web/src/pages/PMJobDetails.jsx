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

/* ----- Token helpers ----- */
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

  // A) JWT-like
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
  // C) last-two-floats
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
    return payload?.dir ?? null; // "in" | "out"
  } catch {
    return null;
  }
}

function extractUserKeyFromToken(token) {
  if (!token || typeof token !== "string") return null;

  // A) JWT-like
  if (token.includes(".")) {
    try {
      const payload = JSON.parse(b64urlDecode(token.split(".")[1]));
      const key =
        payload?.userId ??
        payload?.uid ??
        payload?.sub ??
        payload?.email ??
        payload?.user ??
        payload?.id ??
        null;
      if (typeof key === "string" || typeof key === "number") return String(key);
    } catch {}
  }

  // B) querystring
  try {
    const qs = token.includes("?") ? token.split("?")[1] : token;
    const sp = new URLSearchParams(qs);
    const key =
      sp.get("userId") || sp.get("uid") || sp.get("sub") || sp.get("email") || sp.get("id");
    if (key) return String(key);
  } catch {}

  return null;
}

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
  return {};
}

/* normalize helpers for sets */
function normalizeUserKey(v) {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object") return v.userId || v.id || v.email || null;
  return null;
}
function toKeySet(list) {
  const s = new Set();
  const arr = Array.isArray(list) ? list : list ? [list] : [];
  for (const item of arr) {
    const k = normalizeUserKey(item);
    if (k) s.add(k);
  }
  return s;
}

async function apiPostFallback(urls, body) {
  const list = Array.isArray(urls) ? urls : [urls];
  let lastErr = null;
  for (const u of list) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await apiPost(u, body);
    } catch (e) {
      lastErr = e;
      const st = e?.status || e?.response?.status;
      if (st === 404) continue;
      throw e;
    }
  }
  throw lastErr || new Error("Request failed");
}
async function apiGetFallback(urls, fallbackValue) {
  const list = Array.isArray(urls) ? urls : [urls];
  for (const u of list) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await apiGet(u);
    } catch (e) {
      const st = e?.status || e?.response?.status;
      if (st === 404) continue;
    }
  }
  return fallbackValue;
}

/* Applicants table (3 sections) */
function ApplicantsTable({ title, rows, onApprove, onReject }) {
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>
        {title} <span style={{ color: "#6b7280", fontWeight: 600 }}>({rows.length})</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #e5e7eb" }}>
              <th style={{ textAlign: "left", padding: "10px 8px", width: 60 }}>No.</th>
              <th style={{ textAlign: "left", padding: "10px 8px" }}>Email</th>
              <th style={{ textAlign: "left", padding: "10px 8px" }}>Name</th>
              <th style={{ textAlign: "left", padding: "10px 8px" }}>Phone</th>
              <th style={{ textAlign: "left", padding: "10px 8px" }}>Discord</th>
              <th style={{ textAlign: "left", padding: "10px 8px" }}>Transport</th>
              <th style={{ textAlign: "left", padding: "10px 8px" }}>Status</th>
              <th style={{ textAlign: "left", padding: "10px 8px" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: 12, color: "#6b7280" }}>
                  No records.
                </td>
              </tr>
            ) : (
              rows.map((a, idx) => (
                <tr key={a.userId || a.email || idx} style={{ borderTop: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "10px 8px", fontWeight: 700 }}>{idx + 1}.</td>
                  <td
                    style={{
                      padding: "10px 8px",
                      maxWidth: 260,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {a.email}
                  </td>
                  <td style={{ padding: "10px 8px" }}>{a.name || a.fullName || a.displayName || "-"}</td>
                  <td style={{ padding: "10px 8px" }}>{a.phone || a.phoneNumber || "-"}</td>
                  <td style={{ padding: "10px 8px" }}>{a.discord || a.discordHandle || a.username || "-"}</td>
                  <td style={{ padding: "10px 8px" }}>{a.transport || "-"}</td>
                  <td style={{ padding: "10px 8px", textTransform: "capitalize" }}>{a.status || "Applied"}</td>
                  <td style={{ padding: "10px 8px" }}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        className="btn"
                        style={{ background: "#22c55e", color: "#fff" }}
                        onClick={() => onApprove(a.userId)}
                      >
                        Approve
                      </button>
                      <button className="btn danger" onClick={() => onReject(a.userId)}>
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function PMJobDetails({ jobId }) {
  /* ---------- state ---------- */
  const [job, setJob] = useState(null);
  const [applicants, setApplicants] = useState([]);
  const [lu, setLU] = useState({ quota: 0, applicants: [], participants: [] });
  const [early, setEarly] = useState({ applicants: [], participants: [] });
  const [loading, setLoading] = useState(true);

  const [statusForce, setStatusForce] = useState(null);
  const effectiveStatus = (s) => statusForce ?? s ?? "upcoming";

  // scanner
  const [scannerOpen, setScannerOpen] = useState(false);
  const [token, setToken] = useState("");
  const [scanMsg, setScanMsg] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [scanPopup, setScanPopup] = useState(null); // {kind,text}

  // addon toggles busy
  const [addonBusy, setAddonBusy] = useState({}); // { "<userId>:<kind>": boolean }

  // camera
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const lastDecodedRef = useRef("");
  const [camReady, setCamReady] = useState(false);

  // ✅ local lock to prevent overwrite within the same open session (fast double scans etc.)
  const scanLockRef = useRef({
    in: new Set(),
    out: new Set(),
  });

  // geo
  const [loc, setLoc] = useState(null);
  const locRef = useRef(null);
  useEffect(() => {
    locRef.current = loc;
  }, [loc]);

  const watchIdRef = useRef(null);
  const hbTimerRef = useRef(null);
  const pendingTokenRef = useRef(null); // for “GPS not ready yet”

  // end time cache
  const endedAtRef = useRef(null);
  const LOCAL_KEY = (id) => `atag.jobs.${id}.actualEndAt`;

  /* ---------- load job (with silent) ---------- */
  async function load(silent = false) {
    if (!silent) setLoading(true);
    const bust = `?_=${Date.now()}`;
    try {
      const j = await apiGet(`/jobs/${jobId}${bust}`);
      let merged = statusForce ? { ...j, status: statusForce } : j;

      const serverAltEnd =
        merged.actualEndAt || merged.endedAt || merged.finishedAt || merged.closedAt || null;

      const cachedEnd = LOCAL_KEY(jobId) ? localStorage.getItem(LOCAL_KEY(jobId)) : null;
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

      // Early Call participants (fallback to avoid crash if route not ready)
      const ec = await apiGetFallback(
        [
          `/jobs/${jobId}/early-call${bust}`,
          `/jobs/${jobId}/earlycall${bust}`,
          `/jobs/${jobId}/earlyCall${bust}`,
        ],
        { applicants: [], participants: [] }
      );
      setEarly(ec);
    } catch (e) {
      if (e && e.status === 401) {
        window.location.replace("#/login");
      } else {
        console.error("load job failed", e);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const isVirtual = useMemo(() => isVirtualJob(job), [job]);

  /* lock scroll when scanner open */
  useEffect(() => {
    if (!scannerOpen) return;
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, [scannerOpen]);

  /* jsQR loader */
  function ensureJsQR() {
    return new Promise((resolve, reject) => {
      if (window.jsQR) return resolve(true);
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
      s.async = true;
      s.onload = () => (window.jsQR ? resolve(true) : reject(new Error("jsQR not available")));
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  /* camera start/stop */
  async function startCamera() {
    try {
      await ensureJsQR();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();
      setCamReady(true);
      startScanLoop();
    } catch (e) {
      console.error("camera error", e);
      setScanMsg("Camera not available or permission denied.");
    }
  }
  function stopCamera() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setCamReady(false);
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((t) => t.stop());
      } catch {}
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function openScanner() {
    setScanMsg("");
    setToken("");
    lastDecodedRef.current = "";
    pendingTokenRef.current = null;

    // reset local scan locks each time scanner opens (optional; keeps it simple)
    scanLockRef.current = { in: new Set(), out: new Set() };

    setScannerOpen(true);
  }
  function closeScanner() {
    setScannerOpen(false);
    stopCamera();
    stopHeartbeat();
  }

  useEffect(() => {
    if (scannerOpen && !isVirtual) startCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerOpen, isVirtual]);

  /* scan loop */
  function startScanLoop() {
    const loop = () => {
      if (!videoRef.current || !canvasRef.current || !window.jsQR) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const qr = window.jsQR(imgData.data, imgData.width, imgData.height, {
        inversionAttempts: "attemptBoth",
      });
      if (qr && qr.data) {
        const decoded = qr.data.trim();
        if (decoded && decoded !== lastDecodedRef.current) {
          lastDecodedRef.current = decoded;
          handleDecoded(decoded);
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }

  /* geo heartbeat: watch once; send heartbeat using latest ref */
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
      const L = locRef.current;
      if (L)
        apiPost(`/jobs/${jobId}/scanner/heartbeat`, {
          lat: L.lat,
          lng: L.lng,
        }).catch(() => {});
    }, 10000);

    return () => stopHeartbeat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannerOpen, jobId]);

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

  /* if GPS arrives and we had a QR waiting, auto-scan it */
  useEffect(() => {
    if (!scannerOpen) return;
    if (loc && pendingTokenRef.current) {
      const t = pendingTokenRef.current;
      pendingTokenRef.current = null;
      setScanMsg("");
      doScan(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc?.lat, loc?.lng, scannerOpen]);

  function vibrateOk() {
    try {
      if (navigator.vibrate) navigator.vibrate(120);
    } catch {}
  }

  async function handleDecoded(decoded) {
    setToken(decoded);
    await doScan(decoded);
  }

  async function pasteFromClipboard() {
    try {
      const t = await navigator.clipboard.readText();
      if (t) {
        setToken(t.trim());
        await doScan(t.trim());
      }
    } catch {}
  }

  function popupError(text) {
    setScanMsg("❌ " + text);
    setScanPopup({ kind: "error", text });
    setTimeout(() => setScanPopup(null), 1800);
    setToken("");
    setTimeout(() => {
      lastDecodedRef.current = "";
    }, 600);
  }

  async function doScan(manualToken) {
    const useToken = manualToken || token;
    if (!useToken) {
      setScanMsg("No token detected.");
      return;
    }

    if (!loc) {
      setScanMsg("Getting your location… allow location and try again.");
      pendingTokenRef.current = useToken;
      setTimeout(() => {
        lastDecodedRef.current = "";
      }, 600);
      return;
    }

    const applicantLL = extractLatLngFromToken(useToken);
    const maxM = Number(job?.scanMaxMeters) || 500;
    if (applicantLL) {
      const d = haversineMeters(loc, applicantLL);
      if (d != null && d > maxM) {
        popupError("Too far from part-timer.");
        return;
      }
    }

    // ✅ First-scan-wins guard: prevent overwriting IN/OUT once already recorded
    const tokenDir = extractDirFromToken(useToken); // "in" | "out" | null
    const tokenUserKey = extractUserKeyFromToken(useToken); // userId/email/sub (best effort)

    // Build candidate keys to match attendance map (userId/email)
    const candidateKeys = [];
    if (tokenUserKey) candidateKeys.push(tokenUserKey);

    if (tokenUserKey) {
      const app =
        (applicants || []).find((a) => a.userId === tokenUserKey || a.email === tokenUserKey) || null;
      if (app?.userId && app.userId !== tokenUserKey) candidateKeys.push(app.userId);
      if (app?.email && app.email !== tokenUserKey) candidateKeys.push(app.email);
    }

    // local lock (fast repeated scans before reload)
    if (tokenDir && candidateKeys.length) {
      const lockSet = scanLockRef.current?.[tokenDir];
      if (lockSet) {
        const hit = candidateKeys.find((k) => lockSet.has(k));
        if (hit) {
          const when =
            tokenDir === "in"
              ? "Already checked-in (locked). Please scan OUT QR."
              : "Already checked-out (locked).";
          popupError(when);
          return;
        }
      }
    }

    // server-known attendance check (prevents overwrite across reloads)
    if (tokenDir && candidateKeys.length) {
      const attendanceMap = job?.attendance || {};
      let rec = null;
      for (const k of candidateKeys) {
        if (attendanceMap?.[k]) {
          rec = attendanceMap[k];
          break;
        }
      }

      if (tokenDir === "in" && rec?.in) {
        popupError(`Already checked-in at ${fmtTime(rec.in)}. Please scan OUT QR.`);
        return;
      }
      if (tokenDir === "out" && rec?.out) {
        popupError(`Already checked-out at ${fmtTime(rec.out)}.`);
        return;
      }
    }

    setScanMsg("");
    setScanBusy(true);
    try {
      const r = await apiPost("/scan", {
        token: useToken,
        scannerLat: loc.lat,
        scannerLng: loc.lng,
      });

      const msg = `Scan OK at ${dayjs(r.time).format("HH:mm:ss")}`;
      setScanMsg("✅ " + msg);
      setScanPopup({ kind: "success", text: msg });
      vibrateOk();
      setTimeout(() => setScanPopup(null), 1500);

      // ✅ lock after success (so a later accidental re-scan won't overwrite)
      if (tokenDir && candidateKeys.length) {
        const lockSet = scanLockRef.current?.[tokenDir];
        if (lockSet) candidateKeys.forEach((k) => lockSet.add(k));
      }

      setToken("");
      load(true);
    } catch (e) {
      let msg = "Scan failed.";
      const j = readApiError(e);
      if (j?.error === "jwt_error") msg = "Invalid/expired QR. Ask to regenerate.";
      else if (j?.error === "too_far") msg = "Too far from user.";
      else if (j?.error === "event_not_started") msg = "Event not started.";
      else if (j?.error === "scanner_location_required") msg = "Scanner location missing.";
      else if (j?.error) msg = j.error;

      setScanMsg("❌ " + msg);
      setScanPopup({ kind: "error", text: msg });
      setTimeout(() => setScanPopup(null), 2000);
      console.error("scan error", e);
    } finally {
      setScanBusy(false);
      setTimeout(() => {
        lastDecodedRef.current = "";
      }, 600);
    }
  }

  /* start / end / reset */
  async function startAndOpen() {
    if (!job) return;
    if (effectiveStatus(job.status) !== "upcoming") return;
    setStartBusy(true);
    try {
      setStatusForce("ongoing");
      setJob((prev) => (prev ? { ...prev, status: "ongoing" } : prev));
      await apiPost(`/jobs/${jobId}/start`, {});
      if (!isVirtual) openScanner();
      setTimeout(() => load(true), 200);
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
      setScannerOpen(false);
      stopCamera();
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
      stopCamera();
      stopHeartbeat();
      setTimeout(load, 300);
    } catch (e) {
      await load();
      alert("Reset failed: " + e);
    }
  }

  async function setApproval(userId, approve) {
    await apiPost(`/jobs/${jobId}/approve`, { userId, approve });
    await load();
  }

  // Loading/Unloading confirm (existing endpoint)
  async function toggleLU(userId, present) {
    await apiPost(`/jobs/${jobId}/loading/mark`, { userId, present });
    const l = await apiGet(`/jobs/${jobId}/loading?_=${Date.now()}`);
    setLU(l);
  }

  // Early call confirm (try common endpoints)
  async function toggleEarlyCall(userId, present) {
    await apiPostFallback(
      [
        `/jobs/${jobId}/early-call/mark`,
        `/jobs/${jobId}/earlycall/mark`,
        `/jobs/${jobId}/earlyCall/mark`,
      ],
      { userId, present }
    );
    const ec = await apiGetFallback(
      [
        `/jobs/${jobId}/early-call?_=${Date.now()}`,
        `/jobs/${jobId}/earlycall?_=${Date.now()}`,
        `/jobs/${jobId}/earlyCall?_=${Date.now()}`,
      ],
      { applicants: [], participants: [] }
    );
    setEarly(ec);
  }

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
      alert("Mark virtual attendance failed.");
    }
  }

  async function onToggle(kind, userId, checked) {
    const key = `${userId}:${kind}`;
    setAddonBusy((p) => ({ ...p, [key]: true }));
    try {
      if (kind === "lu") await toggleLU(userId, checked);
      if (kind === "early") await toggleEarlyCall(userId, checked);
      await load(true);
    } catch (e) {
      console.error("toggle failed", kind, e);
      alert("Update failed. If Early Call route not added yet, please add backend endpoint.");
      await load(true);
    } finally {
      setAddonBusy((p) => ({ ...p, [key]: false }));
    }
  }

  /* OT calc (hooks must stay ABOVE any early return) */
  const scheduledEndDJ = useMemo(() => (job?.endTime ? dayjs(job.endTime) : null), [job?.endTime]);
  const actualEndIso =
    job?.actualEndAt || job?.endedAt || job?.finishedAt || job?.closedAt || endedAtRef.current || null;
  const actualEndDJ = actualEndIso ? dayjs(actualEndIso) : null;

  const otRoundedHours = useMemo(() => {
    if (!scheduledEndDJ || !actualEndDJ) return 0;
    const minutes = actualEndDJ.diff(scheduledEndDJ, "minute");
    if (minutes <= 0) return 0;
    const baseHours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return baseHours + (remainder > 30 ? 1 : 0);
  }, [scheduledEndDJ, actualEndDJ]);

  // ✅ IMPORTANT: no hooks below this line
  if (loading || !job) return <div className="container">Loading…</div>;

  // helper to find applicant data for an approved id
  function findApplicant(id) {
    return (
      applicants.find((a) => a.userId === id || a.email === id) ||
      (job.applications || []).find((a) => a.userId === id || a.email === id) ||
      null
    );
  }

  const luSet = toKeySet(lu?.participants || []);
  const earlySet = toKeySet(early?.participants || []);

  // display rows
  const approvedRows = (job.approved || []).map((uid) => {
    const app = findApplicant(uid) || {};
    const attendanceMap = job.attendance || {};
    const rec = attendanceMap[uid] || attendanceMap[app.userId] || attendanceMap[app.email] || {};

    const keys = [uid, app.userId, app.email].filter(Boolean);
    const hasLU = keys.some((k) => luSet.has(k)) || !!app.luConfirmed;
    const hasEarly = keys.some((k) => earlySet.has(k)) || !!app.earlyCallConfirmed;

    return {
      userId: uid,
      email: app.email || uid,
      name: app.name || app.fullName || app.displayName || "",
      phone: app.phone || app.phoneNumber || "",
      discord: app.discord || app.discordHandle || app.username || "",
      in: rec.in,
      out: rec.out,
      hasLU,
      hasEarly,
      luApplied: !!app.luApplied,
      earlyApplied: !!app.earlyCallApplied,
    };
  });

  const statusEff = effectiveStatus(job.status);
  const canStart = statusEff === "upcoming";
  const isOngoing = statusEff === "ongoing";
  const earlyEnabled = !!job.earlyCall?.enabled;

  const pill = (() => {
    const s = statusEff;
    const bg = s === "ongoing" ? "#d1fae5" : s === "ended" ? "#fee2e2" : "#e5e7eb";
    const fg = s === "ongoing" ? "#065f46" : s === "ended" ? "#991b1b" : "#374151";
    return (
      <span
        className="status"
        style={{
          background: bg,
          color: fg,
          borderRadius: 999,
          padding: "4px 10px",
          fontWeight: 700,
        }}
      >
        {s}
      </span>
    );
  })();

  // Applicants split into 3 tables
  const normStatus = (s) => String(s || "applied").trim().toLowerCase();
  const appliedApplicants = (applicants || []).filter((a) => {
    const st = normStatus(a.status);
    return st === "applied" || st === "pending" || st === "new" || st === "" || st === "null" || st === "undefined";
  });
  const approvedApplicants = (applicants || []).filter((a) => normStatus(a.status) === "approved");
  const rejectedApplicants = (applicants || []).filter((a) => normStatus(a.status) === "rejected");

  return (
    <div className="container" style={{ paddingTop: 16 }}>
      {/* header */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{job.title}</div>
            <div style={{ color: "#374151", marginTop: 6 }}>{job.description || ""}</div>
            <div
              style={{
                marginTop: 10,
                display: "flex",
                gap: 16,
                flexWrap: "wrap",
                color: "#374151",
              }}
            >
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
                border: "1px solid #e2e8f0",
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
              {startBusy ? "Starting…" : isVirtual ? "Start event" : "Start & scan"}
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

      {/* Applicants (3 tables) */}
      <ApplicantsTable
        title="Applicants — Applied"
        rows={appliedApplicants}
        onApprove={(uid) => setApproval(uid, true)}
        onReject={(uid) => setApproval(uid, false)}
      />
      <ApplicantsTable
        title="Applicants — Approved"
        rows={approvedApplicants}
        onApprove={(uid) => setApproval(uid, true)}
        onReject={(uid) => setApproval(uid, false)}
      />
      <ApplicantsTable
        title="Applicants — Rejected"
        rows={rejectedApplicants}
        onApprove={(uid) => setApproval(uid, true)}
        onReject={(uid) => setApproval(uid, false)}
      />

      {/* Approved List & Attendance */}
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Approved List & Attendance</div>
        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ width: "100%", borderCollapse: "collapse", minWidth: 920 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "8px 4px", width: 60 }}>No.</th>
                <th style={{ textAlign: "left", padding: "8px 4px" }}>Email</th>
                <th style={{ textAlign: "left", padding: "8px 4px" }}>Name</th>
                <th style={{ textAlign: "left", padding: "8px 4px" }}>Phone</th>
                <th style={{ textAlign: "left", padding: "8px 4px" }}>Discord</th>
                <th style={{ textAlign: "center", padding: "8px 4px", width: 120 }}>Early Call</th>
                <th style={{ textAlign: "center", padding: "8px 4px", width: 160 }}>Loading/Unloading</th>
                <th style={{ textAlign: "center", padding: "8px 4px", width: 120 }}>In</th>
                <th style={{ textAlign: "center", padding: "8px 4px", width: 120 }}>Out</th>
              </tr>
            </thead>
            <tbody>
              {approvedRows.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ color: "#6b7280", padding: 8 }}>
                    No approved users yet.
                  </td>
                </tr>
              ) : (
                approvedRows.map((r, idx) => {
                  const earlyKey = `${r.userId}:early`;
                  const luKey = `${r.userId}:lu`;

                  const earlyDisabled = !earlyEnabled || !!addonBusy[earlyKey];
                  const luDisabled = !!addonBusy[luKey];

                  return (
                    <tr key={r.userId || r.email || idx} style={{ borderTop: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "8px 4px", fontWeight: 700 }}>{idx + 1}.</td>
                      <td style={{ padding: "8px 4px" }}>{r.email}</td>
                      <td style={{ padding: "8px 4px" }}>{r.name || "-"}</td>
                      <td style={{ padding: "8px 4px" }}>{r.phone || "-"}</td>
                      <td style={{ padding: "8px 4px" }}>{r.discord || "-"}</td>

                      <td style={{ padding: "8px 4px", textAlign: "center" }}>
                        {earlyEnabled ? (
                          <input
                            type="checkbox"
                            checked={!!r.hasEarly}
                            disabled={earlyDisabled}
                            onChange={(e) => onToggle("early", r.userId, e.target.checked)}
                            title={r.earlyApplied ? "Early Call (Applied)" : "Early Call"}
                          />
                        ) : (
                          <span style={{ color: "#9ca3af" }}>—</span>
                        )}
                      </td>

                      <td style={{ padding: "8px 4px", textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={!!r.hasLU}
                          disabled={luDisabled}
                          onChange={(e) => onToggle("lu", r.userId, e.target.checked)}
                          title={r.luApplied ? "Loading/Unloading (Applied)" : "Loading/Unloading"}
                        />
                      </td>

                      <td
                        style={{
                          padding: "8px 4px",
                          textAlign: "center",
                          fontFamily:
                            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                        }}
                      >
                        {fmtTime(r.in)}
                      </td>
                      <td
                        style={{
                          padding: "8px 4px",
                          textAlign: "center",
                          fontFamily:
                            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                        }}
                      >
                        {fmtTime(r.out)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---------- SCANNER OVERLAY ---------- */}
      {!isVirtual && scannerOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            width: "100vw",
            maxWidth: "100vw",
            background: "#000",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          <canvas ref={canvasRef} style={{ display: "none" }} />

          <div
            style={{
              position: "absolute",
              top: "18%",
              left: "50%",
              transform: "translateX(-50%)",
              width: "62vw",
              maxWidth: 350,
              height: "38vh",
              maxHeight: 300,
              border: "2px solid rgba(255,255,255,0.35)",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                height: 3,
                background: "#ef4444",
                animation: "scanline 2s infinite",
              }}
            />
          </div>
          <style>{`
            @keyframes scanline {
              0% { top: 4px; }
              50% { top: calc(100% - 6px); }
              100% { top: 4px; }
            }
          `}</style>

          <div
            style={{
              position: "absolute",
              top: 12,
              left: 12,
              right: 12,
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
              justifyContent: "space-between",
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
              }}
            >
              ← Back
            </button>
          </div>

          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              padding: 10,
              background: "linear-gradient(transparent, rgba(0,0,0,0.6))",
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", width: "100%" }}>
              <input
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Token…"
                style={{
                  flex: "1 1 120px",
                  minWidth: 0,
                  borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.35)",
                  background: "rgba(0,0,0,0.35)",
                  color: "white",
                  padding: "6px 8px",
                  fontSize: 13,
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
                  fontSize: 12,
                  flex: "0 0 auto",
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
                  fontSize: 12,
                  flex: "0 0 auto",
                }}
              >
                {scanBusy ? "..." : "Scan"}
              </button>
            </div>
            <div style={{ color: "white", fontSize: 11 }}>
              {camReady ? "Camera ready — point at a QR code." : "Opening camera…"}
            </div>
            <div style={{ color: "white", fontSize: 11 }}>
              {loc ? `Location: ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}` : "Getting your location…"}
            </div>
            {scanMsg && <div style={{ color: "white", fontSize: 11 }}>{scanMsg}</div>}
          </div>

          {scanPopup && (
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                background: scanPopup.kind === "success" ? "rgba(34,197,94,0.9)" : "rgba(248,113,113,0.9)",
                color: "white",
                padding: "10px 20px",
                borderRadius: 999,
                fontWeight: 700,
                textAlign: "center",
                maxWidth: "80%",
                boxShadow: "0 10px 40px rgba(0,0,0,0.35)",
              }}
            >
              {scanPopup.text}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
