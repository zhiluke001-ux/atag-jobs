// web/src/pages/Admin.jsx
import React, { useEffect, useMemo, useState, useRef } from "react";
import { apiGet, apiPost, apiGetBlob, apiPatch } from "../api";

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

/* ---- tiny UI helpers ---- */
const Section = ({ title, children }) => (
  <div className="card" style={{ padding: 14, borderRadius: 12 }}>
    <div style={{ fontWeight: 800, marginBottom: 8 }}>{title}</div>
    {children}
  </div>
);
const Field = ({ label, children, hint }) => (
  <div className="card" style={{ padding: 12 }}>
    <div
      style={{
        fontSize: 12,
        fontWeight: 600,
        marginBottom: 6,
        color: "#374151",
      }}
    >
      {label}
    </div>
    {children}
    {hint ? (
      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>{hint}</div>
    ) : null}
  </div>
);
const Pill = ({ text, color = "#111827", bg = "#E5E7EB" }) => (
  <span
    style={{
      padding: "3px 8px",
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 700,
      background: bg,
      color,
    }}
  >
    {text}
  </span>
);

/* ---------------- Global Defaults (local) ---------------- */
const GLOBAL_KEY = "atag.globalWageDefaults.v2";
const defaultGlobal = {
  parkingAllowance: 0,
  earlyCall: { enabled: false, amount: 20, thresholdHours: 3 },
  loadingUnload: { enabled: false, price: 30, quota: 0 },

  // you can extend hourly_by_role later to include emcee if needed
  hourly_by_role: {
    junior: { base: 20, otRatePerHour: 25 },
    senior: { base: 25, otRatePerHour: 30 },
    lead: { base: 30, otRatePerHour: 40 },
  },
  hourly_flat: { base: 20, otRatePerHour: 25 },

  // session per-person defaults
  // added junior emcee & senior emcee
  session: {
    half_day: {
      jr: 60,
      sr: 80,
      lead: 100,
      jrEmcee: 44,
      srEmcee: 88,
    },
    full_day: {
      jr: 120,
      sr: 160,
      lead: 200,
      jrEmcee: 88,
      srEmcee: 168,
    },
    twoD1N: {
      jr: 300,
      sr: 400,
      lead: 500,
      jrEmcee: 0,
      srEmcee: 0,
    },
    threeD2N: {
      jr: 450,
      sr: 600,
      lead: 750,
      jrEmcee: 0,
      srEmcee: 0,
    },
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
const DEFAULT_HALF = {
  jr: "60",
  sr: "80",
  lead: "100",
  jrEmcee: "44",
  srEmcee: "88",
};
const DEFAULT_FULL = {
  jr: "120",
  sr: "160",
  lead: "200",
  jrEmcee: "88",
  srEmcee: "168",
};
const DEFAULT_2D1N = {
  jr: "300",
  sr: "400",
  lead: "500",
  jrEmcee: "0",
  srEmcee: "0",
};
const DEFAULT_3D2N = {
  jr: "450",
  sr: "600",
  lead: "750",
  jrEmcee: "0",
  srEmcee: "0",
};

export default function Admin({ navigate, user }) {
  const [jobs, setJobs] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");

  /* ---------- GLOBAL DEFAULTS STATE ---------- */
  const [globalCfg, setGlobalCfg] = useState(loadGlobalDefaults());

  // top-level simple defaults
  const [gParking, setGParking] = useState(String(globalCfg.parkingAllowance ?? 0));
  // Early Call & LDU: only amount needed on this page
  const [gECAmount, setGECAmount] = useState(
    String(globalCfg.earlyCall?.amount ?? 20)
  );
  const [gLDUPrice, setGLDUPrice] = useState(
    String(globalCfg.loadingUnload?.price ?? 30)
  );

  // global hourly (by role)
  const [gHrJr, setGHrJr] = useState(String(globalCfg.hourly_by_role.junior.base));
  const [gHrJrOT, setGHrJrOT] = useState(
    String(globalCfg.hourly_by_role.junior.otRatePerHour)
  );
  const [gHrSr, setGHrSr] = useState(String(globalCfg.hourly_by_role.senior.base));
  const [gHrSrOT, setGHrSrOT] = useState(
    String(globalCfg.hourly_by_role.senior.otRatePerHour)
  );
  const [gHrLead, setGHrLead] = useState(String(globalCfg.hourly_by_role.lead.base));
  const [gHrLeadOT, setGHrLeadOT] = useState(
    String(globalCfg.hourly_by_role.lead.otRatePerHour)
  );

  // global hourly flat
  const [gFlat, setGFlat] = useState(String(globalCfg.hourly_flat.base));
  const [gFlatOT, setGFlatOT] = useState(
    String(globalCfg.hourly_flat.otRatePerHour)
  );

  // global session prices (host + emcee)
  const [gHalfJr, setGHalfJr] = useState(
    String(globalCfg.session.half_day.jr ?? DEFAULT_HALF.jr)
  );
  const [gHalfSr, setGHalfSr] = useState(
    String(globalCfg.session.half_day.sr ?? DEFAULT_HALF.sr)
  );
  const [gHalfLead, setGHalfLead] = useState(
    String(globalCfg.session.half_day.lead ?? DEFAULT_HALF.lead)
  );
  const [gHalfJrEmcee, setGHalfJrEmcee] = useState(
    String(globalCfg.session.half_day.jrEmcee ?? DEFAULT_HALF.jrEmcee)
  );
  const [gHalfSrEmcee, setGHalfSrEmcee] = useState(
    String(globalCfg.session.half_day.srEmcee ?? DEFAULT_HALF.srEmcee)
  );

  const [gFullJr, setGFullJr] = useState(
    String(globalCfg.session.full_day.jr ?? DEFAULT_FULL.jr)
  );
  const [gFullSr, setGFullSr] = useState(
    String(globalCfg.session.full_day.sr ?? DEFAULT_FULL.sr)
  );
  const [gFullLead, setGFullLead] = useState(
    String(globalCfg.session.full_day.lead ?? DEFAULT_FULL.lead)
  );
  const [gFullJrEmcee, setGFullJrEmcee] = useState(
    String(globalCfg.session.full_day.jrEmcee ?? DEFAULT_FULL.jrEmcee)
  );
  const [gFullSrEmcee, setGFullSrEmcee] = useState(
    String(globalCfg.session.full_day.srEmcee ?? DEFAULT_FULL.srEmcee)
  );

  const [g2d1nJr, setG2d1nJr] = useState(
    String(globalCfg.session.twoD1N.jr ?? DEFAULT_2D1N.jr)
  );
  const [g2d1nSr, setG2d1nSr] = useState(
    String(globalCfg.session.twoD1N.sr ?? DEFAULT_2D1N.sr)
  );
  const [g2d1nLead, setG2d1nLead] = useState(
    String(globalCfg.session.twoD1N.lead ?? DEFAULT_2D1N.lead)
  );
  const [g2d1nJrEmcee, setG2d1nJrEmcee] = useState(
    String(globalCfg.session.twoD1N.jrEmcee ?? DEFAULT_2D1N.jrEmcee)
  );
  const [g2d1nSrEmcee, setG2d1nSrEmcee] = useState(
    String(globalCfg.session.twoD1N.srEmcee ?? DEFAULT_2D1N.srEmcee)
  );

  const [g3d2nJr, setG3d2nJr] = useState(
    String(globalCfg.session.threeD2N.jr ?? DEFAULT_3D2N.jr)
  );
  const [g3d2nSr, setG3d2nSr] = useState(
    String(globalCfg.session.threeD2N.sr ?? DEFAULT_3D2N.sr)
  );
  const [g3d2nLead, setG3d2nLead] = useState(
    String(globalCfg.session.threeD2N.lead ?? DEFAULT_3D2N.lead)
  );
  const [g3d2nJrEmcee, setG3d2nJrEmcee] = useState(
    String(globalCfg.session.threeD2N.jrEmcee ?? DEFAULT_3D2N.jrEmcee)
  );
  const [g3d2nSrEmcee, setG3d2nSrEmcee] = useState(
    String(globalCfg.session.threeD2N.srEmcee ?? DEFAULT_3D2N.srEmcee)
  );

  function saveGlobal() {
    const ecPrev = globalCfg.earlyCall || {};
    const lduPrev = globalCfg.loadingUnload || {};

    const out = {
      parkingAllowance: N(gParking, 0),

      // Keep enabled / threshold / quota internally for compatibility,
      // but on this page we only edit the amount / price.
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

  /* ===== Infer helpers (like JobModal) ===== */
  function inferModeFromJob(j) {
    const kind = j?.rate?.sessionKind;
    if (kind === "virtual") return "virtual";
    if (
      ["half_day", "full_day", "2d1n", "3d2n", "hourly_by_role", "hourly_flat"].includes(
        kind
      )
    )
      return "physical";
    return j?.session?.mode || j?.sessionMode || j?.mode || "virtual";
  }
  function inferPhysTypeFromJob(j) {
    const kind = j?.rate?.sessionKind;
    if (
      ["half_day", "full_day", "2d1n", "3d2n", "hourly_by_role", "hourly_flat"].includes(
        kind
      )
    )
      return kind;
    const legacy =
      j?.session?.physicalType || j?.physicalType || j?.physicalSubtype;
    return ["half_day", "full_day", "2d1n", "3d2n", "hourly_by_role", "hourly_flat"].includes(
      legacy
    )
      ? legacy
      : "half_day";
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

        // Session/type states
        const mode = inferModeFromJob(j);
        const phys = inferPhysTypeFromJob(j);
        setSessionMode(mode);
        setPhysicalType(phys);

        const rate = j.rate || {};
        const tr = rate.tierRates || {};
        const flat = rate.flatHourly || {};
        const gl = loadGlobalDefaults();

        // parking (legacy fields)
        const pa =
          (Number.isFinite(rate.parkingAllowance)
            ? rate.parkingAllowance
            : undefined) ??
          (Number.isFinite(rate.transportAllowance)
            ? rate.transportAllowance
            : undefined) ??
          (Number.isFinite(rate.transportBus) ? rate.transportBus : 0);
        setParkingAllowance(String(pa ?? 0));

        // Hourly addon (session variants)
        const anyPlusHourly = ["junior", "senior", "lead"].some(
          (rk) => tr[rk]?.payMode === "specific_plus_hourly"
        );
        setHourlyAddon(!!anyPlusHourly);

        // Hourly by role / virtual
        setHrJr(
          String(
            tr.junior?.base ??
              gl.hourly_by_role?.junior?.base ??
              DEFAULT_HOURLY.jr
          )
        );
        setHrSr(
          String(
            tr.senior?.base ??
              gl.hourly_by_role?.senior?.base ??
              DEFAULT_HOURLY.sr
          )
        );
        setHrLead(
          String(
            tr.lead?.base ??
              gl.hourly_by_role?.lead?.base ??
              DEFAULT_HOURLY.lead
          )
        );
        setHrJrOT(
          String(
            tr.junior?.otRatePerHour ??
              gl.hourly_by_role?.junior?.otRatePerHour ??
              "0"
          )
        );
        setHrSrOT(
          String(
            tr.senior?.otRatePerHour ??
              gl.hourly_by_role?.senior?.otRatePerHour ??
              "0"
          )
        );
        setHrLeadOT(
          String(
            tr.lead?.otRatePerHour ??
              gl.hourly_by_role?.lead?.otRatePerHour ??
              "0"
          )
        );

        // Flat hourly
        setFlatRate(
          String(flat.base ?? gl.hourly_flat?.base ?? DEFAULT_HOURLY.jr)
        );
        setFlatOT(
          String(flat.otRatePerHour ?? gl.hourly_flat?.otRatePerHour ?? "0")
        );

        // Session prices (host + emcee)
        setPHalfJr(
          String(
            tr.junior?.halfDay ??
              gl.session?.half_day?.jr ??
              DEFAULT_HALF.jr
          )
        );
        setPHalfSr(
          String(
            tr.senior?.halfDay ??
              gl.session?.half_day?.sr ??
              DEFAULT_HALF.sr
          )
        );
        setPHalfLead(
          String(
            tr.lead?.halfDay ??
              gl.session?.half_day?.lead ??
              DEFAULT_HALF.lead
          )
        );
        setPHalfJrEmcee(
          String(
            tr.junior_emcee?.halfDay ??
              gl.session?.half_day?.jrEmcee ??
              DEFAULT_HALF.jrEmcee
          )
        );
        setPHalfSrEmcee(
          String(
            tr.senior_emcee?.halfDay ??
              gl.session?.half_day?.srEmcee ??
              DEFAULT_HALF.srEmcee
          )
        );

        setPFullJr(
          String(
            tr.junior?.fullDay ??
              gl.session?.full_day?.jr ??
              DEFAULT_FULL.jr
          )
        );
        setPFullSr(
          String(
            tr.senior?.fullDay ??
              gl.session?.full_day?.sr ??
              DEFAULT_FULL.sr
          )
        );
        setPFullLead(
          String(
            tr.lead?.fullDay ??
              gl.session?.full_day?.lead ??
              DEFAULT_FULL.lead
          )
        );
        setPFullJrEmcee(
          String(
            tr.junior_emcee?.fullDay ??
              gl.session?.full_day?.jrEmcee ??
              DEFAULT_FULL.jrEmcee
          )
        );
        setPFullSrEmcee(
          String(
            tr.senior_emcee?.fullDay ??
              gl.session?.full_day?.srEmcee ??
              DEFAULT_FULL.srEmcee
          )
        );

        setP2d1nJr(
          String(
            tr.junior?.twoD1N ??
              gl.session?.twoD1N?.jr ??
              DEFAULT_2D1N.jr
          )
        );
        setP2d1nSr(
          String(
            tr.senior?.twoD1N ??
              gl.session?.twoD1N?.sr ??
              DEFAULT_2D1N.sr
          )
        );
        setP2d1nLead(
          String(
            tr.lead?.twoD1N ??
              gl.session?.twoD1N?.lead ??
              DEFAULT_2D1N.lead
          )
        );
        setP2d1nJrEmcee(
          String(
            tr.junior_emcee?.twoD1N ??
              gl.session?.twoD1N?.jrEmcee ??
              DEFAULT_2D1N.jrEmcee
          )
        );
        setP2d1nSrEmcee(
          String(
            tr.senior_emcee?.twoD1N ??
              gl.session?.twoD1N?.srEmcee ??
              DEFAULT_2D1N.srEmcee
          )
        );

        setP3d2nJr(
          String(
            tr.junior?.threeD2N ??
              gl.session?.threeD2N?.jr ??
              DEFAULT_3D2N.jr
          )
        );
        setP3d2nSr(
          String(
            tr.senior?.threeD2N ??
              gl.session?.threeD2N?.sr ??
              DEFAULT_3D2N.sr
          )
        );
        setP3d2nLead(
          String(
            tr.lead?.threeD2N ??
              gl.session?.threeD2N?.lead ??
              DEFAULT_3D2N.lead
          )
        );
        setP3d2nJrEmcee(
          String(
            tr.junior_emcee?.threeD2N ??
              gl.session?.threeD2N?.jrEmcee ??
              DEFAULT_3D2N.jrEmcee
          )
        );
        setP3d2nSrEmcee(
          String(
            tr.senior_emcee?.threeD2N ??
              gl.session?.threeD2N?.srEmcee ??
              DEFAULT_3D2N.srEmcee
          )
        );
      } catch (e) {
        setError(String(e));
      }
    })();
  }, [selectedId]);

  const headerPills = useMemo(() => {
    if (!job) return null;
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Pill text={job.status || "upcoming"} bg="#E5E7EB" color="#111827" />
      </div>
    );
  }, [job]);

  if (!user || (user.role !== "admin" && user.role !== "pm")) {
    return (
      <div className="container">
        <div className="card">Admin/PM only.</div>
      </div>
    );
  }

  /* --------- build tierRates payload (mirror JobModal) --------- */
  function buildTierRates(kind) {
    if (kind === "virtual" || kind === "hourly_by_role") {
      return {
        junior: {
          payMode: "hourly",
          base: N(hrJr, 15),
          otRatePerHour: N(hrJrOT, 0),
        },
        senior: {
          payMode: "hourly",
          base: N(hrSr, 20),
          otRatePerHour: N(hrSrOT, 0),
        },
        lead: {
          payMode: "hourly",
          base: N(hrLead, 25),
          otRatePerHour: N(hrLeadOT, 0),
        },
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
      // 3d2n
      if (tier === "jr") return N(p3d2nJr);
      if (tier === "sr") return N(p3d2nSr);
      if (tier === "lead") return N(p3d2nLead);
      if (tier === "jrEmcee") return N(p3d2nJrEmcee);
      if (tier === "srEmcee") return N(p3d2nSrEmcee);
      return 0;
    };
    const mode = hourlyAddon ? "specific_plus_hourly" : "specific";
    const ifHourly = (base, ot) =>
      hourlyAddon ? { base, otRatePerHour: ot } : {};
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
      // NEW: junior & senior emcee
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

    // Compose session kind
    const kind = sessionMode === "virtual" ? "virtual" : physicalType;
    const tierRates = buildTierRates(kind);

    // Compose PATCH payload mirroring JobModal
    const payload = {
      session: {
        mode: sessionMode,
        physicalType: sessionMode === "physical" ? physicalType : null,
        hourlyEnabled: isSessionKind(physicalType) ? !!hourlyAddon : false,
      },

      // mirrors (legacy)
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
          ? {
              flatHourly: {
                base: N(flatRate, 15),
                otRatePerHour: N(flatOT, 0),
              },
            }
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

  /* ===== Wage Calculation (reads new schema) ===== */
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({
    employees: 0,
    hours: 0,
    wages: 0,
    jobs: 0,
  });

  // NEW: per-person deductions (RM)
  const [deductions, setDeductions] = useState({}); // { [userId]: number }
  const setDeduction = (uid, val) => {
    setDeductions((prev) => ({ ...prev, [uid]: Math.max(0, N(val, 0)) }));
  };

  function calcWages() {
    if (!job) {
      setRows([]);
      setSummary({ employees: 0, hours: 0, wages: 0, jobs: 0 });
      return;
    }

    // helper to pick first non-empty value
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
    // Full timers can live on any of these arrays; adjust to your actual backend:
    const fullTimers = job.fullTimers || job.staff || job.fulltimeStaff || [];

    const outRows = [];

    const byUserTransport = new Map();
    apps.forEach((a) => {
      if (!a) return;
      const uid = a.userId;
      if (!uid) return;
      const t =
        a.transport === "ATAG Bus"
          ? "ATAG Transport"
          : a.transport || "Own Transport";
      byUserTransport.set(uid, t);
    });

    const getStaffId = (s) =>
      (s && (s.userId || s.id || s.email || s.phone || s.name)) || "";

    const fullTimerById = new Map();
    fullTimers.forEach((s) => {
      const id = getStaffId(s);
      if (!id) return;
      fullTimerById.set(id, s);
      if (s.transport) {
        const t =
          s.transport === "ATAG Bus"
            ? "ATAG Transport"
            : s.transport || "Own Transport";
        byUserTransport.set(id, t);
      }
    });

    const scheduledStart = new Date(job.startTime);
    const scheduledEnd = new Date(job.endTime);
    const scheduledHours = Math.max(
      0,
      (scheduledEnd - scheduledStart) / HOUR_MS
    );

    // Allowances
    const ec = job.earlyCall || {};
    const ldu = job.loadingUnload || {};
    const lduOn = !!ldu.enabled;
    const lduPriceNum = N(ldu.price, 0);
    const lduHelpers = new Set(ldu.participants || []);
    const parkingAmt =
      (Number.isFinite(rate.parkingAllowance)
        ? rate.parkingAllowance
        : undefined) ??
      (Number.isFinite(rate.transportAllowance)
        ? rate.transportAllowance
        : undefined) ??
      (Number.isFinite(rate.transportBus) ? rate.transportBus : 0);

    // Helper to pull the effective session price for current kind
    const priceProp = KIND_PROP[kind];

    const hrs = (a, b) => Math.max(0, (b - a) / HOUR_MS);

    const mapRoleToTierKey = (role) => {
      const v = (role || "").toString().trim().toLowerCase();
      if (!v) return null;
      if (["junior", "jr"].includes(v)) return "junior";
      if (["senior", "sr"].includes(v)) return "senior";
      if (["lead", "lead host", "leader"].includes(v)) return "lead";
      if (
        v === "junior_emcee" ||
        v === "jr_emcee" ||
        v.includes("junior emcee") ||
        v.includes("junior mc")
      )
        return "junior_emcee";
      if (
        v === "senior_emcee" ||
        v === "sr_emcee" ||
        v.includes("senior emcee") ||
        v.includes("senior mc")
      )
        return "senior_emcee";
      if (v.includes("junior") && v.includes("marshal")) return "junior";
      if (v.includes("senior") && v.includes("marshal")) return "senior";
      return null;
    };

    const tierKeyForUser = (uid, appRec, staffRec) => {
      const jobRoles = job.roleByUser || job.tierByUser || {};
      const raw =
        (appRec &&
          (appRec.tier ||
            appRec.role ||
            appRec.level ||
            appRec.position)) ||
        jobRoles[uid] ||
        (staffRec &&
          (staffRec.tier ||
            staffRec.role ||
            staffRec.position));

      const mapped = mapRoleToTierKey(raw) || raw;
      if (
        mapped === "junior" ||
        mapped === "senior" ||
        mapped === "lead" ||
        mapped === "junior_emcee" ||
        mapped === "senior_emcee"
      ) {
        return mapped;
      }
      return "junior";
    };

    const pushRowForPerson = (uid, { appRec, staffRec, type } = {}) => {
      // Attendance (optional) – if none, we fall back to scheduled hours.
      const rec = attendance[uid] || {};
      const inTime = rec.in ? new Date(rec.in) : null;
      const outTime = rec.out ? new Date(rec.out) : null;

      // Worked hours logic:
      // - If both in/out exist, use actual worked hours.
      // - If only in exists, assume worked until scheduled end.
      // - Else, fall back to scheduled hours.
      let workedHours = scheduledHours;
      if (inTime && outTime) {
        workedHours = hrs(inTime, outTime);
      } else if (inTime && !outTime) {
        workedHours = hrs(inTime, scheduledEnd);
      }

      // Base vs OT split for hourly components: base capped at scheduled window
      const baseHours = Math.min(workedHours, scheduledHours);
      const otHours = Math.max(0, workedHours - scheduledHours);
      // OT rounding: .5 and above -> round up, below .5 -> round down
      const otWholeHours = Math.floor(otHours + 0.5);

      // ---- Which rates apply?
      const tierKey = tierKeyForUser(uid, appRec, staffRec);
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

      // Session specific pay (for session variants)
      let specificPay = 0;
      if (isSessionKind(kind)) {
        const specific =
          rr.specificPayment != null
            ? N(rr.specificPayment, 0)
            : priceProp
            ? N(rr[priceProp], 0)
            : 0;
        specificPay = specific;
      }

      // Allowances (sum up)
      let allowances = 0;

      // Parking/ATAG transport allowance — only if they chose ATAG transport
      const transport =
        byUserTransport.get(uid) ||
        (staffRec && staffRec.transport) ||
        "Own Transport";
      if (transport === "ATAG Transport" || transport === "ATAG Bus") {
        allowances += N(parkingAmt, 0);
      }

      // Early Call — only if enabled AND user actually checked in >= threshold hours early
      const threshold = N(ec.thresholdHours, 0);
      if (ec.enabled && inTime) {
        const earlyHours = (scheduledStart - inTime) / HOUR_MS; // positive if early
        if (earlyHours >= threshold) {
          allowances += N(ec.amount, 0);
        }
      }

      // Loading & Unloading — if enabled and the user is confirmed helper
      if (lduOn && lduHelpers.has(uid)) {
        allowances += lduPriceNum;
      }

      const gross = basePay + otPay + specificPay + allowances;
      const deduction = Math.max(0, N(deductions[uid], 0));
      const net = Math.max(0, gross - deduction);

      // best-effort name/phone/email
      const appUser = (appRec && appRec.user) || {};
      const staffUser = (staffRec && staffRec.user) || {};

      const combinedAppName =
        appRec && (appRec.firstName || appRec.lastName)
          ? `${appRec.firstName || ""} ${appRec.lastName || ""}`.trim()
          : "";

      const name =
        pick(
          // full-timer user object
          staffUser.name,
          staffUser.fullName,
          staffUser.displayName,
          // full-timer record
          staffRec && staffRec.name,
          staffRec && staffRec.fullName,
          staffRec && staffRec.displayName,
          // part-timer user object on application
          appUser.name,
          appUser.fullName,
          appUser.displayName,
          // part-timer record
          appRec && appRec.name,
          appRec && appRec.fullName,
          appRec && appRec.displayName,
          combinedAppName
        ) || (staffRec && (staffRec.id || staffRec.email)) || uid;

      const phone =
        pick(
          // full-timer user object
          staffUser.phone,
          staffUser.phoneNumber,
          staffUser.contact,
          // full-timer record
          staffRec && staffRec.phone,
          staffRec && staffRec.phoneNumber,
          staffRec && staffRec.contact,
          // part-timer user object
          appUser.phone,
          appUser.phoneNumber,
          appUser.contact,
          // part-timer record
          appRec && appRec.phone,
          appRec && appRec.phoneNumber,
          appRec && appRec.contact
        ) || "";

      const email =
        pick(
          staffUser.email,
          staffRec && staffRec.email,
          appUser.email,
          appRec && appRec.email,
          uid
        ) || uid;

      const employmentType =
        type === "full-timer"
          ? "full-timer"
          : type === "part-timer"
          ? "part-timer"
          : staffRec
          ? "full-timer"
          : "part-timer";

      outRows.push({
        userId: uid,
        name: name || "-",
        email,
        phone: phone || "-",
        jobTitle: job.title,
        hours: Number(workedHours.toFixed(2)),
        transport,
        wageGross: gross,
        deduction,
        wageNet: net,
        _basePay: basePay,
        _otPay: otPay,
        _specific: specificPay,
        _allowances: allowances,
        _employmentType: employmentType,
      });
    };

    // ---- PART-TIMERS: approved + optional attendance (no scan required) ----
    const participants = new Set();
    approved.forEach((uid) => participants.add(uid));
    Object.keys(attendance).forEach((uid) => participants.add(uid));

    participants.forEach((uid) => {
      // Keep same rule: only pay approved part-timers
      if (!approved.has(uid)) return;
      // Avoid double-counting full-timers that might also be in approved
      if (fullTimerById.has(uid)) return;
      const appRec = apps.find((a) => a.userId === uid) || {};
      pushRowForPerson(uid, { appRec, staffRec: null, type: "part-timer" });
    });

    // ---- FULL-TIMERS: always included, no attendance required ----
    fullTimers.forEach((staffRec) => {
      const uid = getStaffId(staffRec);
      if (!uid) return;
      pushRowForPerson(uid, { appRec: null, staffRec, type: "full-timer" });
    });

    // sort rows: full-timers first, then part-timers, then by name
    const sortedRows = [...outRows].sort((a, b) => {
      const order = (t) => (t === "full-timer" ? 0 : 1);
      const at = order(a._employmentType);
      const bt = order(b._employmentType);
      if (at !== bt) return at - bt;
      const an = (a.name || "").toLowerCase();
      const bn = (b.name || "").toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    });

    const employees = sortedRows.length;
    const hoursSum = sortedRows.reduce((s, r) => s + r.hours, 0);
    const wagesSum = sortedRows.reduce((s, r) => s + r.wageNet, 0); // sum of NET pay
    setRows(sortedRows);
    setSummary({
      employees,
      hours: hoursSum,
      wages: wagesSum,
      jobs: job ? 1 : 0,
    });
  }

  // AUTO-CALCULATE: whenever job or deductions change
  useEffect(() => {
    calcWages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, deductions]);

  async function exportPayrollCSV() {
    if (!rows.length) {
      alert("No rows to export.");
      return;
    }
    const headers = [
      "Name",
      "Email",
      "Phone",
      "Job",
      "Hours",
      "Transport",
      "Gross",
      "Deduction",
      "Net",
    ];
    const lines = [headers.join(",")];
    rows.forEach((r) => {
      const line = [
        `"${String(r.name || "").replace(/"/g, '""')}"`,
        `"${String(r.email || "").replace(/"/g, '""')}"`,
        `"${String(r.phone || "").replace(/"/g, '""')}"`,
        `"${String(r.jobTitle || "").replace(/"/g, '""')}"`,
        r.hours.toFixed(2),
        `"${r.transport}"`,
        Math.round(r.wageGross),
        Math.round(r.deduction),
        Math.round(r.wageNet),
      ].join(",");
      lines.push(line);
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

  /* ===== UI blocks (mirrors JobModal payment editors) ===== */
  const HourlySimpleGrid = ({ title }) => (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{title}</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 8,
          fontSize: 12,
          color: "#6b7280",
          marginBottom: 4,
        }}
      >
        <div>Role</div>
        <div>Rate (RM/hr)</div>
        <div>OT Rate (RM/hr)</div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", fontWeight: 600 }}
        >
          Junior
        </div>
        <input
          value={hrJr}
          onChange={(e) => setHrJr(e.target.value)}
          inputMode="decimal"
        />
        <input
          value={hrJrOT}
          onChange={(e) => setHrJrOT(e.target.value)}
          inputMode="decimal"
        />
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div
          style={{ display: "flex", alignItems: "center", fontWeight: 600 }}
        >
          Senior
        </div>
        <input
          value={hrSr}
          onChange={(e) => setHrSr(e.target.value)}
          inputMode="decimal"
        />
        <input
          value={hrSrOT}
          onChange={(e) => setHrSrOT(e.target.value)}
          inputMode="decimal"
        />
      </div>
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}
      >
        <div
          style={{ display: "flex", alignItems: "center", fontWeight: 600 }}
        >
          Lead Host
        </div>
        <input
          value={hrLead}
          onChange={(e) => setHrLead(e.target.value)}
          inputMode="decimal"
        />
        <input
          value={hrLeadOT}
          onChange={(e) => setHrLeadOT(e.target.value)}
          inputMode="decimal"
        />
      </div>
    </div>
  );

  const FlatHourlyBlock = () => (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>
        Backend (flat hourly for everyone)
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          fontSize: 12,
          color: "#6b7280",
          marginBottom: 4,
        }}
      >
        <div>Rate (RM/hr)</div>
        <div>OT Rate (RM/hr)</div>
      </div>
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
      >
        <input
          value={flatRate}
          onChange={(e) => setFlatRate(e.target.value)}
          inputMode="decimal"
        />
        <input
          value={flatOT}
          onChange={(e) => setFlatOT(e.target.value)}
          inputMode="decimal"
        />
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
        Everyone is paid the same hourly and OT rate regardless of role.
      </div>
    </div>
  );

  const PaymentBlock = () => {
    if (sessionMode === "virtual")
      return <HourlySimpleGrid title="Hourly (Virtual)" />;
    if (physicalType === "hourly_by_role")
      return <HourlySimpleGrid title="Hourly (by role)" />;
    if (physicalType === "hourly_flat") return <FlatHourlyBlock />;

    const showHalf = physicalType === "half_day";
    const showFull = physicalType === "full_day";
    const show2d1n = physicalType === "2d1n";
    const show3d2n = physicalType === "3d2n";

    return (
      <div className="card" style={{ padding: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>
          Session payment (Physical)
        </div>

        {showHalf && (
          <div>
            <div style={{ marginBottom: 8, fontWeight: 600 }}>
              Half Day (per person)
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, 1fr)",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Junior (RM)</div>
                <input
                  value={pHalfJr}
                  onChange={(e) => setPHalfJr(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Senior (RM)</div>
                <input
                  value={pHalfSr}
                  onChange={(e) => setPHalfSr(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  Lead Host (RM)
                </div>
                <input
                  value={pHalfLead}
                  onChange={(e) => setPHalfLead(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  Junior Emcee (RM)
                </div>
                <input
                  value={pHalfJrEmcee}
                  onChange={(e) => setPHalfJrEmcee(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  Senior Emcee (RM)
                </div>
                <input
                  value={pHalfSrEmcee}
                  onChange={(e) => setPHalfSrEmcee(e.target.value)}
                  inputMode="decimal"
                />
              </div>
            </div>
          </div>
        )}
        {showFull && (
          <div>
            <div style={{ marginBottom: 8, fontWeight: 600 }}>
              Full Day (per person)
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, 1fr)",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Junior (RM)</div>
                <input
                  value={pFullJr}
                  onChange={(e) => setPFullJr(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Senior (RM)</div>
                <input
                  value={pFullSr}
                  onChange={(e) => setPFullSr(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  Lead Host (RM)
                </div>
                <input
                  value={pFullLead}
                  onChange={(e) => setPFullLead(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  Junior Emcee (RM)
                </div>
                <input
                  value={pFullJrEmcee}
                  onChange={(e) => setPFullJrEmcee(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  Senior Emcee (RM)
                </div>
                <input
                  value={pFullSrEmcee}
                  onChange={(e) => setPFullSrEmcee(e.target.value)}
                  inputMode="decimal"
                />
              </div>
            </div>
          </div>
        )}
        {show2d1n && (
          <div>
            <div style={{ marginBottom: 8, fontWeight: 600 }}>
              2D1N (per person)
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, 1fr)",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Junior (RM)</div>
                <input
                  value={p2d1nJr}
                  onChange={(e) => setP2d1nJr(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Senior (RM)</div>
                <input
                  value={p2d1nSr}
                  onChange={(e) => setP2d1nSr(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  Lead Host (RM)
                </div>
                <input
                  value={p2d1nLead}
                  onChange={(e) => setP2d1nLead(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  Junior Emcee (RM)
                </div>
                <input
                  value={p2d1nJrEmcee}
                  onChange={(e) => setP2d1nJrEmcee(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  Senior Emcee (RM)
                </div>
                <input
                  value={p2d1nSrEmcee}
                  onChange={(e) => setP2d1nSrEmcee(e.target.value)}
                  inputMode="decimal"
                />
              </div>
            </div>
          </div>
        )}
        {show3d2n && (
          <div>
            <div style={{ marginBottom: 8, fontWeight: 600 }}>
              3D2N (per person)
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, 1fr)",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Junior (RM)</div>
                <input
                  value={p3d2nJr}
                  onChange={(e) => setP3d2nJr(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Senior (RM)</div>
                <input
                  value={p3d2nSr}
                  onChange={(e) => setP3d2nSr(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  Lead Host (RM)
                </div>
                <input
                  value={p3d2nLead}
                  onChange={(e) => setP3d2nLead(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  Junior Emcee (RM)
                </div>
                <input
                  value={p3d2nJrEmcee}
                  onChange={(e) => setP3d2nJrEmcee(e.target.value)}
                  inputMode="decimal"
                />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  Senior Emcee (RM)
                </div>
                <input
                  value={p3d2nSrEmcee}
                  onChange={(e) => setP3d2nSrEmcee(e.target.value)}
                  inputMode="decimal"
                />
              </div>
            </div>
          </div>
        )}

        {/* Optional hourly add-on for session variants */}
        <div
          className="card"
          style={{
            marginTop: 12,
            padding: 12,
            display: "flex",
            gap: 10,
            alignItems: "center",
          }}
        >
          <input
            id="hourlyToggle"
            type="checkbox"
            checked={hourlyAddon}
            onChange={(e) => setHourlyAddon(e.target.checked)}
          />
          <label htmlFor="hourlyToggle" style={{ userSelect: "none" }}>
            Enable hourly add-on (in addition to session price)
          </label>
        </div>

        {hourlyAddon && (
          <div
            className="card"
            style={{ marginTop: 12, padding: 12, background: "#f8fafc" }}
          >
            <HourlySimpleGrid title="Hourly add-on (Physical)" />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="container" style={{ paddingTop: 12 }}>
      {error && (
        <div
          className="card"
          style={{ background: "#fff4f4", color: "#b00" }}
        >
          {String(error)}
        </div>
      )}

      {/* ---------------- GLOBAL WAGE DEFAULTS ---------------- */}
      <Section title="Global Wage Defaults (used by JobModal as starting values)">
        {/* Parking + EC / LDU */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 3fr",
            gap: 12,
          }}
        >
          <Field label="Default Parking Allowance (RM)">
            <input
              inputMode="decimal"
              value={gParking}
              onChange={(e) => setGParking(e.target.value)}
            />
          </Field>

          <div className="card" style={{ padding: 12 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <Field label="Early Call Amount (RM)">
                <input
                  inputMode="decimal"
                  value={gECAmount}
                  onChange={(e) => setGECAmount(e.target.value)}
                />
              </Field>
              <Field label="Loading & Unloading (RM / helper)">
                <input
                  inputMode="decimal"
                  value={gLDUPrice}
                  onChange={(e) => setGLDUPrice(e.target.value)}
                />
              </Field>
            </div>
          </div>
        </div>

        {/* Hourly by role defaults */}
        <Section title="Hourly (by role) — Defaults">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 8,
              fontSize: 12,
              color: "#6b7280",
              marginBottom: 6,
            }}
          >
            <div>Role</div>
            <div>Rate (RM/hr)</div>
            <div>OT Rate (RM/hr)</div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 8,
              marginBottom: 6,
            }}
          >
            <div
              style={{
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
              }}
            >
              Junior
            </div>
            <input
              inputMode="decimal"
              value={gHrJr}
              onChange={(e) => setGHrJr(e.target.value)}
            />
            <input
              inputMode="decimal"
              value={gHrJrOT}
              onChange={(e) => setGHrJrOT(e.target.value)}
            />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 8,
              marginBottom: 6,
            }}
          >
            <div
              style={{
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
              }}
            >
              Senior
            </div>
            <input
              inputMode="decimal"
              value={gHrSr}
              onChange={(e) => setGHrSr(e.target.value)}
            />
            <input
              inputMode="decimal"
              value={gHrSrOT}
              onChange={(e) => setGHrSrOT(e.target.value)}
            />
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 8,
            }}
          >
            <div
              style={{
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
              }}
            >
              Lead Host
            </div>
            <input
              inputMode="decimal"
              value={gHrLead}
              onChange={(e) => setGHrLead(e.target.value)}
            />
            <input
              inputMode="decimal"
              value={gHrLeadOT}
              onChange={(e) => setGHrLeadOT(e.target.value)}
            />
          </div>
        </Section>

        {/* Backend flat defaults */}
        <Section title="Backend (flat hourly for all) — Defaults">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
              fontSize: 12,
              color: "#6b7280",
              marginBottom: 6,
            }}
          >
            <div>Rate (RM/hr)</div>
            <div>OT Rate (RM/hr)</div>
          </div>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
          >
            <input
              inputMode="decimal"
              value={gFlat}
              onChange={(e) => setGFlat(e.target.value)}
            />
            <input
              inputMode="decimal"
              value={gFlatOT}
              onChange={(e) => setGFlatOT(e.target.value)}
            />
          </div>
        </Section>

        {/* Session defaults */}
        <Section title="Session (specific payment per person) — Defaults">
          <div className="card" style={{ padding: 10, marginBottom: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Half Day</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, 1fr)",
                gap: 8,
              }}
            >
              <Field label="Junior (RM)">
                <input
                  inputMode="decimal"
                  value={gHalfJr}
                  onChange={(e) => setGHalfJr(e.target.value)}
                />
              </Field>
              <Field label="Senior (RM)">
                <input
                  inputMode="decimal"
                  value={gHalfSr}
                  onChange={(e) => setGHalfSr(e.target.value)}
                />
              </Field>
              <Field label="Lead Host (RM)">
                <input
                  inputMode="decimal"
                  value={gHalfLead}
                  onChange={(e) => setGHalfLead(e.target.value)}
                />
              </Field>
              <Field label="Junior Emcee (RM)">
                <input
                  inputMode="decimal"
                  value={gHalfJrEmcee}
                  onChange={(e) => setGHalfJrEmcee(e.target.value)}
                />
              </Field>
              <Field label="Senior Emcee (RM)">
                <input
                  inputMode="decimal"
                  value={gHalfSrEmcee}
                  onChange={(e) => setGHalfSrEmcee(e.target.value)}
                />
              </Field>
            </div>
          </div>
          <div className="card" style={{ padding: 10, marginBottom: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Full Day</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, 1fr)",
                gap: 8,
              }}
            >
              <Field label="Junior (RM)">
                <input
                  inputMode="decimal"
                  value={gFullJr}
                  onChange={(e) => setGFullJr(e.target.value)}
                />
              </Field>
              <Field label="Senior (RM)">
                <input
                  inputMode="decimal"
                  value={gFullSr}
                  onChange={(e) => setGFullSr(e.target.value)}
                />
              </Field>
              <Field label="Lead Host (RM)">
                <input
                  inputMode="decimal"
                  value={gFullLead}
                  onChange={(e) => setGFullLead(e.target.value)}
                />
              </Field>
              <Field label="Junior Emcee (RM)">
                <input
                  inputMode="decimal"
                  value={gFullJrEmcee}
                  onChange={(e) => setGFullJrEmcee(e.target.value)}
                />
              </Field>
              <Field label="Senior Emcee (RM)">
                <input
                  inputMode="decimal"
                  value={gFullSrEmcee}
                  onChange={(e) => setGFullSrEmcee(e.target.value)}
                />
              </Field>
            </div>
          </div>
          <div className="card" style={{ padding: 10, marginBottom: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>2D1N</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, 1fr)",
                gap: 8,
              }}
            >
              <Field label="Junior (RM)">
                <input
                  inputMode="decimal"
                  value={g2d1nJr}
                  onChange={(e) => setG2d1nJr(e.target.value)}
                />
              </Field>
              <Field label="Senior (RM)">
                <input
                  inputMode="decimal"
                  value={g2d1nSr}
                  onChange={(e) => setG2d1nSr(e.target.value)}
                />
              </Field>
              <Field label="Lead Host (RM)">
                <input
                  inputMode="decimal"
                  value={g2d1nLead}
                  onChange={(e) => setG2d1nLead(e.target.value)}
                />
              </Field>
              <Field label="Junior Emcee (RM)">
                <input
                  inputMode="decimal"
                  value={g2d1nJrEmcee}
                  onChange={(e) => setG2d1nJrEmcee(e.target.value)}
                />
              </Field>
              <Field label="Senior Emcee (RM)">
                <input
                  inputMode="decimal"
                  value={g2d1nSrEmcee}
                  onChange={(e) => setG2d1nSrEmcee(e.target.value)}
                />
              </Field>
            </div>
          </div>
          <div className="card" style={{ padding: 10 }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>3D2N</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5, 1fr)",
                gap: 8,
              }}
            >
              <Field label="Junior (RM)">
                <input
                  inputMode="decimal"
                  value={g3d2nJr}
                  onChange={(e) => setG3d2nJr(e.target.value)}
                />
              </Field>
              <Field label="Senior (RM)">
                <input
                  inputMode="decimal"
                  value={g3d2nSr}
                  onChange={(e) => setG3d2nSr(e.target.value)}
                />
              </Field>
              <Field label="Lead Host (RM)">
                <input
                  inputMode="decimal"
                  value={g3d2nLead}
                  onChange={(e) => setG3d2nLead(e.target.value)}
                />
              </Field>
              <Field label="Junior Emcee (RM)">
                <input
                  inputMode="decimal"
                  value={g3d2nJrEmcee}
                  onChange={(e) => setG3d2nJrEmcee(e.target.value)}
                />
              </Field>
              <Field label="Senior Emcee (RM)">
                <input
                  inputMode="decimal"
                  value={g3d2nSrEmcee}
                  onChange={(e) => setG3d2nSrEmcee(e.target.value)}
                />
              </Field>
            </div>
          </div>
        </Section>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn primary" onClick={saveGlobal}>
            Save Defaults
          </button>
        </div>
      </Section>

      {/* ---------------- RATE & JOB CONFIG (updated to mirror JobModal) ---------------- */}
      <Section title="Rate & Job Configuration">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              style={{ width: 360, padding: 10, borderRadius: 8 }}
            >
              <option value="">Select a job…</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </select>
            {job && (
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                <div>
                  <b>Venue:</b> {job.venue || "-"}
                </div>
                <div>
                  <b>When:</b> {fmtRange(job.startTime, job.endTime)}
                </div>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {headerPills}
            <button
              className="btn primary"
              onClick={saveConfig}
              disabled={!job}
            >
              Save Configuration
            </button>
          </div>
        </div>

        {job && (
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            {/* Session type (same controls as JobModal for consistency) */}
            <div className="card" style={{ padding: 12 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    sessionMode === "physical" ? "1fr 1fr" : "1fr",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>
                    Session Type
                  </div>
                  <select
                    value={sessionMode}
                    onChange={(e) => setSessionMode(e.target.value)}
                  >
                    <option value="virtual">Virtual</option>
                    <option value="physical">Physical</option>
                  </select>
                </div>
                {sessionMode === "physical" && (
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>
                      Physical Subtype
                    </div>
                    <select
                      value={physicalType}
                      onChange={(e) => setPhysicalType(e.target.value)}
                    >
                      <option value="half_day">Half Day</option>
                      <option value="full_day">Full Day</option>
                      <option value="2d1n">2D1N</option>
                      <option value="3d2n">3D2N</option>
                      <option value="hourly_by_role">
                        Hourly (by role)
                      </option>
                      <option value="hourly_flat">
                        Backend (flat hourly for all)
                      </option>
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Parking Allowance */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr",
                gap: 12,
              }}
            >
              <Field
                label="Parking Allowance (RM, when ATAG Transport is selected)"
                hint={
                  job?.transportOptions?.bus
                    ? "Applied to applicants who choose ATAG Transport."
                    : "ATAG Transport isn't enabled on this job — allowance won’t apply."
                }
              >
                <input
                  type="text"
                  inputMode="decimal"
                  value={parkingAllowance}
                  onChange={(e) =>
                    setParkingAllowance(e.target.value)
                  }
                />
              </Field>
            </div>

            {/* Payments editor (now mirrors JobModal) */}
            <Section title="Wage Settings (matches JobModal)">
              <PaymentBlock />
            </Section>
          </div>
        )}
      </Section>

      {/* Wage Calculation (AUTO) */}
      <div className="card" style={{ marginTop: 12 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontWeight: 700 }}>
            Wage Summary (auto-calculated)
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {/* Removed "Calculate Wages" per request */}
            {job && (
              <button
                className="btn"
                onClick={exportPayrollCSV}
                disabled={!rows.length}
              >
                Export to CSV
              </button>
            )}
          </div>
        </div>

        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table
            width="100%"
            cellPadding="8"
            style={{ borderCollapse: "collapse" }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid #ddd" }}>
                <th align="left">Name</th>
                <th align="left">Email</th>
                <th align="left">Phone</th>
                <th align="left">Job</th>
                <th align="right">Hours</th>
                <th align="left">Transport</th>
                <th align="right">Base</th>
                <th align="right">OT</th>
                <th align="right">Specific</th>
                <th align="right">Allowances</th>
                <th align="right">Deduct (RM)</th>
                <th align="right">Net Pay</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.userId}
                  style={{ borderBottom: "1px solid #f0f0f0" }}
                >
                  <td>{r.name}</td>
                  <td>{r.email}</td>
                  <td>{r.phone}</td>
                  <td>{r.jobTitle}</td>
                  <td align="right">{r.hours.toFixed(2)}</td>
                  <td>{r.transport}</td>
                  <td align="right">{money(r._basePay)}</td>
                  <td align="right">{money(r._otPay)}</td>
                  <td align="right">{money(r._specific)}</td>
                  <td align="right">{money(r._allowances)}</td>
                  <td align="right" style={{ minWidth: 100 }}>
                    <input
                      inputMode="decimal"
                      value={String(deductions[r.userId] ?? 0)}
                      onChange={(e) =>
                        setDeduction(r.userId, e.target.value)
                      }
                      style={{ width: 90, textAlign: "right" }}
                    />
                  </td>
                  <td align="right">
                    <b>{money(r.wageNet)}</b>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={12} style={{ opacity: 0.6 }}>
                    Select a job to view auto-calculated wages.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div style={{ marginTop: 10, fontSize: 14, opacity: 0.9 }}>
          <div>
            <strong>Totals</strong>
          </div>
          <div>Total Employees: {summary.employees}</div>
          <div>Total Hours: {summary.hours.toFixed(2)}</div>
          <div>Total Net Wages: {money(summary.wages)}</div>
          <div>Jobs Included: {summary.jobs}</div>
        </div>
      </div>
    </div>
  );
}
