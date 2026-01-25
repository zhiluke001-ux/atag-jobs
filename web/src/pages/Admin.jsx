// web/src/pages/Admin.jsx
import React, { useEffect, useMemo, useState, useRef } from "react";
import { apiGet, apiGetBlob, apiPatch } from "../api";

/* ---------------- helpers ---------------- */
function money(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "RM0";
  return "RM" + Math.round(x);
}
const N = (v, d = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
};

const fmtDateOnly = (value) => {
  if (!value) return "";
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (!d || Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return "";
  }
};

const fmtTimeOnly = (value) => {
  if (!value) return "";
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (!d || Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

const fmtRange = (start, end) => {
  try {
    const s = new Date(start),
      e = new Date(end);
    const same = s.toDateString() === e.toDateString();
    const dt = (d) =>
      d.toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    const t = (d) =>
      d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });

    // ✅ use ASCII dash to avoid Excel mojibake (â€”)
    return same ? `${dt(s)} - ${t(e)}` : `${dt(s)} - ${dt(e)}`;
  } catch {
    return "";
  }
};

const fmtDateTime = (value) => {
  if (!value) return "";
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (!d || Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
};

const fmtPayrollDateRange = (start, end) => {
  try {
    const s = new Date(start);
    const e = new Date(end);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "";
    const sd = fmtDateOnly(s);
    const ed = fmtDateOnly(e);
    return sd === ed ? sd : `${sd} - ${ed}`;
  } catch {
    return "";
  }
};

const fmtPayrollTimeRange = (start, end) => {
  try {
    const s = new Date(start);
    const e = new Date(end);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "";
    const st = fmtTimeOnly(s);
    const et = fmtTimeOnly(e);
    const sameDay = s.toDateString() === e.toDateString();
    return sameDay ? `${st} - ${et}` : `${st} - ${et} (multi-day)`;
  } catch {
    return "";
  }
};

// ✅ Canonicalize receipt URL so absolute + relative become the same string
const isHttpLike = (u) => /^https?:\/\//i.test(String(u || ""));
const isDataLike = (u) => /^data:/i.test(String(u || ""));

function normalizeReceiptUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (isDataLike(s)) return s;

  // absolute url -> keep only pathname
  if (isHttpLike(s)) {
    try {
      const u = new URL(s);
      return (u.pathname || "").split("?")[0].split("#")[0] || "";
    } catch {
      // fallthrough
    }
  }

  let p = s;

  // handle weird cases where origin is embedded without protocol
  const idx = p.indexOf("/uploads/");
  if (idx > 0) p = p.slice(idx);

  if (!p.startsWith("/")) p = "/" + p;

  // strip query/hash
  p = p.split("?")[0].split("#")[0];

  // collapse double slashes
  p = p.replace(/\/{2,}/g, "/");

  return p;
}

/* =========================
   ✅ parking receipt resolver (MULTIPLE) + supports receiptIndex (ParkingReceipt table)
   ========================= */
function getReceiptUrlsForUser(job, uid, email, appRec, attendanceRec, receiptIndex) {
  const urls = [];

  const pushVal = (v) => {
    if (!v) return;

    // array => recurse
    if (Array.isArray(v)) {
      v.forEach(pushVal);
      return;
    }

    // string => add
    if (typeof v === "string") {
      const s = v.trim();
      if (s) urls.push(s);
      return;
    }

    // object => try common fields
    if (typeof v === "object") {
      const candidates = [
        v.url,
        v.imageUrl,
        v.photoUrlAbs,
        v.photoUrl,
        v.parkingReceiptUrl,
        v.receiptUrl,
        v.parkingReceipt,
        v.receipt,
      ];
      candidates.forEach(pushVal);
    }
  };

  // 1) from attendance record
  pushVal(attendanceRec?.parkingReceiptUrl);
  pushVal(attendanceRec?.receiptUrl);
  pushVal(attendanceRec?.parkingReceipt);
  pushVal(attendanceRec?.receipt);
  pushVal(attendanceRec?.parkingReceipts);
  pushVal(attendanceRec?.receipts);
  pushVal(attendanceRec?.parkingReceiptUrls);
  pushVal(attendanceRec?.receiptUrls);

  // 2) from application record
  pushVal(appRec?.parkingReceiptUrl);
  pushVal(appRec?.receiptUrl);
  pushVal(appRec?.parkingReceipt);
  pushVal(appRec?.receipt);
  pushVal(appRec?.addOns?.parkingReceiptUrl);
  pushVal(appRec?.addOns?.receiptUrl);
  pushVal(appRec?.addOns?.parkingReceipts);
  pushVal(appRec?.addOns?.receipts);

  // 3) from job-level maps
  const pr = job?.parkingReceipts || job?.parkingReceiptByUser || job?.parkingReceiptUrls || null;
  if (pr && typeof pr === "object" && !Array.isArray(pr)) {
    pushVal(pr?.[uid]);
    if (email) pushVal(pr?.[email]);
    pushVal(pr?.byUserId?.[uid]);
    if (email) pushVal(pr?.byEmail?.[email]);
  }

  // 4) from job-level arrays/lists
  const listCandidates = [];
  if (Array.isArray(job?.parkingReceiptsList)) listCandidates.push(...job.parkingReceiptsList);
  if (Array.isArray(job?.parkingReceipts)) listCandidates.push(...job.parkingReceipts);
  if (Array.isArray(job?.receipts)) listCandidates.push(...job.receipts);

  if (listCandidates.length) {
    const matches = listCandidates.filter((x) => {
      if (!x) return false;
      const byUid = x.userId === uid || x.uid === uid || x.id === uid;
      const byEmail = email
        ? String(x.email || "").toLowerCase() === String(email || "").toLowerCase()
        : false;
      return byUid || byEmail;
    });

    matches.forEach((m) => {
      pushVal(m);
      pushVal(m?.url);
      pushVal(m?.imageUrl);
      pushVal(m?.photoUrlAbs);
      pushVal(m?.photoUrl);
      pushVal(m?.parkingReceiptUrl);
      pushVal(m?.receiptUrl);
      pushVal(m?.parkingReceipt);
      pushVal(m?.receipt);
    });
  }

  // 5) legacy single fields
  pushVal(job?.parkingReceiptUrl);
  pushVal(job?.parkingReceiptImageUrl);
  pushVal(job?.parkingReceipt);

  // 6) from receiptIndex (ParkingReceipt table)
  const idx = receiptIndex || {};
  const ekey = email ? String(email).toLowerCase() : "";
  pushVal(idx?.byUserId?.[uid]);
  if (ekey) pushVal(idx?.byEmail?.[ekey]);

  // ✅ cleanup unique using normalized key (absolute vs relative become the same)
  const seen = new Set();
  const out = [];

  urls.forEach((u) => {
    const raw = String(u || "").trim();
    if (!raw) return;

    const norm = normalizeReceiptUrl(raw);
    if (!norm) return;

    // key used for dedupe
    const key = isDataLike(norm) ? norm : norm.toLowerCase();

    if (seen.has(key)) return;
    seen.add(key);
    out.push(norm);
  });

  return out;
}

function receiptCsvValue(url) {
  if (!url) return "";
  if (String(url).startsWith("data:")) return "embedded-image-data";
  return String(url);
}
function receiptCsvValueList(urls) {
  if (!urls || !Array.isArray(urls) || urls.length === 0) return "";
  return urls.map(receiptCsvValue).join(" | ");
}

/* ---------------- receipt img loader (supports protected /uploads) ---------------- */
const isHttpUrl = (u) => /^https?:\/\//i.test(String(u || ""));
const isDataUrl = (u) => String(u || "").startsWith("data:");

function toApiPathFromMaybeUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s.startsWith("/")) return s;

  if (isHttpUrl(s)) {
    try {
      const u = new URL(s);
      return u.pathname + (u.search || "");
    } catch {
      return "";
    }
  }
  return "/" + s;
}

/* ---------------- UI (cleaner + less boxy) ---------------- */
const styles = {
  page: { paddingTop: 12, paddingBottom: 24 },
  panel: {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 16,
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  },
  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  h2: { fontWeight: 900, fontSize: 16, margin: 0, color: "#111827" },
  sub: { fontSize: 12, color: "#6b7280", marginTop: 4 },
  divider: { height: 1, background: "#eef2f7", margin: "14px 0" },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  grid3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 },
  grid5: { display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 },
  label: { fontSize: 12, fontWeight: 700, color: "#374151" },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    outline: "none",
    background: "#fff",
  },
  select: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    outline: "none",
    background: "#fff",
  },
  tabRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 12,
  },
  tab: (active) => ({
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid " + (active ? "#111827" : "#e5e7eb"),
    background: active ? "#111827" : "#fff",
    color: active ? "#fff" : "#111827",
    fontWeight: 800,
    fontSize: 12,
    cursor: "pointer",
  }),
  pill: (bg, color) => ({
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 800,
    background: bg,
    color,
    border: "1px solid rgba(0,0,0,0.05)",
  }),
  details: {
    border: "1px solid #eef2f7",
    borderRadius: 14,
    padding: 12,
    background: "#fafafa",
  },
  summary: {
    cursor: "pointer",
    fontWeight: 900,
    color: "#111827",
    listStyle: "none",
  },
};

const Panel = ({ title, subtitle, right, children }) => (
  <div style={styles.panel}>
    <div style={styles.panelHeader}>
      <div>
        <h2 style={styles.h2}>{title}</h2>
        {subtitle ? <div style={styles.sub}>{subtitle}</div> : null}
      </div>
      {right || null}
    </div>
    <div style={styles.divider} />
    {children}
  </div>
);

const Field = ({ label, hint, children }) => (
  <div style={{ display: "grid", gap: 6 }}>
    <div style={styles.label}>{label}</div>
    {children}
    {hint ? <div style={{ fontSize: 12, color: "#6b7280" }}>{hint}</div> : null}
  </div>
);

/* ---------------- Global Defaults (local) ---------------- */
const GLOBAL_KEY = "atag.globalWageDefaults.v2";
const defaultGlobal = {
  parkingAllowance: 0,
  earlyCall: { enabled: false, amount: 20, thresholdHours: 3 },
  loadingUnload: { enabled: false, price: 30, quota: 0 },
  hourly_by_role: {
    junior: { base: 20, otRatePerHour: 25 },
    senior: { base: 25, otRatePerHour: 30 },
    lead: { base: 30, otRatePerHour: 40 },
  },
  hourly_flat: { base: 20, otRatePerHour: 25 },
  session: {
    half_day: { jr: 60, sr: 80, lead: 100, jrEmcee: 44, srEmcee: 88 },
    full_day: { jr: 120, sr: 160, lead: 200, jrEmcee: 88, srEmcee: 168 },
    twoD1N: { jr: 300, sr: 400, lead: 500, jrEmcee: 0, srEmcee: 0 },
    threeD2N: { jr: 450, sr: 600, lead: 750, jrEmcee: 0, srEmcee: 0 },
  },
};
function loadGlobalDefaults() {
  try {
    const raw = localStorage.getItem(GLOBAL_KEY);
    if (!raw) return { ...defaultGlobal };
    const parsed = JSON.parse(raw);
    return { ...defaultGlobal, ...parsed };
  } catch {
    return { ...defaultGlobal };
  }
}
function saveGlobalDefaults(obj) {
  try {
    localStorage.setItem(GLOBAL_KEY, JSON.stringify(obj));
  } catch {}
}

/* ------------ mapping helpers to mirror JobModal ------------ */
const KIND_PROP = {
  half_day: "halfDay",
  full_day: "fullDay",
  "2d1n": "twoD1N",
  "3d2n": "threeD2N",
};
const isSessionKind = (k) => ["half_day", "full_day", "2d1n", "3d2n"].includes(k);

/* ---- defaults mirroring JobModal fallbacks ---- */
const DEFAULT_HOURLY = { jr: "15", sr: "20", lead: "25" };
const DEFAULT_HALF = { jr: "60", sr: "80", lead: "100", jrEmcee: "44", srEmcee: "88" };
const DEFAULT_FULL = { jr: "120", sr: "160", lead: "200", jrEmcee: "88", srEmcee: "168" };
const DEFAULT_2D1N = { jr: "300", sr: "400", lead: "500", jrEmcee: "0", srEmcee: "0" };
const DEFAULT_3D2N = { jr: "450", sr: "600", lead: "750", jrEmcee: "0", srEmcee: "0" };

export default function Admin({ navigate, user }) {
  const [tab, setTab] = useState("defaults"); // defaults | job | payroll

  const [jobs, setJobs] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");

  const isAdmin = user?.role === "admin";

  // ✅ Receipt modal supports MULTIPLE urls + arrows
  const [receiptModal, setReceiptModal] = useState(null); // { title: string, urls: string[], idx: number }
  const openReceiptModal = (title, urls, startIdx = 0) => {
    const safe = Array.isArray(urls) ? urls.map(normalizeReceiptUrl).filter(Boolean) : [];
    if (!safe.length) return;

    const seen = new Set();
    const uniq = [];
    for (const u of safe) {
      const key = isDataLike(u) ? u : u.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(u);
    }

    if (!uniq.length) return;

    const idx = Math.max(0, Math.min(startIdx, uniq.length - 1));
    setReceiptModal({ title: title || "Parking Receipt", urls: uniq, idx });
  };

  const closeReceiptModal = () => setReceiptModal(null);

  const goPrevReceipt = () => {
    setReceiptModal((m) => {
      if (!m || !m.urls?.length) return m;
      const nextIdx = Math.max(0, (m.idx || 0) - 1);
      return { ...m, idx: nextIdx };
    });
  };
  const goNextReceipt = () => {
    setReceiptModal((m) => {
      if (!m || !m.urls?.length) return m;
      const nextIdx = Math.min(m.urls.length - 1, (m.idx || 0) + 1);
      return { ...m, idx: nextIdx };
    });
  };

  // Keyboard: Esc closes, arrows navigate
  useEffect(() => {
    if (!receiptModal) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") closeReceiptModal();
      if (e.key === "ArrowLeft") goPrevReceipt();
      if (e.key === "ArrowRight") goNextReceipt();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptModal]);

  // ✅ NEW: receipts index loaded from backend (ParkingReceipt table)
  const [receiptIndex, setReceiptIndex] = useState({ byUserId: {}, byEmail: {} });

  function normalizeReceiptList(resp) {
    if (!resp) return [];
    if (Array.isArray(resp)) return resp;
    if (resp.receipts && Array.isArray(resp.receipts)) return resp.receipts;
    if (resp.receipt) return [resp.receipt];
    return [];
  }

  async function loadReceiptsForJob(jobId) {
    // try a few common endpoints (use whichever exists in your backend)
    const tries = [
      `/jobs/${jobId}/parking-receipts`,
      `/jobs/${jobId}/parking-receipt/list`,
      `/parking-receipts?jobId=${jobId}`,
      `/admin/parking-receipts?jobId=${jobId}`,
    ];

    for (const path of tries) {
      try {
        const resp = await apiGet(path);
        const list = normalizeReceiptList(resp);

        const byUserId = {};
        const byEmail = {};

        list.forEach((r) => {
          if (!r) return;
          const uid = r.userId ? String(r.userId) : "";
          const email = r.email ? String(r.email).toLowerCase() : "";
          const url = r.photoUrlAbs || r.photoUrl || r.url || r.imageUrl;
          if (!url) return;

          if (uid) {
            if (!byUserId[uid]) byUserId[uid] = [];
            byUserId[uid].push(url);
          }
          if (email) {
            if (!byEmail[email]) byEmail[email] = [];
            byEmail[email].push(url);
          }
        });

        const uniq = (arr) => Array.from(new Set((arr || []).filter(Boolean).map(String)));
        Object.keys(byUserId).forEach((k) => (byUserId[k] = uniq(byUserId[k])));
        Object.keys(byEmail).forEach((k) => (byEmail[k] = uniq(byEmail[k])));

        setReceiptIndex({ byUserId, byEmail });
        return; // ✅ stop at first successful endpoint
      } catch {
        // try next endpoint
      }
    }

    setReceiptIndex({ byUserId: {}, byEmail: {} });
  }

  useEffect(() => {
    if (!selectedId) {
      setReceiptIndex({ byUserId: {}, byEmail: {} });
      return;
    }
    loadReceiptsForJob(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ✅ modal image resolves through apiGetBlob (works even if /uploads needs auth)
  const receiptCacheRef = useRef(new Map()); // key(path) -> objectUrl
  const [receiptImgSrc, setReceiptImgSrc] = useState("");
  const [receiptImgLoading, setReceiptImgLoading] = useState(false);
  const [receiptImgErr, setReceiptImgErr] = useState("");

  useEffect(() => {
    return () => {
      try {
        for (const v of receiptCacheRef.current.values()) URL.revokeObjectURL(v);
      } catch {}
      receiptCacheRef.current.clear();
    };
  }, []);

  async function resolveReceiptImgSrc(rawUrl) {
    const s = String(rawUrl || "").trim();
    if (!s) return "";
    if (isDataUrl(s)) return s;

    const path = toApiPathFromMaybeUrl(s);
    if (!path) return s;

    if (receiptCacheRef.current.has(path)) return receiptCacheRef.current.get(path);

    const blob = await apiGetBlob(path);
    const obj = URL.createObjectURL(blob);
    receiptCacheRef.current.set(path, obj);
    return obj;
  }

  useEffect(() => {
    if (!receiptModal?.urls?.length) return;

    let alive = true;
    const raw = receiptModal.urls[receiptModal.idx];

    setReceiptImgLoading(true);
    setReceiptImgErr("");
    setReceiptImgSrc("");

    (async () => {
      try {
        const src = await resolveReceiptImgSrc(raw);
        if (!alive) return;
        setReceiptImgSrc(src);
      } catch (e) {
        if (!alive) return;
        setReceiptImgErr(String(e?.message || e || "Failed to load"));
      } finally {
        if (!alive) return;
        setReceiptImgLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptModal?.idx, receiptModal?.urls?.length]);

  // Central user map (from /admin/users)
  const [userMap, setUserMap] = useState({});

  /* ---------- GLOBAL DEFAULTS STATE ---------- */
  const [globalCfg, setGlobalCfg] = useState(loadGlobalDefaults());
  const [gParking, setGParking] = useState(String(globalCfg.parkingAllowance ?? 0));
  const [gECAmount, setGECAmount] = useState(String(globalCfg.earlyCall?.amount ?? 20));
  const [gLDUPrice, setGLDUPrice] = useState(String(globalCfg.loadingUnload?.price ?? 30));

  const [gHrJr, setGHrJr] = useState(String(globalCfg.hourly_by_role.junior.base));
  const [gHrJrOT, setGHrJrOT] = useState(String(globalCfg.hourly_by_role.junior.otRatePerHour));
  const [gHrSr, setGHrSr] = useState(String(globalCfg.hourly_by_role.senior.base));
  const [gHrSrOT, setGHrSrOT] = useState(String(globalCfg.hourly_by_role.senior.otRatePerHour));
  const [gHrLead, setGHrLead] = useState(String(globalCfg.hourly_by_role.lead.base));
  const [gHrLeadOT, setGHrLeadOT] = useState(String(globalCfg.hourly_by_role.lead.otRatePerHour));

  const [gFlat, setGFlat] = useState(String(globalCfg.hourly_flat.base));
  const [gFlatOT, setGFlatOT] = useState(String(globalCfg.hourly_flat.otRatePerHour));

  const [gHalfJr, setGHalfJr] = useState(String(globalCfg.session.half_day.jr ?? DEFAULT_HALF.jr));
  const [gHalfSr, setGHalfSr] = useState(String(globalCfg.session.half_day.sr ?? DEFAULT_HALF.sr));
  const [gHalfLead, setGHalfLead] = useState(String(globalCfg.session.half_day.lead ?? DEFAULT_HALF.lead));
  const [gHalfJrEmcee, setGHalfJrEmcee] = useState(String(globalCfg.session.half_day.jrEmcee ?? DEFAULT_HALF.jrEmcee));
  const [gHalfSrEmcee, setGHalfSrEmcee] = useState(String(globalCfg.session.half_day.srEmcee ?? DEFAULT_HALF.srEmcee));

  const [gFullJr, setGFullJr] = useState(String(globalCfg.session.full_day.jr ?? DEFAULT_FULL.jr));
  const [gFullSr, setGFullSr] = useState(String(globalCfg.session.full_day.sr ?? DEFAULT_FULL.sr));
  const [gFullLead, setGFullLead] = useState(String(globalCfg.session.full_day.lead ?? DEFAULT_FULL.lead));
  const [gFullJrEmcee, setGFullJrEmcee] = useState(String(globalCfg.session.full_day.jrEmcee ?? DEFAULT_FULL.jrEmcee));
  const [gFullSrEmcee, setGFullSrEmcee] = useState(String(globalCfg.session.full_day.srEmcee ?? DEFAULT_FULL.srEmcee));

  const [g2d1nJr, setG2d1nJr] = useState(String(globalCfg.session.twoD1N.jr ?? DEFAULT_2D1N.jr));
  const [g2d1nSr, setG2d1nSr] = useState(String(globalCfg.session.twoD1N.sr ?? DEFAULT_2D1N.sr));
  const [g2d1nLead, setG2d1nLead] = useState(String(globalCfg.session.twoD1N.lead ?? DEFAULT_2D1N.lead));
  const [g2d1nJrEmcee, setG2d1nJrEmcee] = useState(String(globalCfg.session.twoD1N.jrEmcee ?? DEFAULT_2D1N.jrEmcee));
  const [g2d1nSrEmcee, setG2d1nSrEmcee] = useState(String(globalCfg.session.twoD1N.srEmcee ?? DEFAULT_2D1N.srEmcee));

  const [g3d2nJr, setG3d2nJr] = useState(String(globalCfg.session.threeD2N.jr ?? DEFAULT_3D2N.jr));
  const [g3d2nSr, setG3d2nSr] = useState(String(globalCfg.session.threeD2N.sr ?? DEFAULT_3D2N.sr));
  const [g3d2nLead, setG3d2nLead] = useState(String(globalCfg.session.threeD2N.lead ?? DEFAULT_3D2N.lead));
  const [g3d2nJrEmcee, setG3d2nJrEmcee] = useState(String(globalCfg.session.threeD2N.jrEmcee ?? DEFAULT_3D2N.jrEmcee));
  const [g3d2nSrEmcee, setG3d2nSrEmcee] = useState(String(globalCfg.session.threeD2N.srEmcee ?? DEFAULT_3D2N.srEmcee));

  function saveGlobal() {
    const ecPrev = globalCfg.earlyCall || {};
    const lduPrev = globalCfg.loadingUnload || {};

    const out = {
      parkingAllowance: N(gParking, 0),
      earlyCall: {
        enabled: ecPrev.enabled ?? true,
        amount: N(gECAmount, 0),
        thresholdHours: ecPrev.thresholdHours ?? 3,
      },
      loadingUnload: {
        enabled: lduPrev.enabled ?? true,
        price: N(gLDUPrice, 0),
        quota: lduPrev.quota ?? 0,
      },
      hourly_by_role: {
        junior: { base: N(gHrJr, 0), otRatePerHour: N(gHrJrOT, 0) },
        senior: { base: N(gHrSr, 0), otRatePerHour: N(gHrSrOT, 0) },
        lead: { base: N(gHrLead, 0), otRatePerHour: N(gHrLeadOT, 0) },
      },
      hourly_flat: { base: N(gFlat, 0), otRatePerHour: N(gFlatOT, 0) },
      session: {
        half_day: {
          jr: N(gHalfJr, 0),
          sr: N(gHalfSr, 0),
          lead: N(gHalfLead, 0),
          jrEmcee: N(gHalfJrEmcee, 0),
          srEmcee: N(gHalfSrEmcee, 0),
        },
        full_day: {
          jr: N(gFullJr, 0),
          sr: N(gFullSr, 0),
          lead: N(gFullLead, 0),
          jrEmcee: N(gFullJrEmcee, 0),
          srEmcee: N(gFullSrEmcee, 0),
        },
        twoD1N: {
          jr: N(g2d1nJr, 0),
          sr: N(g2d1nSr, 0),
          lead: N(g2d1nLead, 0),
          jrEmcee: N(g2d1nJrEmcee, 0),
          srEmcee: N(g2d1nSrEmcee, 0),
        },
        threeD2N: {
          jr: N(g3d2nJr, 0),
          sr: N(g3d2nSr, 0),
          lead: N(g3d2nLead, 0),
          jrEmcee: N(g3d2nJrEmcee, 0),
          srEmcee: N(g3d2nSrEmcee, 0),
        },
      },
    };
    setGlobalCfg(out);
    saveGlobalDefaults(out);
    alert("Saved global defaults. New jobs will pick these up automatically.");
  }

  /* ---------- parking + job locals ---------- */
  const [parkingAllowance, setParkingAllowance] = useState("0");

  /* ---------- session type (mirror JobModal) ---------- */
  const [sessionMode, setSessionMode] = useState("virtual"); // "virtual" | "physical"
  const [physicalType, setPhysicalType] = useState("half_day"); // for physical
  const [hourlyAddon, setHourlyAddon] = useState(false); // for session variants only

  // Hourly by role
  const [hrJr, setHrJr] = useState(DEFAULT_HOURLY.jr);
  const [hrSr, setHrSr] = useState(DEFAULT_HOURLY.sr);
  const [hrLead, setHrLead] = useState(DEFAULT_HOURLY.lead);
  const [hrJrOT, setHrJrOT] = useState("0");
  const [hrSrOT, setHrSrOT] = useState("0");
  const [hrLeadOT, setHrLeadOT] = useState("0");

  // Flat hourly
  const [flatRate, setFlatRate] = useState(DEFAULT_HOURLY.jr);
  const [flatOT, setFlatOT] = useState("0");

  // Session prices (per job: host + emcee)
  const [pHalfJr, setPHalfJr] = useState(DEFAULT_HALF.jr);
  const [pHalfSr, setPHalfSr] = useState(DEFAULT_HALF.sr);
  const [pHalfLead, setPHalfLead] = useState(DEFAULT_HALF.lead);
  const [pHalfJrEmcee, setPHalfJrEmcee] = useState(DEFAULT_HALF.jrEmcee);
  const [pHalfSrEmcee, setPHalfSrEmcee] = useState(DEFAULT_HALF.srEmcee);

  const [pFullJr, setPFullJr] = useState(DEFAULT_FULL.jr);
  const [pFullSr, setPFullSr] = useState(DEFAULT_FULL.sr);
  const [pFullLead, setPFullLead] = useState(DEFAULT_FULL.lead);
  const [pFullJrEmcee, setPFullJrEmcee] = useState(DEFAULT_FULL.jrEmcee);
  const [pFullSrEmcee, setPFullSrEmcee] = useState(DEFAULT_FULL.srEmcee);

  const [p2d1nJr, setP2d1nJr] = useState(DEFAULT_2D1N.jr);
  const [p2d1nSr, setP2d1nSr] = useState(DEFAULT_2D1N.sr);
  const [p2d1nLead, setP2d1nLead] = useState(DEFAULT_2D1N.lead);
  const [p2d1nJrEmcee, setP2d1nJrEmcee] = useState(DEFAULT_2D1N.jrEmcee);
  const [p2d1nSrEmcee, setP2d1nSrEmcee] = useState(DEFAULT_2D1N.srEmcee);

  const [p3d2nJr, setP3d2nJr] = useState(DEFAULT_3D2N.jr);
  const [p3d2nSr, setP3d2nSr] = useState(DEFAULT_3D2N.sr);
  const [p3d2nLead, setP3d2nLead] = useState(DEFAULT_3D2N.lead);
  const [p3d2nJrEmcee, setP3d2nJrEmcee] = useState(DEFAULT_3D2N.jrEmcee);
  const [p3d2nSrEmcee, setP3d2nSrEmcee] = useState(DEFAULT_3D2N.srEmcee);

  /* ===== Load jobs ===== */
  useEffect(() => {
    if (user?.role !== "admin" && user?.role !== "pm") return;
    apiGet("/jobs")
      .then((j) => setJobs(j || []))
      .catch((e) => setError(String(e)));
  }, [user]);

  // Load central users for name/phone/email in wage summary
  useEffect(() => {
    if (!user || user.role !== "admin") return;
    apiGet("/admin/users")
      .then((rows) => {
        const map = {};
        (rows || []).forEach((u) => {
          if (!u || !u.id) return;
          map[u.id] = u;
        });
        setUserMap(map);
      })
      .catch((err) => {
        console.warn("Failed to load user map in Admin wages:", err);
      });
  }, [user]);

  /* ===== Infer helpers (like JobModal) ===== */
  function inferModeFromJob(j) {
    const kind = j?.rate?.sessionKind;
    if (kind === "virtual") return "virtual";
    if (["half_day", "full_day", "2d1n", "3d2n", "hourly_by_role", "hourly_flat"].includes(kind)) return "physical";
    return j?.session?.mode || j?.sessionMode || j?.mode || "virtual";
  }
  function inferPhysTypeFromJob(j) {
    const kind = j?.rate?.sessionKind;
    if (["half_day", "full_day", "2d1n", "3d2n", "hourly_by_role", "hourly_flat"].includes(kind)) return kind;
    const legacy = j?.session?.physicalType || j?.physicalType || j?.physicalSubtype;
    return ["half_day", "full_day", "2d1n", "3d2n", "hourly_by_role", "hourly_flat"].includes(legacy) ? legacy : "half_day";
  }

  /* ===== Load selected job details ===== */
  useEffect(() => {
    if (!selectedId) {
      setJob(null);
      return;
    }
    (async () => {
      try {
        const j = await apiGet(`/jobs/${selectedId}`);
        setJob(j);

        const mode = inferModeFromJob(j);
        const phys = inferPhysTypeFromJob(j);
        setSessionMode(mode);
        setPhysicalType(phys);

        const rate = j.rate || {};
        const tr = rate.tierRates || {};
        const flat = rate.flatHourly || {};
        const gl = loadGlobalDefaults();

        const pa =
          (Number.isFinite(rate.parkingAllowance) ? rate.parkingAllowance : undefined) ??
          (Number.isFinite(rate.transportAllowance) ? rate.transportAllowance : undefined) ??
          (Number.isFinite(rate.transportBus) ? rate.transportBus : 0);
        setParkingAllowance(String(pa ?? 0));

        const anyPlusHourly = ["junior", "senior", "lead"].some((rk) => tr[rk]?.payMode === "specific_plus_hourly");
        setHourlyAddon(!!anyPlusHourly);

        // Hourly by role / virtual
        setHrJr(String(tr.junior?.base ?? gl.hourly_by_role?.junior?.base ?? DEFAULT_HOURLY.jr));
        setHrSr(String(tr.senior?.base ?? gl.hourly_by_role?.senior?.base ?? DEFAULT_HOURLY.sr));
        setHrLead(String(tr.lead?.base ?? gl.hourly_by_role?.lead?.base ?? DEFAULT_HOURLY.lead));
        setHrJrOT(String(tr.junior?.otRatePerHour ?? gl.hourly_by_role?.junior?.otRatePerHour ?? "0"));
        setHrSrOT(String(tr.senior?.otRatePerHour ?? gl.hourly_by_role?.senior?.otRatePerHour ?? "0"));
        setHrLeadOT(String(tr.lead?.otRatePerHour ?? gl.hourly_by_role?.lead?.otRatePerHour ?? "0"));

        // Flat hourly
        setFlatRate(String(flat.base ?? gl.hourly_flat?.base ?? DEFAULT_HOURLY.jr));
        setFlatOT(String(flat.otRatePerHour ?? gl.hourly_flat?.otRatePerHour ?? "0"));

        // Session prices (host + emcee)
        setPHalfJr(String(tr.junior?.halfDay ?? gl.session?.half_day?.jr ?? DEFAULT_HALF.jr));
        setPHalfSr(String(tr.senior?.halfDay ?? gl.session?.half_day?.sr ?? DEFAULT_HALF.sr));
        setPHalfLead(String(tr.lead?.halfDay ?? gl.session?.half_day?.lead ?? DEFAULT_HALF.lead));
        setPHalfJrEmcee(String(tr.junior_emcee?.halfDay ?? gl.session?.half_day?.jrEmcee ?? DEFAULT_HALF.jrEmcee));
        setPHalfSrEmcee(String(tr.senior_emcee?.halfDay ?? gl.session?.half_day?.srEmcee ?? DEFAULT_HALF.srEmcee));

        setPFullJr(String(tr.junior?.fullDay ?? gl.session?.full_day?.jr ?? DEFAULT_FULL.jr));
        setPFullSr(String(tr.senior?.fullDay ?? gl.session?.full_day?.sr ?? DEFAULT_FULL.sr));
        setPFullLead(String(tr.lead?.fullDay ?? gl.session?.full_day?.lead ?? DEFAULT_FULL.lead));
        setPFullJrEmcee(String(tr.junior_emcee?.fullDay ?? gl.session?.full_day?.jrEmcee ?? DEFAULT_FULL.jrEmcee));
        setPFullSrEmcee(String(tr.senior_emcee?.fullDay ?? gl.session?.full_day?.srEmcee ?? DEFAULT_FULL.srEmcee));

        setP2d1nJr(String(tr.junior?.twoD1N ?? gl.session?.twoD1N?.jr ?? DEFAULT_2D1N.jr));
        setP2d1nSr(String(tr.senior?.twoD1N ?? gl.session?.twoD1N?.sr ?? DEFAULT_2D1N.sr));
        setP2d1nLead(String(tr.lead?.twoD1N ?? gl.session?.twoD1N?.lead ?? DEFAULT_2D1N.lead));
        setP2d1nJrEmcee(String(tr.junior_emcee?.twoD1N ?? gl.session?.twoD1N?.jrEmcee ?? DEFAULT_2D1N.jrEmcee));
        setP2d1nSrEmcee(String(tr.senior_emcee?.twoD1N ?? gl.session?.twoD1N?.srEmcee ?? DEFAULT_2D1N.srEmcee));

        setP3d2nJr(String(tr.junior?.threeD2N ?? gl.session?.threeD2N?.jr ?? DEFAULT_3D2N.jr));
        setP3d2nSr(String(tr.senior?.threeD2N ?? gl.session?.threeD2N?.sr ?? DEFAULT_3D2N.sr));
        setP3d2nLead(String(tr.lead?.threeD2N ?? gl.session?.threeD2N?.lead ?? DEFAULT_3D2N.lead));
        setP3d2nJrEmcee(String(tr.junior_emcee?.threeD2N ?? gl.session?.threeD2N?.jrEmcee ?? DEFAULT_3D2N.jrEmcee));
        setP3d2nSrEmcee(String(tr.senior_emcee?.threeD2N ?? gl.session?.threeD2N?.srEmcee ?? DEFAULT_3D2N.srEmcee));
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [selectedId]);

  const headerPills = useMemo(() => {
    if (!job) return null;
    return <span style={styles.pill("#f3f4f6", "#111827")}>{job.status || "upcoming"}</span>;
  }, [job]);

  if (!user || (user.role !== "admin" && user.role !== "pm")) {
    return (
      <div className="container" style={styles.page}>
        <div style={styles.panel}>Admin/PM only.</div>
      </div>
    );
  }

  /* --------- build tierRates payload (mirror JobModal) --------- */
  function buildTierRates(kind) {
    if (kind === "virtual" || kind === "hourly_by_role") {
      return {
        junior: { payMode: "hourly", base: N(hrJr, 15), otRatePerHour: N(hrJrOT, 0) },
        senior: { payMode: "hourly", base: N(hrSr, 20), otRatePerHour: N(hrSrOT, 0) },
        lead: { payMode: "hourly", base: N(hrLead, 25), otRatePerHour: N(hrLeadOT, 0) },
      };
    }
    if (kind === "hourly_flat") {
      const base = N(flatRate, 15);
      const ot = N(flatOT, 0);
      return {
        junior: { payMode: "hourly", base, otRatePerHour: ot },
        senior: { payMode: "hourly", base, otRatePerHour: ot },
        lead: { payMode: "hourly", base, otRatePerHour: ot },
      };
    }

    // Session variants
    const price = (tier) => {
      if (kind === "half_day") {
        if (tier === "jr") return N(pHalfJr);
        if (tier === "sr") return N(pHalfSr);
        if (tier === "lead") return N(pHalfLead);
        if (tier === "jrEmcee") return N(pHalfJrEmcee);
        if (tier === "srEmcee") return N(pHalfSrEmcee);
      }
      if (kind === "full_day") {
        if (tier === "jr") return N(pFullJr);
        if (tier === "sr") return N(pFullSr);
        if (tier === "lead") return N(pFullLead);
        if (tier === "jrEmcee") return N(pFullJrEmcee);
        if (tier === "srEmcee") return N(pFullSrEmcee);
      }
      if (kind === "2d1n") {
        if (tier === "jr") return N(p2d1nJr);
        if (tier === "sr") return N(p2d1nSr);
        if (tier === "lead") return N(p2d1nLead);
        if (tier === "jrEmcee") return N(p2d1nJrEmcee);
        if (tier === "srEmcee") return N(p2d1nSrEmcee);
      }
      if (tier === "jr") return N(p3d2nJr);
      if (tier === "sr") return N(p3d2nSr);
      if (tier === "lead") return N(p3d2nLead);
      if (tier === "jrEmcee") return N(p3d2nJrEmcee);
      if (tier === "srEmcee") return N(p3d2nSrEmcee);
      return 0;
    };

    const mode = hourlyAddon ? "specific_plus_hourly" : "specific";
    const ifHourly = (base, ot) => (hourlyAddon ? { base, otRatePerHour: ot } : {});
    return {
      junior: {
        payMode: mode,
        specificPayment: price("jr"),
        ...ifHourly(N(hrJr, 15), N(hrJrOT, 0)),
        halfDay: N(pHalfJr),
        fullDay: N(pFullJr),
        twoD1N: N(p2d1nJr),
        threeD2N: N(p3d2nJr),
      },
      senior: {
        payMode: mode,
        specificPayment: price("sr"),
        ...ifHourly(N(hrSr, 20), N(hrSrOT, 0)),
        halfDay: N(pHalfSr),
        fullDay: N(pFullSr),
        twoD1N: N(p2d1nSr),
        threeD2N: N(p3d2nSr),
      },
      lead: {
        payMode: mode,
        specificPayment: price("lead"),
        ...ifHourly(N(hrLead, 25), N(hrLeadOT, 0)),
        halfDay: N(pHalfLead),
        fullDay: N(pFullLead),
        twoD1N: N(p2d1nLead),
        threeD2N: N(p3d2nLead),
      },
      junior_emcee: {
        payMode: mode,
        specificPayment: price("jrEmcee"),
        ...ifHourly(N(hrJr, 15), N(hrJrOT, 0)),
        halfDay: N(pHalfJrEmcee),
        fullDay: N(pFullJrEmcee),
        twoD1N: N(p2d1nJrEmcee),
        threeD2N: N(p3d2nJrEmcee),
      },
      senior_emcee: {
        payMode: mode,
        specificPayment: price("srEmcee"),
        ...ifHourly(N(hrSr, 20), N(hrSrOT, 0)),
        halfDay: N(pHalfSrEmcee),
        fullDay: N(pFullSrEmcee),
        twoD1N: N(p2d1nSrEmcee),
        threeD2N: N(p3d2nSrEmcee),
      },
    };
  }

  /* ===== Save back to server (selected job) ===== */
  async function saveConfig() {
    if (!job) return;

    const kind = sessionMode === "virtual" ? "virtual" : physicalType;
    const tierRates = buildTierRates(kind);

    const payload = {
      session: {
        mode: sessionMode,
        physicalType: sessionMode === "physical" ? physicalType : null,
        hourlyEnabled: isSessionKind(physicalType) ? !!hourlyAddon : false,
      },
      mode: sessionMode,
      sessionMode,
      sessionKind: kind,
      physicalType: sessionMode === "physical" ? physicalType : null,
      physicalSubtype: sessionMode === "physical" ? physicalType : null,
      physicalHourlyEnabled: isSessionKind(physicalType) ? !!hourlyAddon : false,
      rate: {
        transportBus: N(parkingAllowance, 0),
        transportAllowance: N(parkingAllowance, 0),
        parkingAllowance: N(parkingAllowance, 0),
        sessionKind: kind,
        tierRates,
        ...(physicalType === "hourly_flat"
          ? { flatHourly: { base: N(flatRate, 15), otRatePerHour: N(flatOT, 0) } }
          : {}),
      },
      allowances: {
        ...(job?.allowances || {}),
        parking: {
          enabled: !!(job?.transportOptions?.bus !== false),
          amount: N(parkingAllowance, 0),
        },
      },
    };

    try {
      await apiPatch(`/jobs/${job.id}`, payload);
      alert("Saved");
      const fresh = await apiGet(`/jobs/${job.id}`);
      setJob(fresh);
    } catch (e) {
      alert("Save failed: " + (e?.message || e));
    }
  }

  /* ===== Wage Calculation (PART-TIMERS ONLY) ===== */
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ employees: 0, hours: 0, wages: 0, jobs: 0 });
  const [search, setSearch] = useState("");

  function calcWages() {
    if (!job) {
      setRows([]);
      setSummary({ employees: 0, hours: 0, wages: 0, jobs: 0 });
      return;
    }

    const pick = (...vals) => {
      for (const v of vals) {
        if (v === undefined || v === null) continue;
        if (typeof v === "string" && v.trim() === "") continue;
        return v;
      }
      return "";
    };

    const HOUR_MS = 3600000;
    const rate = job.rate || {};
    const tierRates = rate.tierRates || {};
    const flat = rate.flatHourly || {};
    const kind = rate.sessionKind || "virtual";

    const approved = new Set(job.approved || []);
    const apps = job.applications || [];
    const attendance = job.attendance || {};

    const outRows = [];

    const byUserTransport = new Map();
    apps.forEach((a) => {
      if (!a) return;
      const uid = a.userId;
      if (!uid) return;
      const t = a.transport === "ATAG Bus" ? "ATAG Transport" : a.transport || "Own Transport";
      byUserTransport.set(uid, t);
    });

    const scheduledStart = new Date(job.startTime);
    const scheduledEnd = new Date(job.endTime);
    const scheduledHours = Math.max(0, (scheduledEnd - scheduledStart) / HOUR_MS);

    // Allowances
    const ec = job.earlyCall || {};
    const ldu = job.loadingUnload || {};
    const lduOn = !!ldu.enabled;
    const lduPriceNum = N(ldu.price, 0);
    const lduHelpers = new Set(ldu.participants || []);

    const parkingAmt =
      (Number.isFinite(rate.parkingAllowance) ? rate.parkingAllowance : undefined) ??
      (Number.isFinite(rate.transportAllowance) ? rate.transportAllowance : undefined) ??
      (Number.isFinite(rate.transportBus) ? rate.transportBus : 0);

    const priceProp = KIND_PROP[kind];
    const hrs = (a, b) => Math.max(0, (b - a) / HOUR_MS);

    const mapRoleToTierKey = (role) => {
      const v = (role || "").toString().trim().toLowerCase();
      if (!v) return null;
      if (["junior", "jr"].includes(v)) return "junior";
      if (["senior", "sr"].includes(v)) return "senior";
      if (["lead", "lead host", "leader"].includes(v)) return "lead";
      if (v === "junior_emcee" || v === "jr_emcee" || v.includes("junior emcee") || v.includes("junior mc")) return "junior_emcee";
      if (v === "senior_emcee" || v === "sr_emcee" || v.includes("senior emcee") || v.includes("senior mc")) return "senior_emcee";
      if (v.includes("junior") && v.includes("marshal")) return "junior";
      if (v.includes("senior") && v.includes("marshal")) return "senior";
      return null;
    };

    const tierKeyForUser = (uid, appRec) => {
      const jobRoles = job.roleByUser || job.tierByUser || {};
      const raw = (appRec && (appRec.tier || appRec.role || appRec.level || appRec.position)) || jobRoles[uid];
      const mapped = mapRoleToTierKey(raw) || raw;
      if (["junior", "senior", "lead", "junior_emcee", "senior_emcee"].includes(mapped)) return mapped;
      return "junior";
    };

    const pushRowForPerson = (uid, appRec) => {
      const rec = attendance?.[uid] || (appRec?.email ? attendance?.[appRec.email] : null) || {};
      const inTime = rec.in ? new Date(rec.in) : null;
      const outTime = rec.out ? new Date(rec.out) : null;

      // ✅ Scan In/Out: time-only (no date)
      const scanInStr = inTime ? fmtTimeOnly(inTime) : "";
      const scanOutStr = outTime ? fmtTimeOnly(outTime) : "";

      let workedHours = scheduledHours;
      if (inTime && outTime) workedHours = hrs(inTime, outTime);
      else if (inTime && !outTime) workedHours = hrs(inTime, scheduledEnd);

      const baseHours = Math.min(workedHours, scheduledHours);
      const otHours = Math.max(0, workedHours - scheduledHours);
      const otWholeHours = Math.floor(otHours + 0.5);

      const tierKey = tierKeyForUser(uid, appRec);
      const rr = tierRates[tierKey] || tierRates["junior"] || {};

      let baseRate = 0;
      let otRate = 0;

      if (kind === "hourly_flat") {
        baseRate = N(flat.base, 0);
        otRate = N(flat.otRatePerHour, 0);
      } else if (kind === "virtual" || kind === "hourly_by_role") {
        baseRate = N(rr.base, 0);
        otRate = N(rr.otRatePerHour, 0);
      } else if (isSessionKind(kind)) {
        const hourlyEnabled = rr.payMode === "specific_plus_hourly";
        if (hourlyEnabled) {
          baseRate = N(rr.base, 0);
          otRate = N(rr.otRatePerHour, 0);
        }
      }

      const basePay = baseRate * baseHours;
      const otPay = otRate * otWholeHours;

      let specificPay = 0;
      if (isSessionKind(kind)) {
        const specific = rr.specificPayment != null ? N(rr.specificPayment, 0) : priceProp ? N(rr[priceProp], 0) : 0;
        specificPay = specific;
      }

      let allowances = 0;
      const transport = byUserTransport.get(uid) || "Own Transport";
      if (transport === "ATAG Transport" || transport === "ATAG Bus") allowances += N(parkingAmt, 0);

      // Early Call: ONLY add when PM checked for this person
      const ecAmt = N(ec.amount, 0);
      const earlyFromJob = (job && (job.earlyCallParticipants || job.earlyCallConfirmedUsers || job.earlyCallUsers)) || [];
      const earlyListRaw = (ec && (ec.participants || ec.users || ec.userIds || ec.confirmedUsers)) || [];

      const earlyLists = []
        .concat(Array.isArray(earlyFromJob) ? earlyFromJob : [earlyFromJob])
        .concat(Array.isArray(earlyListRaw) ? earlyListRaw : [earlyListRaw]);

      const earlyCheckedByList = earlyLists.some((p) => {
        const key = typeof p === "string" || typeof p === "number" ? String(p) : p?.userId || p?.id || p?.email || null;
        if (!key) return false;
        return key === uid || (appRec?.email && key === appRec.email);
      });

      const earlyChecked = !!rec?.earlyCall || !!appRec?.earlyCallConfirmed || !!appRec?.addOns?.earlyCall || earlyCheckedByList;
      const gotEarlyCall = !!(ec.enabled && ecAmt > 0 && earlyChecked);
      const earlyCallAmt = gotEarlyCall ? ecAmt : 0;
      if (gotEarlyCall) allowances += ecAmt;

      const gotLDU = !!(lduOn && lduHelpers.has(uid));
      const lduAmt = gotLDU ? lduPriceNum : 0;
      if (gotLDU) allowances += lduPriceNum;

      const gross = basePay + otPay + specificPay + allowances;

      // ✅ deduction removed (as requested)
      const net = gross;

      const appUser = (appRec && appRec.user) || {};
      const coreUser = userMap[uid] || {};

      const combinedAppName =
        appRec && (appRec.firstName || appRec.lastName) ? `${appRec.firstName || ""} ${appRec.lastName || ""}`.trim() : "";

      const name =
        pick(
          coreUser.name,
          coreUser.fullName,
          coreUser.displayName,
          appUser.name,
          appUser.fullName,
          appUser.displayName,
          appRec?.name,
          appRec?.fullName,
          appRec?.displayName,
          combinedAppName
        ) || uid;

      const phone = pick(coreUser.phone, coreUser.phoneNumber, appUser.phone, appUser.phoneNumber, appUser.contact, appRec?.phone, appRec?.phoneNumber, appRec?.contact) || "-";
      const emailFinal = pick(coreUser.email, appUser.email, appRec?.email, uid) || uid;

      // ✅ receipt URLs (multiple) with receiptIndex support
      const receiptUrls = getReceiptUrlsForUser(job, uid, appRec?.email || emailFinal, appRec, rec, receiptIndex);

      outRows.push({
        userId: uid,
        name: name || "-",
        email: emailFinal,
        phone,
        jobTitle: job.title,
        hours: Number(workedHours.toFixed(2)),
        transport,
        scanIn: scanInStr,
        scanOut: scanOutStr,
        receiptUrls,
        receiptUrl: receiptUrls[0] || "",
        wageGross: gross,
        wageNet: net,
        _basePay: basePay,
        _otPay: otPay,
        _specific: specificPay,
        _allowances: allowances,
        _gotEarlyCall: gotEarlyCall,
        _gotLDU: gotLDU,
        _earlyCallAmt: earlyCallAmt,
        _lduAmt: lduAmt,
      });
    };

    // ✅ PART-TIMERS only: show ONLY approved users who have attendance IN/OUT
    (job.approved || []).forEach((uid) => {
      if (!approved.has(uid)) return;

      const appRec = apps.find((a) => a.userId === uid) || {};
      const rec = attendance?.[uid] || (appRec?.email ? attendance?.[appRec.email] : null) || {};
      if (!rec?.in && !rec?.out) return;

      pushRowForPerson(uid, appRec);
    });

    const filtered = outRows
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .filter((r) => {
        if (!search.trim()) return true;
        const q = search.trim().toLowerCase();
        return (r.name || "").toLowerCase().includes(q) || (r.email || "").toLowerCase().includes(q) || (r.phone || "").toLowerCase().includes(q);
      });

    const employees = filtered.length;
    const hoursSum = filtered.reduce((s, r) => s + (Number.isFinite(r.hours) ? r.hours : 0), 0);
    const wagesSum = filtered.reduce((s, r) => s + r.wageNet, 0);

    setRows(filtered);
    setSummary({ employees, hours: hoursSum, wages: wagesSum, jobs: job ? 1 : 0 });
  }

  useEffect(() => {
    calcWages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, userMap, search, receiptIndex]);

  /* ===== Payroll meta (UI + CSV header block) ===== */
  const kindLabel = (kind) => {
    if (kind === "virtual") return "Virtual (Hourly)";
    if (kind === "hourly_by_role") return "Physical - Hourly (by role)";
    if (kind === "hourly_flat") return "Physical - Flat hourly";
    if (kind === "half_day") return "Physical - Half Day";
    if (kind === "full_day") return "Physical - Full Day";
    if (kind === "2d1n") return "Physical - 2D1N";
    if (kind === "3d2n") return "Physical - 3D2N";
    return String(kind || "-");
  };

  const buildPayrollMetaPairs = (j) => {
    if (!j) return [];
    const rate = j.rate || {};
    const tierRates = rate.tierRates || {};
    const flat = rate.flatHourly || {};
    const kind = rate.sessionKind || "virtual";
    const priceProp = KIND_PROP[kind];

    const parkingAmt =
      (Number.isFinite(rate.parkingAllowance) ? rate.parkingAllowance : undefined) ??
      (Number.isFinite(rate.transportAllowance) ? rate.transportAllowance : undefined) ??
      (Number.isFinite(rate.transportBus) ? rate.transportBus : 0);

    const ec = j.earlyCall || {};
    const ldu = j.loadingUnload || {};

    const tierLabel = {
      junior: "Junior",
      senior: "Senior",
      lead: "Lead Host",
      junior_emcee: "Junior Emcee",
      senior_emcee: "Senior Emcee",
    };

    const getSpecific = (tierKey) => {
      const rr = tierRates[tierKey] || {};
      if (rr.specificPayment != null) return N(rr.specificPayment, 0);
      if (priceProp && rr[priceProp] != null) return N(rr[priceProp], 0);
      return 0;
    };

    const hasHourlyAddon =
      isSessionKind(kind) &&
      ["junior", "senior", "lead"].some((k) => (tierRates[k]?.payMode || "") === "specific_plus_hourly");

    let paySetup = "-";
    let hourlyAddonLine = "";

    if (kind === "virtual" || kind === "hourly_by_role") {
      const jr = tierRates.junior || {};
      const sr = tierRates.senior || {};
      const ld = tierRates.lead || {};
      paySetup =
        `Junior ${money(jr.base)}/hr (OT ${money(jr.otRatePerHour)}/hr) | ` +
        `Senior ${money(sr.base)}/hr (OT ${money(sr.otRatePerHour)}/hr) | ` +
        `Lead ${money(ld.base)}/hr (OT ${money(ld.otRatePerHour)}/hr)`;
    } else if (kind === "hourly_flat") {
      paySetup = `Rate ${money(flat.base)}/hr (OT ${money(flat.otRatePerHour)}/hr)`;
    } else if (isSessionKind(kind)) {
      const parts = ["junior", "senior", "lead", "junior_emcee", "senior_emcee"]
        .map((k) => `${tierLabel[k]} ${money(getSpecific(k))}`)
        .join(" | ");
      paySetup = parts || "-";

      if (hasHourlyAddon) {
        const jr = tierRates.junior || {};
        const sr = tierRates.senior || {};
        const ld = tierRates.lead || {};
        hourlyAddonLine =
          `Junior ${money(jr.base)}/hr (OT ${money(jr.otRatePerHour)}/hr) | ` +
          `Senior ${money(sr.base)}/hr (OT ${money(sr.otRatePerHour)}/hr) | ` +
          `Lead ${money(ld.base)}/hr (OT ${money(ld.otRatePerHour)}/hr)`;
      }
    }

    const pairs = [
      ["Job Title", j.title || "-"],
      ["Venue", j.venue || "-"],
      // ✅ Requested: show Date once (or 2 dates for multi-day) + time line separately
      ["Date", fmtPayrollDateRange(j.startTime, j.endTime)],
      ["Time", fmtPayrollTimeRange(j.startTime, j.endTime)],
      ["Session Type", kindLabel(kind)],
      ["Pay Setup", paySetup],
    ];

    if (hasHourlyAddon && hourlyAddonLine) pairs.push(["Hourly Add-on", hourlyAddonLine]);

    if (N(parkingAmt, 0) > 0) {
      pairs.push(["Parking Allowance", `${money(parkingAmt)} (applies only when ATAG Transport selected)`]);
    }

    if (ec?.enabled && N(ec?.amount, 0) > 0) pairs.push(["Early Call", `Enabled - ${money(ec.amount)} per person (PM marked only)`]);
    else if (ec?.enabled) pairs.push(["Early Call", "Enabled"]);

    if (ldu?.enabled && N(ldu?.price, 0) > 0) {
      const helperCount = Array.isArray(ldu.participants) ? ldu.participants.length : 0;
      pairs.push(["Loading & Unloading", `Enabled - ${money(ldu.price)} per helper (helpers: ${helperCount})`]);
    } else if (ldu?.enabled) {
      pairs.push(["Loading & Unloading", "Enabled"]);
    }

    return pairs;
  };

  const payrollMetaUI = useMemo(() => {
    if (!job) return [];
    const keep = new Set(["Date", "Time", "Session Type", "Pay Setup", "Hourly Add-on", "Parking Allowance", "Early Call", "Loading & Unloading"]);
    return buildPayrollMetaPairs(job).filter(([k]) => keep.has(k));
  }, [job]);

  async function exportPayrollCSV() {
    if (!rows.length) {
      alert("No rows to export.");
      return;
    }

    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const metaPairs = buildPayrollMetaPairs(job);

    const lines = [];
    metaPairs.forEach(([k, v]) => lines.push(`${q(k)},${q(v)}`));
    lines.push("");

    // ✅ Requested: remove Allowances + Deduction, add Early Call + Loading & Unloading
    const headers = [
      "No",
      "Name",
      "Email",
      "Phone",
      "Transport",
      "Scan In",
      "Scan Out",
      "Session Pay",
      "Early Call",
      "Loading & Unloading",
      "Gross",
      "Net",
    ];
    lines.push(headers.join(","));

    rows.forEach((r, idx) => {
      const line = [
        idx + 1,
        q(r.name || ""),
        q(r.email || ""),
        q(r.phone || ""),
        q(r.transport || ""),
        q(r.scanIn || ""),
        q(r.scanOut || ""),
        Math.round(N(r._specific, 0)),
        Math.round(N(r._earlyCallAmt, 0)),
        Math.round(N(r._lduAmt, 0)),
        Math.round(N(r.wageGross, 0)),
        Math.round(N(r.wageNet, 0)),
      ].join(",");
      lines.push(line);
    });

    lines.push("");
    lines.push(`Total Employees,${summary.employees}`);
    lines.push(`Total Hours,${summary.hours.toFixed(2)}`);
    lines.push(`Total Net Wages,${Math.round(summary.wages)}`);
    lines.push(`Jobs Included,${summary.jobs}`);

    // ✅ Excel-friendly: add UTF-8 BOM so characters never become â€” etc.
    const csv = "\ufeff" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-${job?.id || "all"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /* ===== UI blocks (payment editors) ===== */
  const HourlySimpleGrid = ({ title }) => (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 900 }}>{title}</div>
      <div style={styles.grid3}>
        <Field label="Junior Rate (RM/hr)">
          <input style={styles.input} value={hrJr} onChange={(e) => setHrJr(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Junior OT (RM/hr)">
          <input style={styles.input} value={hrJrOT} onChange={(e) => setHrJrOT(e.target.value)} inputMode="decimal" />
        </Field>
        <div />
      </div>

      <div style={styles.grid3}>
        <Field label="Senior Rate (RM/hr)">
          <input style={styles.input} value={hrSr} onChange={(e) => setHrSr(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Senior OT (RM/hr)">
          <input style={styles.input} value={hrSrOT} onChange={(e) => setHrSrOT(e.target.value)} inputMode="decimal" />
        </Field>
        <div />
      </div>

      <div style={styles.grid3}>
        <Field label="Lead Host Rate (RM/hr)">
          <input style={styles.input} value={hrLead} onChange={(e) => setHrLead(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Lead OT (RM/hr)">
          <input style={styles.input} value={hrLeadOT} onChange={(e) => setHrLeadOT(e.target.value)} inputMode="decimal" />
        </Field>
        <div />
      </div>
    </div>
  );

  const FlatHourlyBlock = () => (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 900 }}>Backend (flat hourly for everyone)</div>
      <div style={styles.grid2}>
        <Field label="Rate (RM/hr)">
          <input style={styles.input} value={flatRate} onChange={(e) => setFlatRate(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="OT Rate (RM/hr)">
          <input style={styles.input} value={flatOT} onChange={(e) => setFlatOT(e.target.value)} inputMode="decimal" />
        </Field>
      </div>
      <div style={{ fontSize: 12, color: "#6b7280" }}>Everyone is paid the same hourly and OT rate regardless of role.</div>
    </div>
  );

  const PaymentBlock = () => {
    if (sessionMode === "virtual") return <HourlySimpleGrid title="Hourly (Virtual)" />;
    if (physicalType === "hourly_by_role") return <HourlySimpleGrid title="Hourly (by role)" />;
    if (physicalType === "hourly_flat") return <FlatHourlyBlock />;

    const showHalf = physicalType === "half_day";
    const showFull = physicalType === "full_day";
    const show2d1n = physicalType === "2d1n";
    const show3d2n = physicalType === "3d2n";

    const SessionGrid = ({ title, v, setV, w, setW, x, setX, y, setY, z, setZ }) => (
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 900 }}>{title}</div>
        <div style={styles.grid5}>
          <Field label="Junior (RM)">
            <input style={styles.input} value={v} onChange={(e) => setV(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Senior (RM)">
            <input style={styles.input} value={w} onChange={(e) => setW(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Lead Host (RM)">
            <input style={styles.input} value={x} onChange={(e) => setX(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Junior Emcee (RM)">
            <input style={styles.input} value={y} onChange={(e) => setY(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Senior Emcee (RM)">
            <input style={styles.input} value={z} onChange={(e) => setZ(e.target.value)} inputMode="decimal" />
          </Field>
        </div>
      </div>
    );

    return (
      <div style={{ display: "grid", gap: 14 }}>
        {showHalf && (
          <SessionGrid
            title="Half Day (per person)"
            v={pHalfJr}
            setV={setPHalfJr}
            w={pHalfSr}
            setW={setPHalfSr}
            x={pHalfLead}
            setX={setPHalfLead}
            y={pHalfJrEmcee}
            setY={setPHalfJrEmcee}
            z={pHalfSrEmcee}
            setZ={setPHalfSrEmcee}
          />
        )}
        {showFull && (
          <SessionGrid
            title="Full Day (per person)"
            v={pFullJr}
            setV={setPFullJr}
            w={pFullSr}
            setW={setPFullSr}
            x={pFullLead}
            setX={setPFullLead}
            y={pFullJrEmcee}
            setY={setPFullJrEmcee}
            z={pFullSrEmcee}
            setZ={setPFullSrEmcee}
          />
        )}
        {show2d1n && (
          <SessionGrid
            title="2D1N (per person)"
            v={p2d1nJr}
            setV={setP2d1nJr}
            w={p2d1nSr}
            setW={setP2d1nSr}
            x={p2d1nLead}
            setX={setP2d1nLead}
            y={p2d1nJrEmcee}
            setY={setP2d1nJrEmcee}
            z={p2d1nSrEmcee}
            setZ={setP2d1nSrEmcee}
          />
        )}
        {show3d2n && (
          <SessionGrid
            title="3D2N (per person)"
            v={p3d2nJr}
            setV={setP3d2nJr}
            w={p3d2nSr}
            setW={setP3d2nSr}
            x={p3d2nLead}
            setX={setP3d2nLead}
            y={p3d2nJrEmcee}
            setY={setP3d2nJrEmcee}
            z={p3d2nSrEmcee}
            setZ={setP3d2nSrEmcee}
          />
        )}

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input id="hourlyToggle" type="checkbox" checked={hourlyAddon} onChange={(e) => setHourlyAddon(e.target.checked)} />
          <label htmlFor="hourlyToggle" style={{ userSelect: "none", fontWeight: 800 }}>
            Enable hourly add-on (in addition to session price)
          </label>
        </div>

        {hourlyAddon ? (
          <div style={{ border: "1px dashed #e5e7eb", borderRadius: 14, padding: 12, background: "#fafafa" }}>
            <HourlySimpleGrid title="Hourly add-on (Physical)" />
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="container" style={styles.page}>
      {error ? (
        <div style={{ ...styles.panel, borderColor: "#fecaca", background: "#fff1f2", color: "#b91c1c" }}>{String(error)}</div>
      ) : null}

      {/* Tabs */}
      <div style={styles.tabRow}>
        <button style={styles.tab(tab === "defaults")} onClick={() => setTab("defaults")}>
          Global Defaults
        </button>
        <button style={styles.tab(tab === "job")} onClick={() => setTab("job")}>
          Rate & Job Config
        </button>
        <button style={styles.tab(tab === "payroll")} onClick={() => setTab("payroll")}>
          Payroll
        </button>
      </div>

      {/* ---------------- GLOBAL WAGE DEFAULTS ---------------- */}
      {tab === "defaults" && (
        <Panel
          title="Global Wage Defaults"
          subtitle="Used by JobModal as starting values (cleaner view - collapsible sections)."
          right={
            <button className="btn primary" onClick={saveGlobal}>
              Save Defaults
            </button>
          }
        >
          <div style={styles.grid2}>
            <Field label="Default Parking Allowance (RM)">
              <input style={styles.input} inputMode="decimal" value={gParking} onChange={(e) => setGParking(e.target.value)} />
            </Field>

            <div style={{ display: "grid", gap: 10 }}>
              <Field label="Early Call Amount (RM)">
                <input style={styles.input} inputMode="decimal" value={gECAmount} onChange={(e) => setGECAmount(e.target.value)} />
              </Field>
              <Field label="Loading & Unloading (RM / helper)">
                <input style={styles.input} inputMode="decimal" value={gLDUPrice} onChange={(e) => setGLDUPrice(e.target.value)} />
              </Field>
            </div>
          </div>

          <div style={{ height: 12 }} />

          <details style={styles.details} open>
            <summary style={styles.summary}>Hourly (by role)</summary>
            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <div style={styles.grid3}>
                <Field label="Junior Rate (RM/hr)">
                  <input style={styles.input} inputMode="decimal" value={gHrJr} onChange={(e) => setGHrJr(e.target.value)} />
                </Field>
                <Field label="Junior OT (RM/hr)">
                  <input style={styles.input} inputMode="decimal" value={gHrJrOT} onChange={(e) => setGHrJrOT(e.target.value)} />
                </Field>
                <div />
              </div>

              <div style={styles.grid3}>
                <Field label="Senior Rate (RM/hr)">
                  <input style={styles.input} inputMode="decimal" value={gHrSr} onChange={(e) => setGHrSr(e.target.value)} />
                </Field>
                <Field label="Senior OT (RM/hr)">
                  <input style={styles.input} inputMode="decimal" value={gHrSrOT} onChange={(e) => setGHrSrOT(e.target.value)} />
                </Field>
                <div />
              </div>

              <div style={styles.grid3}>
                <Field label="Lead Host Rate (RM/hr)">
                  <input style={styles.input} inputMode="decimal" value={gHrLead} onChange={(e) => setGHrLead(e.target.value)} />
                </Field>
                <Field label="Lead OT (RM/hr)">
                  <input style={styles.input} inputMode="decimal" value={gHrLeadOT} onChange={(e) => setGHrLeadOT(e.target.value)} />
                </Field>
                <div />
              </div>
            </div>
          </details>

          <div style={{ height: 10 }} />

          <details style={styles.details}>
            <summary style={styles.summary}>Backend (flat hourly for all)</summary>
            <div style={{ marginTop: 12 }}>
              <div style={styles.grid2}>
                <Field label="Rate (RM/hr)">
                  <input style={styles.input} inputMode="decimal" value={gFlat} onChange={(e) => setGFlat(e.target.value)} />
                </Field>
                <Field label="OT Rate (RM/hr)">
                  <input style={styles.input} inputMode="decimal" value={gFlatOT} onChange={(e) => setGFlatOT(e.target.value)} />
                </Field>
              </div>
            </div>
          </details>

          <div style={{ height: 10 }} />

          <details style={styles.details}>
            <summary style={styles.summary}>Session (specific payment per person)</summary>
            <div style={{ marginTop: 12, display: "grid", gap: 14 }}>
              <div style={{ fontWeight: 900 }}>Half Day</div>
              <div style={styles.grid5}>
                <Field label="Junior (RM)"><input style={styles.input} inputMode="decimal" value={gHalfJr} onChange={(e) => setGHalfJr(e.target.value)} /></Field>
                <Field label="Senior (RM)"><input style={styles.input} inputMode="decimal" value={gHalfSr} onChange={(e) => setGHalfSr(e.target.value)} /></Field>
                <Field label="Lead Host (RM)"><input style={styles.input} inputMode="decimal" value={gHalfLead} onChange={(e) => setGHalfLead(e.target.value)} /></Field>
                <Field label="Junior Emcee (RM)"><input style={styles.input} inputMode="decimal" value={gHalfJrEmcee} onChange={(e) => setGHalfJrEmcee(e.target.value)} /></Field>
                <Field label="Senior Emcee (RM)"><input style={styles.input} inputMode="decimal" value={gHalfSrEmcee} onChange={(e) => setGHalfSrEmcee(e.target.value)} /></Field>
              </div>

              <div style={{ fontWeight: 900 }}>Full Day</div>
              <div style={styles.grid5}>
                <Field label="Junior (RM)"><input style={styles.input} inputMode="decimal" value={gFullJr} onChange={(e) => setGFullJr(e.target.value)} /></Field>
                <Field label="Senior (RM)"><input style={styles.input} inputMode="decimal" value={gFullSr} onChange={(e) => setGFullSr(e.target.value)} /></Field>
                <Field label="Lead Host (RM)"><input style={styles.input} inputMode="decimal" value={gFullLead} onChange={(e) => setGFullLead(e.target.value)} /></Field>
                <Field label="Junior Emcee (RM)"><input style={styles.input} inputMode="decimal" value={gFullJrEmcee} onChange={(e) => setGFullJrEmcee(e.target.value)} /></Field>
                <Field label="Senior Emcee (RM)"><input style={styles.input} inputMode="decimal" value={gFullSrEmcee} onChange={(e) => setGFullSrEmcee(e.target.value)} /></Field>
              </div>

              <div style={{ fontWeight: 900 }}>2D1N</div>
              <div style={styles.grid5}>
                <Field label="Junior (RM)"><input style={styles.input} inputMode="decimal" value={g2d1nJr} onChange={(e) => setG2d1nJr(e.target.value)} /></Field>
                <Field label="Senior (RM)"><input style={styles.input} inputMode="decimal" value={g2d1nSr} onChange={(e) => setG2d1nSr(e.target.value)} /></Field>
                <Field label="Lead Host (RM)"><input style={styles.input} inputMode="decimal" value={g2d1nLead} onChange={(e) => setG2d1nLead(e.target.value)} /></Field>
                <Field label="Junior Emcee (RM)"><input style={styles.input} inputMode="decimal" value={g2d1nJrEmcee} onChange={(e) => setG2d1nJrEmcee(e.target.value)} /></Field>
                <Field label="Senior Emcee (RM)"><input style={styles.input} inputMode="decimal" value={g2d1nSrEmcee} onChange={(e) => setG2d1nSrEmcee(e.target.value)} /></Field>
              </div>

              <div style={{ fontWeight: 900 }}>3D2N</div>
              <div style={styles.grid5}>
                <Field label="Junior (RM)"><input style={styles.input} inputMode="decimal" value={g3d2nJr} onChange={(e) => setG3d2nJr(e.target.value)} /></Field>
                <Field label="Senior (RM)"><input style={styles.input} inputMode="decimal" value={g3d2nSr} onChange={(e) => setG3d2nSr(e.target.value)} /></Field>
                <Field label="Lead Host (RM)"><input style={styles.input} inputMode="decimal" value={g3d2nLead} onChange={(e) => setG3d2nLead(e.target.value)} /></Field>
                <Field label="Junior Emcee (RM)"><input style={styles.input} inputMode="decimal" value={g3d2nJrEmcee} onChange={(e) => setG3d2nJrEmcee(e.target.value)} /></Field>
                <Field label="Senior Emcee (RM)"><input style={styles.input} inputMode="decimal" value={g3d2nSrEmcee} onChange={(e) => setG3d2nSrEmcee(e.target.value)} /></Field>
              </div>
            </div>
          </details>
        </Panel>
      )}

      {/* ---------------- RATE & JOB CONFIG ---------------- */}
      {tab === "job" && (
        <Panel
          title="Rate & Job Configuration"
          subtitle="Per-job wage settings (same meaning as JobModal), but cleaner layout."
          right={
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {headerPills}
              <button className="btn primary" onClick={saveConfig} disabled={!job}>
                Save Configuration
              </button>
            </div>
          }
        >
          <div style={styles.grid2}>
            <Field label="Select Job">
              <select style={styles.select} value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                <option value="">Select a job…</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
              {job ? (
                <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280", lineHeight: 1.6 }}>
                  <div>
                    <b>Venue:</b> {job.venue || "-"}
                  </div>
                  <div>
                    <b>When:</b> {fmtRange(job.startTime, job.endTime)}
                  </div>
                </div>
              ) : null}
            </Field>

            <div style={{ display: "grid", gap: 12 }}>
              <div style={styles.grid2}>
                <Field label="Session Type">
                  <select style={styles.select} value={sessionMode} onChange={(e) => setSessionMode(e.target.value)}>
                    <option value="virtual">Virtual</option>
                    <option value="physical">Physical</option>
                  </select>
                </Field>

                <Field label="Physical Subtype">
                  <select style={styles.select} value={physicalType} onChange={(e) => setPhysicalType(e.target.value)} disabled={sessionMode !== "physical"}>
                    <option value="half_day">Half Day</option>
                    <option value="full_day">Full Day</option>
                    <option value="2d1n">2D1N</option>
                    <option value="3d2n">3D2N</option>
                    <option value="hourly_by_role">Hourly (by role)</option>
                    <option value="hourly_flat">Backend (flat hourly for all)</option>
                  </select>
                </Field>
              </div>

              <Field
                label="Parking Allowance (RM)"
                hint={job?.transportOptions?.bus ? "Applied only when ATAG Transport is selected." : "ATAG Transport isn't enabled on this job - allowance won’t apply."}
              >
                <input style={styles.input} inputMode="decimal" value={parkingAllowance} onChange={(e) => setParkingAllowance(e.target.value)} />
              </Field>
            </div>
          </div>

          <div style={{ height: 14 }} />

          <div style={{ border: "1px solid #eef2f7", borderRadius: 16, padding: 14 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Wage Settings (matches JobModal)</div>
            <PaymentBlock />
          </div>

          <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
            Note: Payroll tab shows <b>part-timers only</b> (full-timers removed as requested).
          </div>
        </Panel>
      )}

      {/* ---------------- PAYROLL ---------------- */}
      {tab === "payroll" && (
        <Panel
          title="Payroll Summary"
          subtitle="Select a job from the dropdown - you can view EACH person’s uploaded receipt images."
          right={
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className="btn" onClick={exportPayrollCSV} disabled={!rows.length}>
                Export to CSV
              </button>
            </div>
          }
        >
          <div style={styles.grid2}>
            <Field label="Selected Job">
              <select style={styles.select} value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                <option value="">Select a job…</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title}
                  </option>
                ))}
              </select>
              {job ? (
                <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280", lineHeight: 1.6 }}>
                  <div>
                    <b>When:</b> {fmtRange(job.startTime, job.endTime)}
                  </div>
                  <div>
                    <b>Status:</b> {job.status || "-"}
                  </div>
                </div>
              ) : null}
            </Field>

            <Field label="Search">
              <input style={styles.input} placeholder="Search name / email / phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </Field>
          </div>

          {/* Job details at top */}
          {job ? (
            <div style={{ ...styles.details, marginTop: 12 }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Job Details</div>
              <div style={{ display: "grid", gap: 6, fontSize: 12, color: "#111827", lineHeight: 1.6 }}>
                {payrollMetaUI.map(([k, v]) => (
                  <div key={k}>
                    <b>{k}:</b> {v}
                  </div>
                ))}
              </div>
              {/* quick debug line */}
              <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
                Receipt index loaded: <b>{Object.keys(receiptIndex.byUserId || {}).length}</b> users / <b>{Object.keys(receiptIndex.byEmail || {}).length}</b> emails
              </div>
            </div>
          ) : null}

          <div style={{ height: 12 }} />

          <div style={{ overflowX: "auto", border: "1px solid #eef2f7", borderRadius: 16 }}>
            <table width="100%" cellPadding="10" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
              <thead>
                <tr style={{ background: "#f9fafb" }}>
                  <th align="right" style={{ position: "sticky", top: 0, background: "#f9fafb", width: 40 }}>
                    #
                  </th>
                  <th align="left" style={{ position: "sticky", top: 0, background: "#f9fafb" }}>
                    Name
                  </th>
                  <th align="left" style={{ position: "sticky", top: 0, background: "#f9fafb" }}>
                    Email
                  </th>
                  <th align="left" style={{ position: "sticky", top: 0, background: "#f9fafb" }}>
                    Phone
                  </th>
                  <th align="left" style={{ position: "sticky", top: 0, background: "#f9fafb" }}>
                    Transport
                  </th>
                  <th align="left" style={{ position: "sticky", top: 0, background: "#f9fafb" }}>
                    Scan In
                  </th>
                  <th align="left" style={{ position: "sticky", top: 0, background: "#f9fafb" }}>
                    Scan Out
                  </th>
                  <th align="left" style={{ position: "sticky", top: 0, background: "#f9fafb" }}>
                    Parking Receipt
                  </th>
                  <th align="right" style={{ position: "sticky", top: 0, background: "#f9fafb" }}>
                    Session Pay
                  </th>
                  <th align="right" style={{ position: "sticky", top: 0, background: "#f9fafb" }}>
                    Early Call
                  </th>
                  <th align="right" style={{ position: "sticky", top: 0, background: "#f9fafb" }}>
                    Loading/Unloading
                  </th>
                  <th align="right" style={{ position: "sticky", top: 0, background: "#f9fafb" }}>
                    Gross
                  </th>
                  <th align="right" style={{ position: "sticky", top: 0, background: "#f9fafb" }}>
                    Net
                  </th>
                </tr>
              </thead>

              <tbody>
                {rows.map((r, idx) => {
                  const count = Array.isArray(r.receiptUrls) ? r.receiptUrls.length : 0;
                  return (
                    <tr key={r.userId} style={{ borderTop: "1px solid #eef2f7" }}>
                      <td style={{ borderTop: "1px solid #eef2f7" }} align="right">
                        {idx + 1}.
                      </td>
                      <td style={{ borderTop: "1px solid #eef2f7" }}>{r.name}</td>
                      <td style={{ borderTop: "1px solid #eef2f7" }}>{r.email}</td>
                      <td style={{ borderTop: "1px solid #eef2f7" }}>{r.phone}</td>
                      <td style={{ borderTop: "1px solid #eef2f7" }}>{r.transport}</td>
                      <td style={{ borderTop: "1px solid #eef2f7", whiteSpace: "nowrap" }}>{r.scanIn || "-"}</td>
                      <td style={{ borderTop: "1px solid #eef2f7", whiteSpace: "nowrap" }}>{r.scanOut || "-"}</td>

                      {/* ✅ View receipt per person */}
                      <td style={{ borderTop: "1px solid #eef2f7" }}>
                        {count ? (
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <span style={{ ...styles.pill("#ecfdf5", "#065f46"), border: "1px solid #6ee7b7", fontWeight: 900 }}>
                              Uploaded ×{count}
                            </span>

                            {isAdmin ? (
                              <button className="btn" onClick={() => openReceiptModal(`Parking Receipt - ${r.name}`, r.receiptUrls, 0)}>
                                View
                              </button>
                            ) : (
                              <span style={{ fontSize: 12, color: "#6b7280" }}>(admin view only)</span>
                            )}
                          </div>
                        ) : (
                          <span style={{ color: "#6b7280" }}>-</span>
                        )}
                      </td>

                      <td style={{ borderTop: "1px solid #eef2f7" }} align="right">
                        {money(r._specific)}
                      </td>
                      <td style={{ borderTop: "1px solid #eef2f7" }} align="right">
                        {money(r._earlyCallAmt)}
                      </td>
                      <td style={{ borderTop: "1px solid #eef2f7" }} align="right">
                        {money(r._lduAmt)}
                      </td>
                      <td style={{ borderTop: "1px solid #eef2f7" }} align="right">
                        {money(r.wageGross)}
                      </td>
                      <td style={{ borderTop: "1px solid #eef2f7" }} align="right">
                        <span style={{ fontWeight: 900 }}>{money(r.wageNet)}</span>
                      </td>
                    </tr>
                  );
                })}

                {!job ? (
                  <tr>
                    <td colSpan={13} style={{ padding: 14, color: "#6b7280" }}>
                      Select a job to view payroll.
                    </td>
                  </tr>
                ) : !rows.length ? (
                  <tr>
                    <td colSpan={13} style={{ padding: 14, color: "#6b7280" }}>
                      No approved part-timers found (or filtered out by search).
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, color: "#111827" }}>
            <span style={styles.pill("#eef2ff", "#3730a3")}>Employees: {summary.employees}</span>
            <span style={styles.pill("#ecfeff", "#155e75")}>Hours: {summary.hours.toFixed(2)}</span>
            <span style={styles.pill("#f0fdf4", "#166534")}>Total Net: {money(summary.wages)}</span>
            <span style={styles.pill("#f3f4f6", "#111827")}>Jobs: {summary.jobs}</span>
          </div>
        </Panel>
      )}

      {/* ✅ Receipt Image Preview Modal (loads via apiGetBlob) */}
      {receiptModal && receiptModal.urls?.length ? (
        <div
          onClick={closeReceiptModal}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            background: "rgba(0,0,0,.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(900px, 96vw)",
              padding: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <div style={{ fontWeight: 900, display: "flex", gap: 10, alignItems: "center" }}>
                <span>{receiptModal.title || "Parking Receipt"}</span>
                <span style={{ fontSize: 12, color: "#6b7280" }}>
                  {receiptModal.idx + 1} / {receiptModal.urls.length}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={closeReceiptModal}>
                  Close
                </button>
              </div>
            </div>

            <div style={{ marginTop: 10, position: "relative" }}>
              {receiptModal.idx > 0 ? (
                <button
                  className="btn"
                  onClick={goPrevReceipt}
                  title="Previous"
                  style={{
                    position: "absolute",
                    left: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    zIndex: 2,
                    borderRadius: 999,
                    padding: "8px 10px",
                    fontWeight: 900,
                    background: "rgba(255,255,255,0.9)",
                  }}
                >
                  ←
                </button>
              ) : null}

              {receiptModal.idx < receiptModal.urls.length - 1 ? (
                <button
                  className="btn"
                  onClick={goNextReceipt}
                  title="Next"
                  style={{
                    position: "absolute",
                    right: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    zIndex: 2,
                    borderRadius: 999,
                    padding: "8px 10px",
                    fontWeight: 900,
                    background: "rgba(255,255,255,0.9)",
                  }}
                >
                  →
                </button>
              ) : null}

              {receiptImgLoading ? (
                <div style={{ padding: 16, color: "#6b7280", fontWeight: 800 }}>Loading receipt…</div>
              ) : receiptImgErr ? (
                <div style={{ padding: 16, color: "#b91c1c", fontWeight: 800 }}>{receiptImgErr}</div>
              ) : (
                <img
                  src={receiptImgSrc}
                  alt="receipt"
                  style={{
                    width: "100%",
                    maxHeight: "75vh",
                    objectFit: "contain",
                    borderRadius: 12,
                    border: "1px solid #eee",
                    background: "#fff",
                  }}
                />
              )}
            </div>

            <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
              Tip: Use keyboard ← → to switch images, Esc to close.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
