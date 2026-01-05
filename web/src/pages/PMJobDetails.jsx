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
    return payload?.dir ?? null;
  } catch {
    return null;
  }
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

/* ---------- UI helpers ---------- */
function initials(nameOrEmail) {
  const s = String(nameOrEmail || "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/).slice(0, 2);
  const t = parts.map((p) => p[0]).join("");
  return t.toUpperCase();
}
function safeVal(v) {
  return v == null || v === "" ? "-" : v;
}
function normalizeIdList(v) {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "object" ? x.userId || x.email || x.id : x))
      .filter(Boolean);
  }
  if (typeof v === "object") return Object.keys(v);
  return [];
}
function makeSet(...lists) {
  const s = new Set();
  lists.flat().forEach((x) => {
    if (x == null) return;
    if (typeof x === "string" || typeof x === "number") s.add(String(x));
  });
  return s;
}

function Switch({ label, checked, disabled, onChange }) {
  return (
    <label className={`atagSwitchWrap ${disabled ? "isDisabled" : ""}`}>
      <input
        type="checkbox"
        checked={!!checked}
        disabled={!!disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span className="atagSwitch" aria-hidden="true" />
      <span className="atagSwitchLabel">{label}</span>
    </label>
  );
}

function Section({ title, right, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="atagCard" style={{ marginTop: 14 }}>
      <div className="atagCardHead">
        <button className="atagHeadBtn" onClick={() => setOpen((v) => !v)} type="button">
          <span className="atagChevron">{open ? "▾" : "▸"}</span>
          <span className="atagHeadTitle">{title}</span>
        </button>
        <div className="atagHeadRight">{right}</div>
      </div>
      {open && <div className="atagCardBody">{children}</div>}
    </div>
  );
}

export default function PMJobDetails({ jobId }) {
  /* ---------- state ---------- */
  const [job, setJob] = useState(null);
  const [applicants, setApplicants] = useState([]);
  const [lu, setLU] = useState({ quota: 0, applicants: [], participants: [] }); // Loading/Unloading participants
  const [ec, setEC] = useState({ participants: [] }); // Early Call participants (optional endpoint)
  const [loading, setLoading] = useState(true);

  const [statusForce, setStatusForce] = useState(null);
  const effectiveStatus = (s) => statusForce ?? s ?? "upcoming";

  // scanner
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanDir, setScanDir] = useState("in");
  const [token, setToken] = useState("");
  const [scanMsg, setScanMsg] = useState("");
  const [scanBusy, setScanBusy] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [scanPopup, setScanPopup] = useState(null); // {kind,text}

  // camera
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const lastDecodedRef = useRef("");
  const [camReady, setCamReady] = useState(false);

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

      // Optional early-call participants endpoint (safe if missing)
      const e = await apiGet(`/jobs/${jobId}/earlycall${bust}`).catch(() => ({ participants: [] }));
      setEC(e);
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
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  function openScanner() {
    setScanMsg("");
    setToken("");
    lastDecodedRef.current = "";
    pendingTokenRef.current = null;
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

    return () => {
      stopHeartbeat();
    };
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

    // local distance precheck (scanner vs applicant)
    const applicantLL = extractLatLngFromToken(useToken);
    const maxM = Number(job?.scanMaxMeters) || 500;
    if (applicantLL) {
      const d = haversineMeters(loc, applicantLL);
      if (d != null && d > maxM) {
        const text = "Too far from part-timer.";
        setScanMsg("❌ " + text);
        setScanPopup({ kind: "error", text });
        setTimeout(() => setScanPopup(null), 1800);
        setToken("");
        setTimeout(() => {
          lastDecodedRef.current = "";
        }, 600);
        return;
      }
    }

    const tokenDir = extractDirFromToken(useToken);
    if (tokenDir && tokenDir !== scanDir) {
      setScanMsg(
        `Token is for "${tokenDir.toUpperCase()}" but you selected "${scanDir.toUpperCase()}". Proceeding…`
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
      const msg = `Scan OK at ${dayjs(r.time).format("HH:mm:ss")}`;
      setScanMsg("✅ " + msg);
      setScanPopup({ kind: "success", text: msg });
      vibrateOk();
      setTimeout(() => setScanPopup(null), 1500);

      setToken(""); // allow second scan
      load(true); // silent refresh of attendance
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

  // Loading/Unloading toggle (reused, but now placed in Approved List)
  async function toggleLoadingUnloading(userId, enabled) {
    try {
      await apiPost(`/jobs/${jobId}/loading/mark`, { userId, present: enabled });
      const l = await apiGet(`/jobs/${jobId}/loading?_=${Date.now()}`).catch(() => null);
      if (l) setLU(l);
      else load(true);
    } catch (e) {
      console.error("toggle L&U failed", e);
      alert("Loading/Unloading toggle failed.");
    }
  }

  // Early call toggle (needs backend endpoint)
  async function toggleEarlyCall(userId, enabled) {
    try {
      await apiPost(`/jobs/${jobId}/earlycall/mark`, { userId, enabled, present: enabled });
      const e = await apiGet(`/jobs/${jobId}/earlycall?_=${Date.now()}`).catch(() => null);
      if (e) setEC(e);
      else load(true);
    } catch (err) {
      console.error("toggle early call failed", err);
      alert(
        "Early Call toggle failed. If you haven't added the API yet, implement POST /jobs/:id/earlycall/mark (and optionally GET /jobs/:id/earlycall)."
      );
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

  // helper to find applicant data for an approved id
  function findApplicant(id) {
    return (
      applicants.find((a) => a.userId === id || a.email === id) ||
      (job.applications || []).find((a) => a.userId === id || a.email === id) ||
      null
    );
  }

  const statusEff = effectiveStatus(job.status);
  const canStart = statusEff === "upcoming";
  const isOngoing = statusEff === "ongoing";

  const pill = (() => {
    const s = statusEff;
    const bg = s === "ongoing" ? "#d1fae5" : s === "ended" ? "#fee2e2" : "#eef2f7";
    const fg = s === "ongoing" ? "#065f46" : s === "ended" ? "#991b1b" : "#334155";
    return (
      <span className="atagPill" style={{ background: bg, color: fg }}>
        {s}
      </span>
    );
  })();

  // Build sets for toggles (robust across possible shapes)
  const luSet = useMemo(() => {
    const ids = normalizeIdList(lu?.participants);
    return makeSet(ids);
  }, [lu?.participants]);

  const ecSet = useMemo(() => {
    const fromEndpoint = normalizeIdList(ec?.participants);
    const fromJob =
      normalizeIdList(job?.earlyCall?.participants) ||
      normalizeIdList(job?.earlyCallParticipants) ||
      normalizeIdList(job?.earlyCallUsers) ||
      normalizeIdList(job?.earlyCallUserIds);
    return makeSet(fromEndpoint, fromJob);
  }, [ec?.participants, job]);

  // Display rows for Approved (now includes numbering + toggles)
  const approvedRows = useMemo(() => {
    const attendanceMap = job.attendance || {};
    return (job.approved || []).map((uid) => {
      const app = findApplicant(uid) || {};
      const rec =
        attendanceMap[uid] ||
        attendanceMap[app.userId] ||
        attendanceMap[app.email] ||
        {};
      const email = app.email || uid;
      const key = String(uid);

      // Guess flags from applicant if present, else from sets
      const earlyCallOn =
        !!app.earlyCallConfirmed ||
        !!app.earlyCallSelected ||
        !!app.earlyCall ||
        ecSet.has(String(uid)) ||
        ecSet.has(String(email));

      const luOn =
        !!app.luConfirmed ||
        luSet.has(String(uid)) ||
        luSet.has(String(email));

      return {
        userId: key,
        email,
        name: app.name || app.fullName || app.displayName || "",
        phone: app.phone || app.phoneNumber || "",
        discord: app.discord || app.discordHandle || app.username || "",
        in: rec.in,
        out: rec.out,
        earlyCallOn,
        luOn,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, applicants, ecSet, luSet]);

  const approvedCount = approvedRows.length;

  return (
    <div className="container" style={{ paddingTop: 16 }}>
      <style>{`
        .atagWrap { max-width: 1100px; margin: 0 auto; }
        .atagCard { background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; box-shadow: 0 1px 2px rgba(0,0,0,.04); overflow: hidden; }
        .atagCardBody { padding: 14px; }
        .atagCardHead { display:flex; align-items:center; justify-content:space-between; gap:10px; padding: 12px 14px; background:#fafafa; border-bottom:1px solid #eef2f7; }
        .atagHeadBtn { display:flex; align-items:center; gap:10px; background:transparent; border:none; padding:0; cursor:pointer; }
        .atagChevron { width:18px; text-align:center; color:#64748b; font-weight:800; }
        .atagHeadTitle { font-weight:900; color:#0f172a; }
        .atagHeadRight { display:flex; align-items:center; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
        .atagPill { border-radius: 999px; padding: 4px 10px; font-weight: 800; text-transform: capitalize; font-size: 12px; }
        .atagChip { border:1px solid #e5e7eb; border-radius:999px; padding:3px 10px; font-size:12px; color:#334155; background:#fff; }
        .atagMeta { display:flex; gap:12px; flex-wrap:wrap; color:#334155; font-size:13px; }
        .atagTitleRow { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
        .atagTitle { font-size: 20px; font-weight: 900; color:#0f172a; line-height:1.1; }
        .atagSub { color:#475569; margin-top:6px; font-size:13px; }
        .atagStats { margin-top:10px; display:grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap:10px; }
        .atagStat { border:1px solid #eef2f7; border-radius:12px; padding:10px; background:#fbfdff; }
        .atagStat b { color:#0f172a; }
        .atagBtns { display:flex; gap:10px; flex-wrap:wrap; margin-top:14px; }
        .atagList { display:flex; flex-direction:column; gap:10px; }
        .atagRow { display:flex; gap:12px; align-items:flex-start; border:1px solid #eef2f7; border-radius:14px; padding:10px 12px; background:#fff; }
        .atagRow:hover { background:#fcfcfd; }
        .atagAvatar { width:34px; height:34px; border-radius:999px; background:#f1f5f9; border:1px solid #e2e8f0; display:flex; align-items:center; justify-content:center; font-weight:900; color:#334155; flex:0 0 auto; }
        .atagMain { flex:1 1 auto; min-width:0; }
        .atagNameLine { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
        .atagName { font-weight:900; color:#0f172a; }
        .atagSmall { color:#64748b; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
        .atagBadges { display:flex; gap:8px; flex-wrap:wrap; margin-top:6px; }
        .atagBadge { font-size:12px; border:1px solid #e5e7eb; border-radius:999px; padding:2px 8px; background:#fff; color:#334155; }
        .atagBadgeOk { border-color:#bbf7d0; background:#f0fdf4; color:#166534; }
        .atagBadgeWarn { border-color:#fecaca; background:#fef2f2; color:#991b1b; }
        .atagActions { display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; align-items:center; }
        .atagNum { width:34px; height:34px; border-radius:10px; background:#0f172a; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:900; flex:0 0 auto; }
        .atagRightCol { display:flex; flex-direction:column; gap:8px; align-items:flex-end; justify-content:center; min-width: 220px; }
        .atagTimes { display:flex; gap:8px; flex-wrap:wrap; }
        .atagTimeChip { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size:12px; border:1px solid #e5e7eb; border-radius:999px; padding:2px 8px; background:#fff; color:#0f172a; }
        .atagSwitchWrap { display:flex; align-items:center; gap:8px; user-select:none; }
        .atagSwitchWrap input { display:none; }
        .atagSwitch { width:38px; height:22px; border-radius:999px; background:#e2e8f0; position:relative; border:1px solid #cbd5e1; transition: all .15s ease; }
        .atagSwitch::after { content:""; position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:999px; background:#fff; border:1px solid #cbd5e1; transition: all .15s ease; }
        .atagSwitchWrap input:checked + .atagSwitch { background:#22c55e; border-color:#16a34a; }
        .atagSwitchWrap input:checked + .atagSwitch::after { left:18px; border-color:#16a34a; }
        .atagSwitchLabel { font-size:12px; color:#334155; font-weight:700; }
        .atagSwitchWrap.isDisabled { opacity:.55; pointer-events:none; }
        @media (max-width: 860px) {
          .atagStats { grid-template-columns: 1fr; }
          .atagRightCol { min-width: 0; align-items:flex-start; }
          .atagRow { flex-direction: column; }
          .atagActions { justify-content:flex-start; }
        }
      `}</style>

      <div className="atagWrap">
        {/* Header */}
        <div className="atagCard">
          <div className="atagCardBody">
            <div className="atagTitleRow">
              <div style={{ minWidth: 0 }}>
                <div className="atagTitle">{job.title}</div>
                {job.description ? <div className="atagSub">{job.description}</div> : null}

                <div className="atagMeta" style={{ marginTop: 10 }}>
                  <span className="atagChip">
                    <b>{safeVal(job.venue)}</b>
                  </span>
                  <span className="atagChip">{fmtRange(job.startTime, job.endTime)}</span>
                  <span className="atagChip">Headcount: {safeVal(job.headcount)}</span>
                  <span className="atagChip">
                    Early call:{" "}
                    {job.earlyCall?.enabled ? `Yes (RM ${job.earlyCall.amount})` : "No"}
                  </span>
                  {isVirtual && (
                    <span className="atagChip" style={{ borderColor: "#ddd6fe", background: "#faf5ff", color: "#6d28d9" }}>
                      Virtual (no scanning)
                    </span>
                  )}
                </div>

                <div className="atagStats">
                  <div className="atagStat">
                    <b>Initial End Time</b>
                    <div style={{ marginTop: 4 }}>{fmtDateTime(job.endTime) || "-"}</div>
                  </div>
                  <div className="atagStat">
                    <b>PM Ended At</b>
                    <div style={{ marginTop: 4 }}>
                      {actualEndDJ ? fmtDateTime(actualEndDJ.toISOString()) : "— (not ended)"}
                    </div>
                  </div>
                  <div className="atagStat">
                    <b>OT (rounded)</b>
                    <div style={{ marginTop: 4 }}>
                      {actualEndDJ
                        ? otRoundedHours > 0
                          ? `${otRoundedHours} hour(s)`
                          : "0 (no OT)"
                        : "—"}
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                      ≤30m round down, &gt;30m round up
                    </div>
                  </div>
                </div>
              </div>
              <div>{pill}</div>
            </div>

            <div className="atagBtns">
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
        </div>

        {/* Applicants (clean list) */}
        <Section
          title={`Applicants`}
          right={<span className="atagChip">{applicants.length} total</span>}
          defaultOpen={true}
        >
          {applicants.length === 0 ? (
            <div style={{ color: "#64748b" }}>No applicants yet.</div>
          ) : (
            <div className="atagList">
              {applicants.map((a) => {
                const name = a.name || a.fullName || a.displayName || a.email;
                const status = String(a.status || "").toLowerCase();
                const statusClass =
                  status === "approved"
                    ? "atagBadgeOk"
                    : status === "rejected"
                      ? "atagBadgeWarn"
                      : "";

                return (
                  <div className="atagRow" key={a.userId || a.email}>
                    <div className="atagAvatar">{initials(name)}</div>

                    <div className="atagMain">
                      <div className="atagNameLine">
                        <div className="atagName">{safeVal(name)}</div>
                      </div>
                      <div className="atagSmall" title={`${a.email || ""} ${a.phone || a.phoneNumber || ""} ${a.discord || a.discordHandle || a.username || ""}`}>
                        {safeVal(a.email)}{" "}
                        {a.phone || a.phoneNumber ? `· ${a.phone || a.phoneNumber}` : ""}
                        {a.discord || a.discordHandle || a.username ? `· ${a.discord || a.discordHandle || a.username}` : ""}
                      </div>

                      <div className="atagBadges">
                        <span className={`atagBadge ${statusClass}`}>Status: {safeVal(a.status)}</span>
                        <span className="atagBadge">Transport: {safeVal(a.transport)}</span>
                      </div>
                    </div>

                    <div className="atagActions">
                      <button
                        className="btn"
                        style={{ background: "#22c55e", color: "#fff" }}
                        onClick={() => setApproval(a.userId, true)}
                      >
                        Approve
                      </button>
                      <button className="btn danger" onClick={() => setApproval(a.userId, false)}>
                        Reject
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* Approved + Attendance (numbered + toggles) */}
        <Section
          title={`Approved List & Attendance`}
          right={<span className="atagChip">{approvedCount} approved</span>}
          defaultOpen={true}
        >
          {approvedRows.length === 0 ? (
            <div style={{ color: "#64748b" }}>No approved users yet.</div>
          ) : (
            <div className="atagList">
              {approvedRows.map((r, idx) => {
                const ecEnabled = !!job?.earlyCall?.enabled;
                return (
                  <div className="atagRow" key={r.userId || r.email}>
                    <div className="atagNum">{idx + 1}</div>

                    <div className="atagMain">
                      <div className="atagNameLine">
                        <div className="atagName">{safeVal(r.name || r.email)}</div>
                      </div>
                      <div className="atagSmall" title={`${r.email} ${r.phone} ${r.discord}`}>
                        {safeVal(r.email)}
                        {r.phone ? ` · ${r.phone}` : ""}
                        {r.discord ? ` · ${r.discord}` : ""}
                      </div>

                      <div className="atagBadges">
                        <span className="atagBadge">Early Call: {ecEnabled ? `RM ${job.earlyCall.amount}` : "N/A"}</span>
                        <span className="atagBadge">L&U: {safeVal(job?.loadingUnloading?.amount ?? job?.loadingUnloadingAmount ?? "—")}</span>
                      </div>
                    </div>

                    <div className="atagRightCol">
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "flex-end" }}>
                        <Switch
                          label="Early Call"
                          checked={!!r.earlyCallOn}
                          disabled={!ecEnabled}
                          onChange={(val) => toggleEarlyCall(r.userId, val)}
                        />
                        <Switch
                          label="L&U"
                          checked={!!r.luOn}
                          onChange={(val) => toggleLoadingUnloading(r.userId, val)}
                        />
                      </div>

                      <div className="atagTimes">
                        <span className="atagTimeChip">IN {fmtTime(r.in) || "--:--:--"}</span>
                        <span className="atagTimeChip">OUT {fmtTime(r.out) || "--:--:--"}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

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

            {/* scan frame */}
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

            {/* top bar */}
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
              <div
                style={{
                  background: "rgba(0,0,0,0.4)",
                  color: "white",
                  padding: "4px 10px",
                  borderRadius: 999,
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <input type="radio" checked={scanDir === "in"} onChange={() => setScanDir("in")} />{" "}
                  IN
                </label>
                <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <input
                    type="radio"
                    checked={scanDir === "out"}
                    onChange={() => setScanDir("out")}
                  />{" "}
                  OUT
                </label>
              </div>
            </div>

            {/* bottom bar */}
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

            {/* center popup */}
            {scanPopup && (
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  background:
                    scanPopup.kind === "success"
                      ? "rgba(34,197,94,0.9)"
                      : "rgba(248,113,113,0.9)",
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
    </div>
  );
}
