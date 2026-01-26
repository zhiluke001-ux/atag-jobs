// web/src/pages/MyJobs.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import { apiGet, apiPost, apiGetBlob } from "../api";

/* ---------- geo helpers ---------- */
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
    const S = dayjs(start),
      E = dayjs(end);
    const sameDay = S.isSame(E, "day");
    const d = S.format("YYYY/MM/DD");
    const t1 = S.format("hA");
    const t2 = E.format("hA");
    return sameDay ? `${d}  ${t1} — ${t2}` : `${S.format("YYYY/MM/DD hA")} — ${E.format("YYYY/MM/DD hA")}`;
  } catch {
    return "";
  }
}

/* ------- shared pay/session helpers ------- */
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const money = (v) => {
  const n = num(v);
  return Number.isFinite(n) && n > 0 ? `RM${n % 1 === 0 ? n : n.toFixed(2)}` : null;
};

function deriveViewerRank(user) {
  const raw = (
    user?.ptRole ||
    user?.jobRole ||
    user?.rank ||
    user?.tier ||
    user?.level ||
    user?.roleRank ||
    ""
  )
    .toString()
    .toLowerCase();
  if (["lead", "leader", "supervisor", "captain"].includes(raw)) return "lead";
  if (["senior", "sr"].includes(raw)) return "senior";
  return "junior";
}

function deriveKind(job) {
  const kind =
    job?.rate?.sessionKind ||
    job?.sessionKind ||
    job?.physicalSubtype ||
    job?.session?.physicalType ||
    (job?.session?.mode === "virtual" ? "virtual" : null);

  const mode = job?.session?.mode || job?.sessionMode || job?.mode || (kind === "virtual" ? "virtual" : "physical");
  const isVirtual = mode === "virtual" || kind === "virtual";

  const resolvedKind = isVirtual
    ? "virtual"
    : ["half_day", "full_day", "2d1n", "3d2n", "hourly_by_role", "hourly_flat"].includes(kind)
    ? kind
    : "half_day";

  const label =
    resolvedKind === "virtual"
      ? "Virtual"
      : resolvedKind === "half_day"
      ? "Physical — Half Day"
      : resolvedKind === "full_day"
      ? "Physical — Full Day"
      : resolvedKind === "2d1n"
      ? "Physical — 2D1N"
      : resolvedKind === "3d2n"
      ? "Physical — 3D2N"
      : resolvedKind === "hourly_by_role"
      ? "Physical — Hourly (by role)"
      : "Physical — Backend (flat hourly)";

  return { isVirtual, kind: resolvedKind, label };
}

function parkingRM(job) {
  const r = job?.rate || {};
  const v = Number.isFinite(r.parkingAllowance)
    ? r.parkingAllowance
    : Number.isFinite(r.transportAllowance)
    ? r.transportAllowance
    : Number.isFinite(r.transportBus)
    ? r.transportBus
    : null;
  return v == null ? null : Math.round(Number(v));
}

function otSuffix(hourlyRM, otRM) {
  if (otRM && otRM !== hourlyRM) return ` (OT ${otRM}/hr after end)`;
  if (hourlyRM) return ` (OT billed hourly after end)`;
  return "";
}

function buildPayForViewer(job, user) {
  const { kind } = deriveKind(job);
  const rank = deriveViewerRank(user);
  const tr = job?.rate?.tierRates || job?.roleRates || {};
  const tier = tr?.[rank] || {};
  const flat = job?.rate?.flatHourly || null;

  if (kind === "hourly_flat") {
    const base = money(flat?.base ?? tier.base);
    const ot = money(flat?.otRatePerHour);
    if (base || ot) return `${base ? `${base}/hr` : ""}${otSuffix(base, ot)}`;
    return "-";
  }

  if (kind === "virtual" || kind === "hourly_by_role") {
    const base = money(tier.base);
    const ot = money(tier.otRatePerHour);
    if (base || ot) return `${base ? `${base}/hr` : ""}${otSuffix(base, ot)}`;
    return "-";
  }

  const pick = (k) => {
    if (k === "half_day") return tier?.halfDay ?? tier?.specificPayment ?? null;
    if (k === "full_day") return tier?.fullDay ?? tier?.specificPayment ?? null;
    if (k === "2d1n") return tier?.twoD1N ?? tier?.specificPayment ?? null;
    if (k === "3d2n") return tier?.threeD2N ?? tier?.specificPayment ?? null;
    return null;
  };

  const sessionRM = money(pick(kind));
  const hasAddon = job?.session?.hourlyEnabled || job?.physicalHourlyEnabled || tier?.payMode === "specific_plus_hourly";
  const base = money(tier.base);
  const ot = money(tier.otRatePerHour);

  if (sessionRM) {
    if (hasAddon && (base || ot)) return `${sessionRM}  +  ${base ? `${base}/hr` : ""}${otSuffix(base, ot)}`;
    return sessionRM;
  }

  if (base || ot) return `${base ? `${base}/hr` : ""}${otSuffix(base, ot)}`;
  return "-";
}

/* ------- UI helpers ------- */
function TransportBadges({ job }) {
  const t = job?.transportOptions || {};
  const items = [
    ...(t.bus ? [{ text: "ATAG Bus", tone: "indigo" }] : []),
    ...(t.own ? [{ text: "Own Transport", tone: "cyan" }] : []),
  ];
  if (!items.length) return <span className="mj-muted">No transport option</span>;
  return (
    <div className="mj-chip-row">
      {items.map((it, i) => (
        <span key={i} className={`mj-chip mj-chip-${it.tone}`}>
          {it.text}
        </span>
      ))}
    </div>
  );
}

function Chip({ tone = "gray", children, title }) {
  return (
    <span className={`mj-chip mj-chip-${tone}`} title={title || ""}>
      {children}
    </span>
  );
}

function KeyVal({ k, v }) {
  return (
    <div className="mj-kv">
      <div className="mj-k">{k}</div>
      <div className="mj-v">{v || "-"}</div>
    </div>
  );
}

// ---- Discord constants ----
const DISCORD_URL = "https://discord.gg/ZAeR28z3p2";
const BTN_BLACK_STYLE = { background: "#000", color: "#fff", borderColor: "#000" };

// geo options
const GEO_OPTS = { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 };

// Parking receipt constraints
const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;

function isPartTimerUser(user) {
  const r = (user?.role || user?.userRole || "").toString().toLowerCase();
  return r === "part-timer" || r === "parttimer" || r === "pt";
}

function normalizeErr(e) {
  try {
    const j = JSON.parse(String(e));
    return j?.error || j?.message || String(e);
  } catch {
    return String(e);
  }
}

/* ---------- receipt URL helpers ---------- */
const API_BASE_CLEAN = (() => {
  try {
    const v = import.meta?.env?.VITE_API_BASE || import.meta?.env?.VITE_API_URL || "";
    return String(v || "").replace(/\/$/, "");
  } catch {
    return "";
  }
})();

function pickReceiptUrl(r) {
  if (!r) return "";
  const candidates = [
    r.photoUrlAbs,
    r.photo_url_abs,
    r.photoUrlSigned,
    r.signedUrl,
    r.signed_url,
    r.publicUrl,
    r.public_url,
    r.url,
    r.imageUrl,
    r.image_url,
    r.photoUrl,
    r.photo_url,
    r.fileUrl,
    r.file_url,
  ].filter(Boolean);

  const u = candidates.find((x) => typeof x === "string" && x.trim());
  return u ? u.trim() : "";
}

function toAbsUrl(u) {
  if (!u) return "";
  const s = String(u);
  if (/^data:/i.test(s) || /^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return window.location.protocol + s;
  if (API_BASE_CLEAN) return API_BASE_CLEAN + (s.startsWith("/") ? s : `/${s}`);
  return s;
}

/** Normalize API response -> receipt object with a usable url if response provides it outside receipt */
function normalizeReceiptResponse(resp) {
  if (!resp) return null;

  // list shape: { ok:true, receipts:[...] }
  const receipts = resp?.receipts ?? resp?.data?.receipts;
  if (Array.isArray(receipts)) {
    const r0 = receipts[0] || null;
    if (!r0) return null;

    const outer = resp?.photoUrlAbs || resp?.photoUrl || resp?.data?.photoUrlAbs || resp?.data?.photoUrl || "";
    if (!pickReceiptUrl(r0) && outer) r0.photoUrlAbs = outer;
    return r0;
  }

  // single shape
  const receipt = resp?.receipt ?? resp?.data?.receipt ?? resp?.data ?? resp;
  if (!receipt || typeof receipt !== "object") return null;

  const inner = pickReceiptUrl(receipt);
  const outer = resp?.photoUrlAbs || resp?.photoUrl || resp?.data?.photoUrlAbs || resp?.data?.photoUrl || "";
  if (!inner && outer) receipt.photoUrlAbs = outer;
  return receipt;
}

/* ---------- break enabled (robust) ---------- */
function isBreakEnabled(job) {
  const v =
    job?.breakEnabled ??
    job?.breakQR ??
    job?.breakQrEnabled ??
    job?.break_qr_enabled ??
    job?.session?.breakEnabled ??
    job?.rate?.breakEnabled ??
    job?.rate?.breakQrEnabled ??
    false;
  return !!v;
}

/* ========================== Page ========================== */
export default function MyJobs({ navigate, user }) {
  const [jobs, setJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(true);

  // live user location
  const [loc, setLoc] = useState(null); // { lat, lng, acc, ts }
  const [locMsg, setLocMsg] = useState("Getting your location…");

  // last-known scanner info per job
  const [scannerInfo, setScannerInfo] = useState({}); // { [jobId]: {lat,lng,updatedAt,dist} }

  // ✅ QR modal state (combined Work + Break)
  const [qrOpen, setQrOpen] = useState(false);
  const [qrToken, setQrToken] = useState("");
  const [qrDir, setQrDir] = useState("in"); // "in" | "out"
  const [qrMode, setQrMode] = useState("work"); // "work" | "break"
  const [qrJob, setQrJob] = useState(null);
  const [qrError, setQrError] = useState("");
  const [qrBusy, setQrBusy] = useState(false);
  const qrReqRef = useRef(0); // prevent stale token overwrites

  // Parking receipt states (per job)
  const [myReceipts, setMyReceipts] = useState({}); // { [jobId]: receiptObj }
  const [receiptDrafts, setReceiptDrafts] = useState({}); // { [jobId]: {fileName,dataUrl,amount,note,uploading,error,okMsg} }
  const [receiptImgBroken, setReceiptImgBroken] = useState({}); // { [jobId]: true }
  const receiptFileRef = useRef({}); // { [jobId]: HTMLInputElement }

  // ✅ Receipt Viewer Modal (like Payroll view)
  const [receiptViewOpen, setReceiptViewOpen] = useState(false);
  const [receiptViewLoading, setReceiptViewLoading] = useState(false);
  const [receiptViewErr, setReceiptViewErr] = useState("");
  const [receiptViewSrc, setReceiptViewSrc] = useState(""); // blob:/https/data
  const [receiptViewRawUrl, setReceiptViewRawUrl] = useState("");
  const [receiptViewMeta, setReceiptViewMeta] = useState({
    jobTitle: "",
    updatedAt: null,
    amount: null,
    note: "",
  });
  const receiptViewObjUrlRef = useRef("");
  const receiptViewReqRef = useRef(0);

  const isPT = isPartTimerUser(user);

  const setDraft = (jobId, patch) => {
    setReceiptDrafts((prev) => ({
      ...prev,
      [jobId]: { ...(prev[jobId] || {}), ...patch },
    }));
  };

  const clearFileInput = (jobId) => {
    const el = receiptFileRef.current?.[jobId];
    if (el) {
      try {
        el.value = "";
      } catch {}
    }
  };

  async function pickReceiptFile(jobId, file) {
    setDraft(jobId, { error: "", okMsg: "" });

    if (!file) {
      setDraft(jobId, { fileName: "", dataUrl: "" });
      clearFileInput(jobId);
      return;
    }

    if (!file.type?.startsWith("image/")) {
      setDraft(jobId, { error: "Please select an image file (JPG/PNG/WebP).", fileName: file.name });
      clearFileInput(jobId);
      return;
    }

    if (file.size > MAX_RECEIPT_BYTES) {
      setDraft(jobId, {
        error: "Image too large (max 2MB). Please compress / take a smaller screenshot.",
        fileName: file.name,
        dataUrl: "",
      });
      clearFileInput(jobId);
      return;
    }

    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.onerror = () => reject(new Error("Failed to read file."));
      fr.readAsDataURL(file);
    }).catch(() => "");

    if (!dataUrl?.startsWith("data:image/")) {
      setDraft(jobId, { error: "Failed to read image. Try another file.", fileName: file.name, dataUrl: "" });
      clearFileInput(jobId);
      return;
    }

    setDraft(jobId, { fileName: file.name, dataUrl });
  }

  async function refreshMyReceipt(jobId) {
    try {
      const r = await apiGet(`/jobs/${jobId}/parking-receipt/me`);
      const receipt = normalizeReceiptResponse(r);
      if (receipt) {
        setMyReceipts((prev) => ({ ...prev, [jobId]: receipt }));
        setReceiptImgBroken((prev) => ({ ...prev, [jobId]: false }));
      }
      return receipt || null;
    } catch {
      return null;
    }
  }

  async function uploadReceipt(job) {
    const jobId = job.id;
    const d = receiptDrafts[jobId] || {};

    setDraft(jobId, { error: "", okMsg: "" });

    if (!d.dataUrl) {
      setDraft(jobId, { error: "Please choose an image first." });
      return;
    }

    setDraft(jobId, { uploading: true });

    try {
      const payload = { dataUrl: d.dataUrl };
      const amt = d.amount === "" || d.amount == null ? null : Number(d.amount);
      if (Number.isFinite(amt) && amt > 0) payload.amount = amt;
      if (d.note && String(d.note).trim()) payload.note = String(d.note).trim();

      const res = await apiPost(`/jobs/${jobId}/parking-receipt`, payload);

      const maybe = normalizeReceiptResponse(res);
      if (maybe) setMyReceipts((prev) => ({ ...prev, [jobId]: maybe }));

      const fresh = await refreshMyReceipt(jobId);

      // If backend still returns no url, keep local preview so user sees something
      if (!fresh || !pickReceiptUrl(fresh)) {
        setMyReceipts((prev) => ({
          ...prev,
          [jobId]: {
            ...(fresh || maybe || {}),
            _localPreview: true,
            photoUrlAbs: d.dataUrl,
            uploadedAt: Date.now(),
          },
        }));
      }

      setDraft(jobId, {
        uploading: false,
        okMsg: "Uploaded ✅",
        error: "",
        dataUrl: "",
        fileName: "",
      });
      clearFileInput(jobId);
      setReceiptImgBroken((prev) => ({ ...prev, [jobId]: false }));
    } catch (e) {
      const msg = normalizeErr(e);
      let nice = "Failed to upload receipt.";
      if (msg.includes("not_approved")) nice = "You are not approved for this job yet. Please contact PM.";
      else if (msg.includes("image_too_large")) nice = "Image too large. Please upload < 2MB.";
      else if (msg.includes("bad_data_url")) nice = "Invalid image format. Please re-select the image.";
      else if (msg) nice = msg;
      setDraft(jobId, { uploading: false, error: nice });
    }
  }

  async function removeMyReceipt(jobId) {
    if (!window.confirm("Remove your uploaded parking receipt?")) return;

    setDraft(jobId, { uploading: true, error: "", okMsg: "" });
    try {
      await apiPost(`/jobs/${jobId}/parking-receipt/me/remove`, {});
      setMyReceipts((prev) => {
        const n = { ...prev };
        delete n[jobId];
        return n;
      });
      setReceiptImgBroken((prev) => ({ ...prev, [jobId]: false }));
      setDraft(jobId, { uploading: false, okMsg: "Removed ✅", error: "" });
      clearFileInput(jobId);
    } catch (e) {
      setDraft(jobId, { uploading: false, error: normalizeErr(e) });
    }
  }

  /* ---------- Receipt Viewer (modal) helpers ---------- */
  const cleanupReceiptViewerBlob = () => {
    const u = receiptViewObjUrlRef.current;
    if (u) {
      try {
        URL.revokeObjectURL(u);
      } catch {}
      receiptViewObjUrlRef.current = "";
    }
  };

  useEffect(() => {
    return () => cleanupReceiptViewerBlob();
  }, []);

  const closeReceiptViewer = () => {
    setReceiptViewOpen(false);
    setReceiptViewLoading(false);
    setReceiptViewErr("");
    setReceiptViewSrc("");
    setReceiptViewRawUrl("");
    setReceiptViewMeta({ jobTitle: "", updatedAt: null, amount: null, note: "" });
    cleanupReceiptViewerBlob();
  };

  async function resolveReceiptViewSrc(absUrl) {
    if (!absUrl) return "";

    if (/^data:/i.test(absUrl)) return absUrl;

    // Try to fetch as blob for protected / cookie-auth endpoints
    try {
      const u = new URL(absUrl, window.location.origin);
      const sameOrigin = u.origin === window.location.origin;

      let apiOrigin = null;
      try {
        if (API_BASE_CLEAN) apiOrigin = new URL(API_BASE_CLEAN, window.location.origin).origin;
      } catch {}
      const isApiOrigin = apiOrigin && u.origin === apiOrigin;

      if (sameOrigin || isApiOrigin) {
        let path = u.pathname + u.search;
        if (API_BASE_CLEAN && absUrl.startsWith(API_BASE_CLEAN)) {
          path = absUrl.slice(API_BASE_CLEAN.length) || "/";
        }

        const maybeBlob = await apiGetBlob(path);
        const blob =
          maybeBlob instanceof Blob ? maybeBlob : maybeBlob?.data instanceof Blob ? maybeBlob.data : null;

        if (blob) {
          const objUrl = URL.createObjectURL(blob);
          receiptViewObjUrlRef.current = objUrl;
          return objUrl;
        }
      }
    } catch {}

    return absUrl;
  }

  async function openReceiptViewer(job, receipt) {
    const reqId = ++receiptViewReqRef.current;
    cleanupReceiptViewerBlob();

    const raw = pickReceiptUrl(receipt) || "";
    const abs = toAbsUrl(raw);

    setReceiptViewOpen(true);
    setReceiptViewLoading(true);
    setReceiptViewErr("");
    setReceiptViewSrc("");
    setReceiptViewRawUrl(abs);

    const updatedAt = receipt?.updatedAt || receipt?.createdAt || receipt?.uploadedAt || receipt?.uploadAt || null;

    setReceiptViewMeta({
      jobTitle: job?.title || "Job",
      updatedAt,
      amount: receipt?.amount ?? receipt?.parkingAmount ?? null,
      note: receipt?.note ?? receipt?.remarks ?? "",
    });

    if (!abs) {
      setReceiptViewLoading(false);
      setReceiptViewErr("Receipt image URL not available yet. Tap Refresh on the card.");
      return;
    }

    try {
      const src = await resolveReceiptViewSrc(abs);
      if (reqId !== receiptViewReqRef.current) return;
      setReceiptViewSrc(src || abs);
      setReceiptViewLoading(false);
    } catch {
      if (reqId !== receiptViewReqRef.current) return;
      setReceiptViewSrc(abs);
      setReceiptViewLoading(false);
    }
  }

  /* ---------- load "my jobs" ---------- */
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoadingJobs(true);
      try {
        const mine = await apiGet("/me/jobs");
        const onlyApproved = (mine || []).filter((j) => j.myStatus === "approved");
        const full = await Promise.all(
          onlyApproved.map(async (j) => {
            try {
              const fj = await apiGet(`/jobs/${j.id}`);
              return { ...j, ...fj };
            } catch {
              return j;
            }
          })
        );
        if (mounted) setJobs(full || []);
      } catch {
        if (mounted) setJobs([]);
      } finally {
        if (mounted) setLoadingJobs(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  /* ---------- load my parking receipt per job (part timers) ---------- */
  useEffect(() => {
    let active = true;
    if (!isPT || !jobs?.length) return;

    (async () => {
      const map = {};
      await Promise.all(
        jobs.map(async (j) => {
          try {
            const r = await apiGet(`/jobs/${j.id}/parking-receipt/me`);
            const receipt = normalizeReceiptResponse(r);
            if (receipt) map[j.id] = receipt;
          } catch {}
        })
      );
      if (active && Object.keys(map).length) setMyReceipts((prev) => ({ ...prev, ...map }));
    })();

    return () => {
      active = false;
    };
  }, [isPT, jobs]);

  /* ---------- geo ---------- */
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setLocMsg("Location not supported by browser.");
      return;
    }

    let active = true;

    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (!active) return;
        setLoc({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          acc: p.coords.accuracy ?? null,
          ts: Date.now(),
        });
        setLocMsg("");
      },
      () => {
        if (!active) return;
        setLocMsg("Getting your location… allow location and try again.");
      },
      GEO_OPTS
    );

    const id = navigator.geolocation.watchPosition(
      (p) => {
        if (!active) return;
        setLoc({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          acc: p.coords.accuracy ?? null,
          ts: Date.now(),
        });
        setLocMsg("");
      },
      () => {
        if (!active) return;
        setLocMsg("Getting your location…");
      },
      GEO_OPTS
    );

    return () => {
      active = false;
      try {
        navigator.geolocation.clearWatch(id);
      } catch {}
    };
  }, []);

  /* ---------- fetch scanner location for ongoing jobs ---------- */
  useEffect(() => {
    let timer;

    const fetchAll = async () => {
      if (!jobs?.length) return;
      const map = {};
      for (const j of jobs) {
        if (j.status !== "ongoing") continue;
        try {
          const s = await apiGet(`/jobs/${j.id}/scanner`);
          map[j.id] = {
            ...s,
            dist: s && loc ? haversineMeters(loc, { lat: s.lat, lng: s.lng }) : null,
          };
        } catch {}
      }
      if (Object.keys(map).length) setScannerInfo((prev) => ({ ...prev, ...map }));
    };

    fetchAll();
    timer = setInterval(fetchAll, 15000);
    return () => clearInterval(timer);
  }, [jobs, loc]);

  /* ---------- QR generation (combined Work + Break) ---------- */
  function mapDirection(mode, dir) {
    if (mode === "work") return dir; // "in" | "out"
    return dir === "in" ? "break_in" : "break_out";
  }

  async function generateQR(job, mode, dir) {
    const reqId = ++qrReqRef.current;

    setQrError("");
    setQrToken("");
    setQrBusy(true);

    const { isVirtual } = deriveKind(job);
    if (isVirtual) {
      setQrError("Virtual job — no scan required. PM/Admin will mark attendance.");
      setQrBusy(false);
      return;
    }

    const breakEnabled = isBreakEnabled(job);
    if (mode === "break" && !breakEnabled) {
      setQrError("Break QR is not enabled for this job (PM disabled it).");
      setQrBusy(false);
      return;
    }

    let here = loc;
    if (!here && "geolocation" in navigator) {
      try {
        const p = await new Promise((res, rej) =>
          navigator.geolocation.getCurrentPosition(
            (pos) =>
              res({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                acc: pos.coords.accuracy ?? null,
                ts: Date.now(),
              }),
            rej,
            GEO_OPTS
          )
        );
        here = p;
        setLoc(p);
      } catch {
        setQrError("Location permission is required to generate QR.");
        setQrBusy(false);
        return;
      }
    }

    try {
      const direction = mapDirection(mode, dir);
      const r = await apiPost(`/jobs/${job.id}/qr`, {
        direction,
        lat: here.lat,
        lng: here.lng,
      });
      if (reqId !== qrReqRef.current) return; // ignore stale
      setQrToken(r.token);
    } catch (e) {
      if (reqId !== qrReqRef.current) return;
      let msg = "Failed to generate QR.";
      try {
        const j = JSON.parse(String(e));
        if (j.error === "not_approved") msg = "You are not approved for this job yet. Please contact the PM.";
        else if (j.error === "not_ongoing") msg = "Scanning only opens when the job is ongoing.";
        else if (j.error === "too_far") msg = "You are too far from the event scanner location.";
        else msg = j.error || msg;
      } catch {}
      setQrError(msg);
    } finally {
      if (reqId === qrReqRef.current) setQrBusy(false);
    }
  }

  async function openQRModal(job) {
    setQrJob(job);
    setQrOpen(true);

    // default: Work IN
    setQrMode("work");
    setQrDir("in");
    await generateQR(job, "work", "in");
  }

  function closeQR() {
    setQrOpen(false);
    setQrToken("");
    setQrError("");
    setQrJob(null);
    setQrMode("work");
    setQrDir("in");
    setQrBusy(false);
    qrReqRef.current++;
  }

  const qrImgSrc = useMemo(() => {
    if (!qrToken) return "";
    return `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(qrToken)}`;
  }, [qrToken]);

  return (
    <div className="myjobs-page">
      {/* Page-local CSS (keeps UI consistent without touching global files) */}
      <style>{`
        .myjobs-page{max-width:1040px;margin:0 auto;padding:16px 12px 28px;}
        .myjobs-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px;}
        .myjobs-title{font-size:22px;font-weight:900;letter-spacing:-.02em;}
        .myjobs-sub{margin-top:4px;font-size:13px;color:#6b7280}
        .myjobs-list{display:grid;gap:12px;}
        .myjob-card{border:1px solid var(--border,#e5e7eb);background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(16,24,40,.06)}
        .myjob-head{padding:14px 14px 10px;border-bottom:1px solid var(--border,#e5e7eb);background:linear-gradient(180deg,#fbfbfc, #ffffff)}
        .myjob-head-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
        .myjob-title{font-size:16px;font-weight:900;letter-spacing:-.01em}
        .myjob-meta{margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
        .mj-muted{font-size:12px;color:#6b7280}
        .mj-chip-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
        .mj-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:800;border:1px solid rgba(0,0,0,.06);background:#f3f4f6;color:#374151;white-space:nowrap}
        .mj-chip-gray{background:#f3f4f6;color:#374151}
        .mj-chip-green{background:#ecfdf5;color:#047857;border-color:#a7f3d0}
        .mj-chip-red{background:#fef2f2;color:#b91c1c;border-color:#fecaca}
        .mj-chip-indigo{background:#eef2ff;color:#3730a3;border-color:#c7d2fe}
        .mj-chip-cyan{background:#ecfeff;color:#155e75;border-color:#a5f3fc}
        .mj-chip-amber{background:#fffbeb;color:#92400e;border-color:#fde68a}
        .mj-chip-black{background:#111827;color:#fff;border-color:#111827}
        .myjob-body{padding:14px;display:grid;grid-template-columns:1fr 360px;gap:14px}
        .mj-panel{border:1px solid var(--border,#e5e7eb);background:#fafafa;border-radius:14px;padding:12px}
        .mj-panel-white{background:#fff}
        .mj-panel-title{font-weight:900;font-size:13px;margin-bottom:8px;color:#111827}
        .mj-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .mj-kv{display:grid;gap:4px}
        .mj-k{font-size:12px;color:#6b7280;font-weight:700}
        .mj-v{font-size:13px;color:#111827;font-weight:800}
        .mj-desc{white-space:pre-wrap;color:#374151;font-size:13px;line-height:1.5}
        .mj-actions{display:flex;gap:8px;flex-wrap:wrap}
        .mj-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace}
        .mj-divider{height:1px;background:var(--border,#e5e7eb);margin:10px 0}
        .mj-thumb{width:100%;max-height:180px;object-fit:cover;border-radius:12px;border:1px solid var(--border,#e5e7eb);background:#fff}
        .mj-thumb-contain{object-fit:contain}
        .mj-file-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
        .mj-filebtn{display:inline-flex;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;border:1px dashed rgba(0,0,0,.2);background:#fff;font-weight:900;font-size:13px;cursor:pointer}
        .mj-filebtn:hover{background:#f9fafb}
        .mj-note{font-size:12px;color:#6b7280;line-height:1.4}
        .mj-alert{padding:10px;border-radius:12px;border:1px solid var(--border,#e5e7eb);background:#fff;font-size:13px}
        .mj-alert-danger{border-color:var(--red,#ef4444);color:var(--red,#ef4444);background:#fff}
        .mj-alert-ok{border-color:#22c55e;color:#166534;background:#f0fdf4}
        @media (max-width: 920px){
          .myjob-body{grid-template-columns:1fr}
        }
      `}</style>

      <div className="myjobs-top">
        <div>
          <div className="myjobs-title">My Jobs</div>
          <div className="myjobs-sub">
            Your approved jobs list. Use <b>Check In/Out</b> when job is ongoing. Upload parking receipt if required.
          </div>
        </div>

        <div className="mj-chip-row">
          {loc ? (
            <Chip tone="green" title="Your live GPS is ready">
              GPS ready · ±{loc.acc ? Math.round(loc.acc) : "—"}m
            </Chip>
          ) : (
            <Chip tone="red" title={locMsg}>
              GPS pending
            </Chip>
          )}
        </div>
      </div>

      <div className="myjobs-list">
        {loadingJobs ? (
          <div className="myjob-card">
            <div className="myjob-head">
              <div className="myjob-title">Loading…</div>
              <div className="mj-muted" style={{ marginTop: 6 }}>
                Fetching your approved jobs.
              </div>
            </div>
          </div>
        ) : jobs.length === 0 ? (
          <div className="myjob-card">
            <div className="myjob-head">
              <div className="myjob-title">No approved jobs yet</div>
              <div className="mj-muted" style={{ marginTop: 6 }}>
                Once a PM approves you, the job will appear here.
              </div>
            </div>
          </div>
        ) : (
          jobs.map((j) => {
            const s = scannerInfo[j.id];
            const dist = s?.dist;
            const { isVirtual, label } = deriveKind(j);

            const yourLocLine = loc
              ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}${loc.acc ? ` (±${Math.round(loc.acc)} m)` : ""} · ${dayjs(loc.ts).format("HH:mm:ss")}`
              : locMsg || "Getting your location…";

            const pa = parkingRM(j);
            const lu = j.loadingUnload || {};
            const ec = j.earlyCall || {};
            const payForViewer = buildPayForViewer(j, user);

            const breakEnabled = isBreakEnabled(j);

            const receipt = myReceipts[j.id];
            const draft = receiptDrafts[j.id] || {};
            const receiptImg = toAbsUrl(pickReceiptUrl(receipt));
            const receiptUpdatedAt = receipt?.updatedAt || receipt?.createdAt || receipt?.uploadedAt || null;
            const broken = !!receiptImgBroken[j.id];

            const statusTone = j.status === "ongoing" ? "green" : j.status === "upcoming" ? "amber" : "gray";

            return (
              <div key={j.id} className="myjob-card">
                <div className="myjob-head">
                  <div className="myjob-head-row">
                    <div>
                      <div className="myjob-title">{j.title}</div>
                      <div className="myjob-meta">
                        <Chip tone="indigo">{String(j.myStatus || "unknown")}</Chip>
                        <Chip tone={statusTone}>{String(j.status || "unknown")}</Chip>
                        <Chip tone="gray">{fmtRange(j.startTime, j.endTime)}</Chip>
                        {isVirtual ? <Chip tone="indigo">Virtual</Chip> : null}
                        {!isVirtual && j.status === "ongoing" ? (
                          <Chip
                            tone={dist != null && dist <= 250 ? "green" : dist != null && dist > 250 ? "amber" : "gray"}
                            title={s?.updatedAt ? `updated ${dayjs(s.updatedAt).format("HH:mm:ss")}` : ""}
                          >
                            Scanner: {dist == null ? "—" : `${dist} m`}
                          </Chip>
                        ) : null}
                      </div>
                    </div>

                    <div className="mj-actions">
                      <button className="btn" onClick={() => navigate(`#/jobs/${j.id}`)}>
                        View details
                      </button>

                      {j.myStatus === "approved" && (
                        <a href={DISCORD_URL} target="_blank" rel="noreferrer" className="btn" style={BTN_BLACK_STYLE}>
                          Join Discord
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                <div className="myjob-body">
                  {/* LEFT: Job info */}
                  <div style={{ display: "grid", gap: 12 }}>
                    <div className="mj-panel mj-panel-white">
                      <div className="mj-panel-title">Quick info</div>
                      <div className="mj-grid">
                        <KeyVal k="Session" v={label} />
                        <KeyVal k="Venue" v={j.venue || "-"} />
                        <KeyVal
                          k="Pay"
                          v={
                            <span className="mj-mono" style={{ fontWeight: 900 }}>
                              {payForViewer}
                            </span>
                          }
                        />
                        <KeyVal
                          k="Break QR"
                          v={
                            <span style={{ fontWeight: 900, color: breakEnabled ? "#047857" : "#6b7280" }}>
                              {breakEnabled ? "Enabled" : "Disabled"}
                            </span>
                          }
                        />
                      </div>

                      <div className="mj-divider" />

                      <div className="mj-panel-title" style={{ marginBottom: 6 }}>
                        Transport
                      </div>
                      <TransportBadges job={j} />
                      {pa != null ? (
                        <div className="mj-note" style={{ marginTop: 6 }}>
                          Transport allowance: RM{pa} per person (if selected)
                        </div>
                      ) : null}
                    </div>

                    <div className="mj-panel mj-panel-white">
                      <div className="mj-panel-title">Allowances</div>
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontSize: 13, color: "#374151" }}>
                          <b>Early Call:</b>{" "}
                          {ec?.enabled
                            ? `Yes (RM${Number(ec.amount || 0)}, ≥ ${Number(ec.thresholdHours || 0)}h)`
                            : "No"}
                        </div>
                        <div style={{ fontSize: 13, color: "#374151" }}>
                          <b>Loading & Unloading:</b>{" "}
                          {lu?.enabled ? `Yes (RM${Number(lu.price || 0)} / helper, quota ${Number(lu.quota || 0)})` : "No"}
                        </div>
                      </div>

                      <div className="mj-divider" />

                      <div className="mj-panel-title" style={{ marginBottom: 6 }}>
                        Description
                      </div>
                      <div className="mj-desc">{j.description || "-"}</div>
                    </div>
                  </div>

                  {/* RIGHT: Attendance + Receipt */}
                  <div style={{ display: "grid", gap: 12 }}>
                    <div className="mj-panel">
                      <div className="mj-panel-title">Attendance</div>

                      <div className="mj-chip-row" style={{ marginBottom: 8 }}>
                        {loc ? (
                          <Chip tone="green">GPS OK</Chip>
                        ) : (
                          <Chip tone="red" title="Please allow location permission">
                            GPS required
                          </Chip>
                        )}

                        {isVirtual ? <Chip tone="indigo">PM will mark</Chip> : <Chip tone="gray">Scan at venue</Chip>}

                        {!isVirtual && j.status !== "ongoing" ? <Chip tone="amber">Opens when ongoing</Chip> : null}
                      </div>

                      <div className="mj-note" style={{ marginBottom: 10 }}>
                        <b>Your location:</b> <span style={{ color: loc ? "#374151" : "#b91c1c" }}>{yourLocLine}</span>
                      </div>

                      {!isVirtual ? (
                        <button className="btn primary" onClick={() => openQRModal(j)} style={{ width: "100%" }}>
                          Check In/Out
                        </button>
                      ) : (
                        <div className="mj-alert">
                          This is a <b>virtual job</b>. No QR scan is required — PM/Admin will mark your attendance.
                        </div>
                      )}

                      {!isVirtual && j.status === "ongoing" ? (
                        <div className="mj-note" style={{ marginTop: 10 }}>
                          Tip: if “too far”, move closer to the event scanner area and tap <b>Regenerate</b>.
                        </div>
                      ) : null}
                    </div>

                    {/* ================= Parking Receipt (Part-timer) ================= */}
                    {isPT && (
                      <div className="mj-panel">
                        <div className="mj-panel-title">Parking Receipt</div>

                        {/* Existing receipt */}
                        {receipt ? (
                          <div className="mj-panel mj-panel-white" style={{ padding: 10 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                              <div className="mj-note">
                                <b>Status:</b> Uploaded
                                {receiptUpdatedAt ? (
                                  <span style={{ color: "#6b7280" }}> · {dayjs(receiptUpdatedAt).format("YYYY/MM/DD HH:mm")}</span>
                                ) : null}
                              </div>

                              <div className="mj-actions">
                                <button className="btn" onClick={() => refreshMyReceipt(j.id)} disabled={!!draft.uploading}>
                                  Refresh
                                </button>
                                <button
                                  className="btn"
                                  onClick={() => openReceiptViewer(j, receipt)}
                                  disabled={!!draft.uploading}
                                >
                                  View
                                </button>
                                <button className="btn" onClick={() => removeMyReceipt(j.id)} disabled={!!draft.uploading}>
                                  Remove
                                </button>
                              </div>
                            </div>

                            {broken ? (
                              <div className="mj-alert mj-alert-danger" style={{ marginTop: 10 }}>
                                Receipt record exists, but the image file cannot be loaded (missing on server). You can click{" "}
                                <b>Remove</b> to clean it up.
                              </div>
                            ) : null}

                            {receiptImg ? (
                              <img
                                src={receiptImg}
                                alt="Parking receipt"
                                loading="lazy"
                                decoding="async"
                                onError={() => setReceiptImgBroken((p) => ({ ...p, [j.id]: true }))}
                                className="mj-thumb mj-thumb-contain"
                                style={{ marginTop: 10 }}
                              />
                            ) : (
                              <div className="mj-note" style={{ marginTop: 8 }}>
                                Receipt uploaded, but image URL not available yet. Tap <b>Refresh</b>.
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="mj-note">No receipt uploaded yet.</div>
                        )}

                        {/* Upload / Replace */}
                        <div className="mj-panel mj-panel-white" style={{ marginTop: 10 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                            <div className="mj-note">
                              <b>Upload / Replace</b> <span style={{ color: "#6b7280" }}>(max 2MB)</span>
                            </div>

                            <div className="mj-actions">
                              <button
                                className="btn"
                                onClick={() => {
                                  setDraft(j.id, { fileName: "", dataUrl: "", error: "", okMsg: "" });
                                  clearFileInput(j.id);
                                }}
                                disabled={!!draft.uploading}
                              >
                                Clear
                              </button>
                              <button
                                className="btn primary"
                                onClick={() => uploadReceipt(j)}
                                disabled={!!draft.uploading || !draft.dataUrl}
                              >
                                {draft.uploading ? "Uploading…" : "Upload"}
                              </button>
                            </div>
                          </div>

                          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                            {/* Hidden input, nicer chooser */}
                            <input
                              ref={(el) => {
                                if (el) receiptFileRef.current[j.id] = el;
                              }}
                              type="file"
                              accept="image/*"
                              style={{ display: "none" }}
                              onChange={(e) => pickReceiptFile(j.id, e.target.files?.[0] || null)}
                            />

                            <div className="mj-file-row">
                              <button
                                type="button"
                                className="mj-filebtn"
                                onClick={() => receiptFileRef.current?.[j.id]?.click?.()}
                                disabled={!!draft.uploading}
                                title="Choose an image (JPG/PNG/WebP)"
                              >
                                📎 Choose image
                              </button>

                              {draft.fileName ? <Chip tone="gray">Selected: {draft.fileName}</Chip> : <Chip tone="gray">No file</Chip>}
                            </div>

                            {draft.dataUrl ? (
                              <img
                                src={draft.dataUrl}
                                alt="Receipt preview"
                                loading="lazy"
                                decoding="async"
                                className="mj-thumb mj-thumb-contain"
                              />
                            ) : null}

                            {draft.error ? <div className="mj-alert mj-alert-danger">{draft.error}</div> : null}
                            {draft.okMsg ? <div className="mj-alert mj-alert-ok">{draft.okMsg}</div> : null}

                            <div className="mj-note">
                              Tip: screenshot/crop the receipt first so it stays under 2MB.
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ---------- RECEIPT VIEWER MODAL ---------- */}
      {receiptViewOpen && (
        <div
          className="modal-overlay"
          onClick={closeReceiptViewer}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 70,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            background: "rgba(0,0,0,.55)",
          }}
        >
          <div
            className="modal-card modal-sm"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(860px, 96vw)",
              background: "#fff",
              borderRadius: 14,
              padding: 16,
              boxShadow: "0 10px 30px rgba(0,0,0,.25)",
              border: "1px solid rgba(255,255,255,.2)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 950, fontSize: 16 }}>
                  Parking Receipt — {receiptViewMeta.jobTitle}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                  {receiptViewMeta.updatedAt
                    ? `Uploaded: ${dayjs(receiptViewMeta.updatedAt).format("YYYY/MM/DD HH:mm")}`
                    : "Uploaded: —"}
                  {receiptViewMeta.amount != null ? ` · Amount: RM${Number(receiptViewMeta.amount)}` : ""}
                  {receiptViewMeta.note ? ` · Note: ${receiptViewMeta.note}` : ""}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "start", flexWrap: "wrap" }}>
                <button className="btn" onClick={closeReceiptViewer}>
                  Close
                </button>

                <button
                  className="btn"
                  onClick={() => {
                    if (receiptViewRawUrl) window.open(receiptViewRawUrl, "_blank");
                  }}
                  disabled={!receiptViewRawUrl}
                >
                  Open
                </button>
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              {receiptViewErr ? (
                <div style={{ padding: 10, border: "1px solid var(--red)", borderRadius: 12, color: "var(--red)" }}>
                  {receiptViewErr}
                </div>
              ) : receiptViewLoading ? (
                <div style={{ color: "#6b7280" }}>Loading receipt…</div>
              ) : receiptViewSrc ? (
                <img
                  src={receiptViewSrc}
                  alt="Parking receipt"
                  onError={() => setReceiptViewErr("Failed to load image. Try Refresh on the card, or Open in new tab.")}
                  style={{
                    width: "100%",
                    maxHeight: "72vh",
                    objectFit: "contain",
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "#fff",
                  }}
                />
              ) : (
                <div style={{ color: "#6b7280" }}>No image.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------- QR MODAL ---------- */}
      {qrOpen && (
        <div
          className="modal-overlay"
          onClick={closeQR}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            background: "rgba(0,0,0,.55)",
          }}
        >
          <div
            className="modal-card modal-sm"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(560px, 92vw)",
              background: "#fff",
              borderRadius: 14,
              padding: 16,
              boxShadow: "0 10px 30px rgba(0,0,0,.25)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 950, fontSize: 16 }}>
                {qrJob ? `${qrJob.title}` : "QR"}
              </div>
              <button className="btn" onClick={closeQR}>
                Close
              </button>
            </div>

            <div className="mj-note" style={{ marginTop: 6 }}>
              Choose <b>Work</b> or <b>Break</b> (only appears if enabled), then show the QR to PM scanner.
            </div>

            {/* Mode Switch */}
            {qrJob && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <button
                  className="btn"
                  style={qrMode === "work" ? { background: "#111827", color: "#fff", borderColor: "#111827" } : undefined}
                  onClick={async () => {
                    setQrMode("work");
                    setQrDir("in");
                    await generateQR(qrJob, "work", "in");
                  }}
                  disabled={qrBusy}
                >
                  Work
                </button>

                {isBreakEnabled(qrJob) && (
                  <button
                    className="btn"
                    style={qrMode === "break" ? { background: "#111827", color: "#fff", borderColor: "#111827" } : undefined}
                    onClick={async () => {
                      setQrMode("break");
                      setQrDir("in");
                      await generateQR(qrJob, "break", "in");
                    }}
                    disabled={qrBusy}
                  >
                    Break
                  </button>
                )}
              </div>
            )}

            {/* Dir Switch */}
            {qrJob && !qrError && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <button
                  className="btn"
                  style={qrDir === "in" ? { background: "#22c55e", color: "#fff", borderColor: "#22c55e" } : undefined}
                  onClick={async () => {
                    setQrDir("in");
                    await generateQR(qrJob, qrMode, "in");
                  }}
                  disabled={qrBusy}
                >
                  {qrMode === "work" ? "Check In" : "Break In"}
                </button>
                <button
                  className="btn"
                  style={qrDir === "out" ? { background: "#ef4444", color: "#fff", borderColor: "#ef4444" } : undefined}
                  onClick={async () => {
                    setQrDir("out");
                    await generateQR(qrJob, qrMode, "out");
                  }}
                  disabled={qrBusy}
                >
                  {qrMode === "work" ? "Check Out" : "Break Out"}
                </button>
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              {qrError ? (
                <div style={{ padding: 10, border: "1px solid var(--red)", borderRadius: 12, color: "var(--red)" }}>
                  {qrError}
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", justifyContent: "center", margin: "10px 0 10px" }}>
                    {qrBusy ? (
                      <div style={{ color: "#6b7280" }}>Generating QR…</div>
                    ) : qrToken ? (
                      <img
                        src={qrImgSrc}
                        alt="QR code"
                        style={{ width: 260, height: 260, borderRadius: 12, border: "1px solid var(--border)" }}
                      />
                    ) : (
                      <div style={{ color: "#6b7280" }}>No token.</div>
                    )}
                  </div>

                  <div className="mj-note">
                    Token validity: about <b>60 seconds</b>. If it expires, tap <b>Regenerate</b>.
                  </div>

                  <div style={{ marginTop: 10 }}>
                    <label style={{ fontWeight: 900, fontSize: 13 }}>Token (fallback)</label>
                    <input readOnly value={qrToken} className="mj-mono" />
                  </div>
                </>
              )}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
              <button className="btn" onClick={closeQR}>
                Close
              </button>

              {!qrError && qrJob && (
                <button className="btn primary" onClick={() => generateQR(qrJob, qrMode, qrDir)} disabled={qrBusy}>
                  {qrBusy ? "…" : "Regenerate"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
