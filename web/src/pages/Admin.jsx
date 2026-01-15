// web/src/pages/Admin.jsx
import React, { useEffect, useMemo, useState } from "react";
import { apiGet, apiPatch } from "../api";

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
    return same ? `${dt(s)} — ${t(e)}` : `${dt(s)} — ${dt(e)}`;
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

/* =========================
   ✅ parking receipt resolver (MULTIPLE)
   ========================= */
function getReceiptUrlsForUser(job, uid, email, appRec, attendanceRec) {
  const urls = [];

  const pushVal = (v) => {
    if (!v) return;

    if (Array.isArray(v)) {
      v.forEach(pushVal);
      return;
    }

    if (typeof v === "string") {
      const s = v.trim();
      if (s) urls.push(s);
      return;
    }

    if (typeof v === "object") {
      const candidates = [
        v.url,
        v.imageUrl,
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

  // 3) from job-level maps (by userId/email)
  const pr =
    job?.parkingReceipts ||
    job?.parkingReceiptByUser ||
    job?.parkingReceiptUrls ||
    null;

  if (pr && typeof pr === "object" && !Array.isArray(pr)) {
    pushVal(pr?.[uid]);
    if (email) pushVal(pr?.[email]);
    pushVal(pr?.byUserId?.[uid]);
    if (email) pushVal(pr?.byEmail?.[email]);
  }

  // 4) from job-level arrays/lists (e.g. [{userId,url,...}])
  const listCandidates = [];
  if (Array.isArray(job?.parkingReceiptsList)) listCandidates.push(...job.parkingReceiptsList);
  if (Array.isArray(job?.parkingReceipts)) listCandidates.push(...job.parkingReceipts);
  if (Array.isArray(job?.receipts)) listCandidates.push(...job.receipts);

  if (listCandidates.length) {
    const matches = listCandidates.filter((x) => {
      if (!x) return false;
      const byUid = x.userId === uid || x.uid === uid || x.id === uid;
      const byEmail = email ? x.email === email : false;
      return byUid || byEmail;
    });

    matches.forEach((m) => {
      pushVal(m);
      pushVal(m?.url);
      pushVal(m?.imageUrl);
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

  // cleanup unique
  const seen = new Set();
  const out = [];
  urls.forEach((u) => {
    const s = String(u || "").trim();
    if (!s) return;
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
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

/* ---------------- UI ---------------- */
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

/* ------------ session helpers ------------ */
const KIND_PROP = {
  half_day: "halfDay",
  full_day: "fullDay",
  "2d1n": "twoD1N",
  "3d2n": "threeD2N",
};
const isSessionKind = (k) => ["half_day", "full_day", "2d1n", "3d2n"].includes(k);

/* ---- defaults ---- */
const DEFAULT_HOURLY = { jr: "15", sr: "20", lead: "25" };
const DEFAULT_HALF = { jr: "60", sr: "80", lead: "100", jrEmcee: "44", srEmcee: "88" };
const DEFAULT_FULL = { jr: "120", sr: "160", lead: "200", jrEmcee: "88", srEmcee: "168" };
const DEFAULT_2D1N = { jr: "300", sr: "400", lead: "500", jrEmcee: "0", srEmcee: "0" };
const DEFAULT_3D2N = { jr: "450", sr: "600", lead: "750", jrEmcee: "0", srEmcee: "0" };

export default function Admin({ user }) {
  const [tab, setTab] = useState("payroll"); // defaults | job | payroll (you can change default tab)

  const [jobs, setJobs] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");

  const isAdmin = user?.role === "admin";

  // ✅ Receipt modal supports multiple urls + arrows
  const [receiptModal, setReceiptModal] = useState(null); // { title, urls, idx }

  const openReceiptModal = (title, urls, startIdx = 0) => {
    const safe = Array.isArray(urls) ? urls.filter(Boolean) : [];
    if (!safe.length) return;
    const idx = Math.max(0, Math.min(startIdx, safe.length - 1));
    setReceiptModal({ title: title || "Parking Receipt", urls: safe, idx });
  };
  const closeReceiptModal = () => setReceiptModal(null);

  const goPrevReceipt = () => {
    setReceiptModal((m) => {
      if (!m || !m.urls?.length) return m;
      return { ...m, idx: Math.max(0, (m.idx || 0) - 1) };
    });
  };
  const goNextReceipt = () => {
    setReceiptModal((m) => {
      if (!m || !m.urls?.length) return m;
      return { ...m, idx: Math.min(m.urls.length - 1, (m.idx || 0) + 1) };
    });
  };

  // Keyboard support: Esc closes, arrows navigate
  useEffect(() => {
    if (!receiptModal) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") closeReceiptModal();
      if (e.key === "ArrowLeft") goPrevReceipt();
      if (e.key === "ArrowRight") goNextReceipt();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [receiptModal]);

  // Central user map (from /admin/users)
  const [userMap, setUserMap] = useState({});

  /* ---------- local job/pay states (minimal for payroll) ---------- */
  const [deductions, setDeductions] = useState({});
  const [search, setSearch] = useState("");

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ employees: 0, hours: 0, wages: 0, jobs: 0 });

  const setDeduction = (uid, val) => {
    setDeductions((prev) => ({ ...prev, [uid]: Math.max(0, N(val, 0)) }));
  };

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
      .catch((err) => console.warn("Failed to load user map:", err));
  }, [user]);

  /* ===== Load selected job details ===== */
  useEffect(() => {
    if (!selectedId) {
      setJob(null);
      setRows([]);
      setSummary({ employees: 0, hours: 0, wages: 0, jobs: 0 });
      return;
    }
    (async () => {
      try {
        const j = await apiGet(`/jobs/${selectedId}`);
        setJob(j);
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [selectedId]);

  if (!user || (user.role !== "admin" && user.role !== "pm")) {
    return (
      <div className="container" style={styles.page}>
        <div style={styles.panel}>Admin/PM only.</div>
      </div>
    );
  }

  /* ===== Payroll meta (UI + CSV header block) ===== */
  const kindLabel = (kind) => {
    if (kind === "virtual") return "Virtual (Hourly)";
    if (kind === "hourly_by_role") return "Physical — Hourly (by role)";
    if (kind === "hourly_flat") return "Physical — Flat hourly";
    if (kind === "half_day") return "Physical — Half Day";
    if (kind === "full_day") return "Physical — Full Day";
    if (kind === "2d1n") return "Physical — 2D1N";
    if (kind === "3d2n") return "Physical — 3D2N";
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
      paySetup = ["junior", "senior", "lead", "junior_emcee", "senior_emcee"]
        .map((k) => `${tierLabel[k]} ${money(getSpecific(k))}`)
        .join(" | ");

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
      ["When", fmtRange(j.startTime, j.endTime)],
      ["Status", j.status || "-"],
      ["Session Type", kindLabel(kind)],
      ["Pay Setup", paySetup],
    ];

    if (hasHourlyAddon && hourlyAddonLine) pairs.push(["Hourly Add-on", hourlyAddonLine]);

    if (N(parkingAmt, 0) > 0) {
      pairs.push(["Parking Allowance", `${money(parkingAmt)} (applies only when ATAG Transport selected)`]);
    }

    if (ec?.enabled && N(ec?.amount, 0) > 0) {
      pairs.push(["Early Call", `Enabled — ${money(ec.amount)} per person (PM marked only)`]);
    } else if (ec?.enabled) {
      pairs.push(["Early Call", "Enabled"]);
    }

    if (ldu?.enabled && N(ldu?.price, 0) > 0) {
      const helperCount = Array.isArray(ldu.participants) ? ldu.participants.length : 0;
      pairs.push(["Loading & Unloading", `Enabled — ${money(ldu.price)} per helper (helpers: ${helperCount})`]);
    } else if (ldu?.enabled) {
      pairs.push(["Loading & Unloading", "Enabled"]);
    }

    return pairs;
  };

  const payrollMetaUI = useMemo(() => {
    if (!job) return [];
    const keep = new Set([
      "Session Type",
      "Pay Setup",
      "Hourly Add-on",
      "Parking Allowance",
      "Early Call",
      "Loading & Unloading",
    ]);
    return buildPayrollMetaPairs(job).filter(([k]) => keep.has(k));
  }, [job]);

  /* ===== Wage Calculation ===== */
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

    // Allowances config
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
      if (v === "junior_emcee" || v === "jr_emcee" || v.includes("junior emcee") || v.includes("junior mc"))
        return "junior_emcee";
      if (v === "senior_emcee" || v === "sr_emcee" || v.includes("senior emcee") || v.includes("senior mc"))
        return "senior_emcee";
      if (v.includes("junior") && v.includes("marshal")) return "junior";
      if (v.includes("senior") && v.includes("marshal")) return "senior";
      return null;
    };

    const tierKeyForUser = (uid, appRec) => {
      const jobRoles = job.roleByUser || job.tierByUser || {};
      const raw =
        (appRec && (appRec.tier || appRec.role || appRec.level || appRec.position)) || jobRoles[uid];
      const mapped = mapRoleToTierKey(raw) || raw;
      if (["junior", "senior", "lead", "junior_emcee", "senior_emcee"].includes(mapped)) return mapped;
      return "junior";
    };

    const pushRowForPerson = (uid, appRec) => {
      const rec = attendance?.[uid] || (appRec?.email ? attendance?.[appRec.email] : null) || {};

      const inTime = rec.in ? new Date(rec.in) : null;
      const outTime = rec.out ? new Date(rec.out) : null;

      const scanInStr = fmtDateTime(inTime);
      const scanOutStr = fmtDateTime(outTime);

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
        const specific =
          rr.specificPayment != null ? N(rr.specificPayment, 0) : priceProp ? N(rr[priceProp], 0) : 0;
        specificPay = specific;
      }

      let allowances = 0;
      const transport = byUserTransport.get(uid) || "Own Transport";
      if (transport === "ATAG Transport" || transport === "ATAG Bus") allowances += N(parkingAmt, 0);

      // Early Call (PM marked only)
      const ecAmt = N(ec.amount, 0);
      const earlyFromJob = (job && (job.earlyCallParticipants || job.earlyCallConfirmedUsers || job.earlyCallUsers)) || [];
      const earlyListRaw = (ec && (ec.participants || ec.users || ec.userIds || ec.confirmedUsers)) || [];

      const earlyLists = []
        .concat(Array.isArray(earlyFromJob) ? earlyFromJob : [earlyFromJob])
        .concat(Array.isArray(earlyListRaw) ? earlyListRaw : [earlyListRaw]);

      const earlyCheckedByList = earlyLists.some((p) => {
        const key =
          typeof p === "string" || typeof p === "number"
            ? String(p)
            : p?.userId || p?.id || p?.email || null;
        if (!key) return false;
        return key === uid || (appRec?.email && key === appRec.email);
      });

      const earlyChecked =
        !!rec?.earlyCall ||
        !!appRec?.earlyCallConfirmed ||
        !!appRec?.addOns?.earlyCall ||
        earlyCheckedByList;

      const gotEarlyCall = !!(ec.enabled && ecAmt > 0 && earlyChecked);
      if (gotEarlyCall) allowances += ecAmt;

      const gotLDU = !!(lduOn && lduHelpers.has(uid));
      if (gotLDU) allowances += lduPriceNum;

      const gross = basePay + otPay + specificPay + allowances;
      const deduction = Math.max(0, N(deductions[uid], 0));
      const net = Math.max(0, gross - deduction);

      const appUser = (appRec && appRec.user) || {};
      const coreUser = userMap[uid] || {};

      const combinedAppName =
        appRec && (appRec.firstName || appRec.lastName)
          ? `${appRec.firstName || ""} ${appRec.lastName || ""}`.trim()
          : "";

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

      const phone =
        pick(
          coreUser.phone,
          coreUser.phoneNumber,
          appUser.phone,
          appUser.phoneNumber,
          appUser.contact,
          appRec?.phone,
          appRec?.phoneNumber,
          appRec?.contact
        ) || "-";

      const emailFinal = pick(coreUser.email, appUser.email, appRec?.email, uid) || uid;

      const receiptUrls = getReceiptUrlsForUser(job, uid, appRec?.email || emailFinal, appRec, rec);

      outRows.push({
        userId: uid,
        name: name || "-",
        email: emailFinal,
        phone,
        transport,
        scanIn: scanInStr,
        scanOut: scanOutStr,
        receiptUrls,
        receiptUrl: receiptUrls[0] || "",
        hours: Number(workedHours.toFixed(2)),
        wageGross: gross,
        deduction,
        wageNet: net,
        _specific: specificPay,
        _allowances: allowances,
      });
    };

    // ✅ Only approved users WITH attendance in/out
    (job.approved || []).forEach((uid) => {
      if (!approved.has(uid)) return;

      const appRec = apps.find((a) => a.userId === uid) || {};
      const rec = attendance?.[uid] || (appRec?.email ? attendance?.[appRec.email] : null) || {};

      if (!rec?.in && !rec?.out) return; // keep your rule
      pushRowForPerson(uid, appRec);
    });

    const filtered = outRows
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
      .filter((r) => {
        if (!search.trim()) return true;
        const q = search.trim().toLowerCase();
        return (
          (r.name || "").toLowerCase().includes(q) ||
          (r.email || "").toLowerCase().includes(q) ||
          (r.phone || "").toLowerCase().includes(q)
        );
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
  }, [job, deductions, userMap, search]);

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

    const headers = [
      "No",
      "Name",
      "Email",
      "Phone",
      "Transport",
      "Scan In",
      "Scan Out",
      "Parking Receipt(s)",
      "Session Pay",
      "Allowances",
      "Gross",
      "Deduction",
      "Net",
    ];
    lines.push(headers.join(","));

    rows.forEach((r, idx) => {
      lines.push(
        [
          idx + 1,
          q(r.name || ""),
          q(r.email || ""),
          q(r.phone || ""),
          q(r.transport || ""),
          q(r.scanIn || ""),
          q(r.scanOut || ""),
          q(receiptCsvValueList(r.receiptUrls)),
          Math.round(N(r._specific, 0)),
          Math.round(N(r._allowances, 0)),
          Math.round(N(r.wageGross, 0)),
          Math.round(N(r.deduction, 0)),
          Math.round(N(r.wageNet, 0)),
        ].join(",")
      );
    });

    lines.push("");
    lines.push(`Total Employees,${summary.employees}`);
    lines.push(`Total Hours,${summary.hours.toFixed(2)}`);
    lines.push(`Total Net Wages,${Math.round(summary.wages)}`);
    lines.push(`Jobs Included,${summary.jobs}`);

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-${job?.id || "all"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="container" style={styles.page}>
      {error ? (
        <div style={{ ...styles.panel, borderColor: "#fecaca", background: "#fff1f2", color: "#b91c1c" }}>
          {String(error)}
        </div>
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

      {/* ✅ For this request, focus payroll experience */}
      {tab !== "payroll" ? (
        <Panel title="Note" subtitle="This file version is focused on Payroll tab preview per person.">
          <div style={{ fontSize: 13, color: "#6b7280" }}>
            Switch to <b>Payroll</b> tab to view receipts per person after selecting a job.
          </div>
        </Panel>
      ) : null}

      {/* ---------------- PAYROLL ---------------- */}
      {tab === "payroll" && (
        <Panel
          title="Payroll Summary"
          subtitle="Select a job from the dropdown — you can view EACH person’s uploaded receipt images."
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
              <input
                style={styles.input}
                placeholder="Search name / email / phone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
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
                    Allowances
                  </th>
                  <th align="right" style={{ position: "sticky", top: 0, background: "#f9fafb" }}>
                    Gross
                  </th>
                  <th align="right" style={{ position: "sticky", top: 0, background: "#f9fafb" }}>
                    Deduct
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

                      {/* ✅ THIS is the main part you asked: view per-person uploaded pics after selecting job */}
                      <td style={{ borderTop: "1px solid #eef2f7" }}>
                        {count ? (
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <span
                              style={{
                                ...styles.pill("#ecfdf5", "#065f46"),
                                border: "1px solid #6ee7b7",
                                fontWeight: 900,
                              }}
                            >
                              Uploaded ×{count}
                            </span>

                            {/* You said: view by every person -> allow PM/Admin both.
                                If you only want admin, change (isAdmin || user.role==="pm") to isAdmin only */}
                            <button
                              className="btn"
                              onClick={() => openReceiptModal(`Parking Receipt — ${r.name}`, r.receiptUrls, 0)}
                            >
                              View
                            </button>
                          </div>
                        ) : (
                          <span style={{ color: "#6b7280" }}>-</span>
                        )}
                      </td>

                      <td style={{ borderTop: "1px solid #eef2f7" }} align="right">
                        {money(r._specific)}
                      </td>
                      <td style={{ borderTop: "1px solid #eef2f7" }} align="right">
                        {money(r._allowances)}
                      </td>
                      <td style={{ borderTop: "1px solid #eef2f7" }} align="right">
                        {money(r.wageGross)}
                      </td>

                      <td style={{ borderTop: "1px solid #eef2f7" }} align="right">
                        <input
                          style={{ ...styles.input, width: 90, textAlign: "right", padding: "8px 10px" }}
                          inputMode="decimal"
                          value={String(deductions[r.userId] ?? 0)}
                          onChange={(e) => setDeduction(r.userId, e.target.value)}
                        />
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

      {/* ✅ Receipt Image Preview Modal with left/right arrows */}
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
                <button
                  className="btn"
                  onClick={() => {
                    try {
                      const url = receiptModal.urls[receiptModal.idx];
                      window.open(url, "_blank", "noopener,noreferrer");
                    } catch {}
                  }}
                >
                  Open
                </button>
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

              <img
                src={receiptModal.urls[receiptModal.idx]}
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
            </div>

            <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
              Tip: Use keyboard ← → to switch images, Esc to close. If images break, your backend might require signed/auth URLs
              (or a dedicated “GET /receipt/:id” endpoint that returns the file).
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
