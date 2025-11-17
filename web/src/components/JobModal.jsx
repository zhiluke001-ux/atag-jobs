// web/src/components/JobModal.jsx
import React, { useRef, useState, memo } from "react";
import dayjs from "dayjs";
import { apiPost, apiPatch } from "../api";

/* ---------- helpers ---------- */
const N = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const GLOBAL_KEY = "atag.globalWageDefaults.v2";

function loadGlobalDefaults() {
  try {
    const raw = localStorage.getItem(GLOBAL_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function combineLocal(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const isoLocal = `${dateStr}T${timeStr}`;
  const d = dayjs(isoLocal);
  return d.isValid() ? d.toISOString() : null;
}

const DEFAULT_END_BY_TYPE = {
  virtual: (startDate) => startDate,
  half_day: (startDate) => startDate,
  full_day: (startDate) => startDate,
  "2d1n": (startDate) => dayjs(startDate).add(1, "day").format("YYYY-MM-DD"),
  "3d2n": (startDate) => dayjs(startDate).add(2, "day").format("YYYY-MM-DD"),
  hourly_by_role: (startDate) => startDate,
  hourly_flat: (startDate) => startDate,
};

/* =========================================================
   Hoisted, stable subcomponents (prevents remount/focus loss)
   ========================================================= */

const DatesBlock = memo(function DatesBlock({
  sessionMode,
  physicalType,
  dateStart,
  dateEnd,
  timeStart,
  timeEnd,
  dateStartRef,
  dateEndRef,
  timeStartRef,
  timeEndRef,
}) {
  const kind = sessionMode === "virtual" ? "virtual" : physicalType;
  const singleDate = ["virtual", "half_day", "full_day", "hourly_by_role", "hourly_flat"].includes(
    kind
  );

  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Date &amp; Time</div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: singleDate ? "1fr" : "repeat(2, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#374151",
              marginBottom: 6,
            }}
          >
            {singleDate ? "Date" : "Start Date"}
          </div>
          <input ref={dateStartRef} type="date" defaultValue={dateStart} />
        </div>

        {!singleDate && (
          <div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#374151",
                marginBottom: 6,
              }}
            >
              End Date
            </div>
            <input ref={dateEndRef} type="date" defaultValue={dateEnd} />
          </div>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 12,
          marginTop: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#374151",
              marginBottom: 6,
            }}
          >
            Start Time
          </div>
          <input ref={timeStartRef} type="time" defaultValue={timeStart} />
        </div>
        <div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#374151",
              marginBottom: 6,
            }}
          >
            End Time
          </div>
          <input ref={timeEndRef} type="time" defaultValue={timeEnd} />
        </div>
      </div>

      <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
        OT is counted for every full hour after the scheduled <b>End Time</b>.
      </div>
    </div>
  );
});

const HourlySimpleGrid = memo(function HourlySimpleGrid({
  title,
  hrJr,
  setHrJr,
  hrJrOT,
  setHrJrOT,
  hrSr,
  setHrSr,
  hrSrOT,
  setHrSrOT,
  hrLead,
  setHrLead,
  hrLeadOT,
  setHrLeadOT,
}) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{title}</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(120px, 1.2fr) minmax(120px, 1fr) minmax(120px, 1fr)",
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

      {/* Junior */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(120px, 1.2fr) minmax(120px, 1fr) minmax(120px, 1fr)",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontWeight: 600 }}>Junior</div>
        <input value={hrJr} onChange={(e) => setHrJr(e.target.value)} inputMode="decimal" />
        <input value={hrJrOT} onChange={(e) => setHrJrOT(e.target.value)} inputMode="decimal" />
      </div>

      {/* Senior */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(120px, 1.2fr) minmax(120px, 1fr) minmax(120px, 1fr)",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontWeight: 600 }}>Senior</div>
        <input value={hrSr} onChange={(e) => setHrSr(e.target.value)} inputMode="decimal" />
        <input value={hrSrOT} onChange={(e) => setHrSrOT(e.target.value)} inputMode="decimal" />
      </div>

      {/* Lead */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(120px, 1.2fr) minmax(120px, 1fr) minmax(120px, 1fr)",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontWeight: 600 }}>Lead Host</div>
        <input value={hrLead} onChange={(e) => setHrLead(e.target.value)} inputMode="decimal" />
        <input
          value={hrLeadOT}
          onChange={(e) => setHrLeadOT(e.target.value)}
          inputMode="decimal"
        />
      </div>
    </div>
  );
});

const FlatHourlyBlock = memo(function FlatHourlyBlock({ flatRate, setFlatRate, flatOT, setFlatOT }) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Backend (flat hourly for everyone)</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
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
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
          gap: 8,
        }}
      >
        <input value={flatRate} onChange={(e) => setFlatRate(e.target.value)} inputMode="decimal" />
        <input value={flatOT} onChange={(e) => setFlatOT(e.target.value)} inputMode="decimal" />
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
        Everyone is paid the same hourly and OT rate regardless of role.
      </div>
    </div>
  );
});

const PaymentBlock = memo(function PaymentBlock({
  sessionMode,
  physicalType,
  // hourly by role
  hrJr,
  setHrJr,
  hrJrOT,
  setHrJrOT,
  hrSr,
  setHrSr,
  hrSrOT,
  setHrSrOT,
  hrLead,
  setHrLead,
  hrLeadOT,
  setHrLeadOT,
  // flat hourly
  flatRate,
  setFlatRate,
  flatOT,
  setFlatOT,
  // session prices
  pHalfJr,
  setPHalfJr,
  pHalfSr,
  setPHalfSr,
  pHalfLead,
  setPHalfLead,
  pFullJr,
  setPFullJr,
  pFullSr,
  setPFullSr,
  pFullLead,
  setPFullLead,
  p2d1nJr,
  setP2d1nJr,
  p2d1nSr,
  setP2d1nSr,
  p2d1nLead,
  setP2d1nLead,
  p3d2nJr,
  setP3d2nJr,
  p3d2nSr,
  setP3d2nSr,
  p3d2nLead,
  setP3d2nLead,
  // hourly add-on
  hourlyAddon,
  setHourlyAddon,
}) {
  if (sessionMode === "virtual") {
    return (
      <HourlySimpleGrid
        title="Hourly (Virtual)"
        hrJr={hrJr}
        setHrJr={setHrJr}
        hrJrOT={hrJrOT}
        setHrJrOT={setHrJrOT}
        hrSr={hrSr}
        setHrSr={setHrSr}
        hrSrOT={hrSrOT}
        setHrSrOT={setHrSrOT}
        hrLead={hrLead}
        setHrLead={setHrLead}
        hrLeadOT={hrLeadOT}
        setHrLeadOT={setHrLeadOT}
      />
    );
  }

  if (physicalType === "hourly_by_role") {
    return (
      <HourlySimpleGrid
        title="Hourly (by role)"
        hrJr={hrJr}
        setHrJr={setHrJr}
        hrJrOT={hrJrOT}
        setHrJrOT={setHrJrOT}
        hrSr={hrSr}
        setHrSr={setHrSr}
        hrSrOT={hrSrOT}
        setHrSrOT={setHrSrOT}
        hrLead={hrLead}
        setHrLead={setHrLead}
        hrLeadOT={hrLeadOT}
        setHrLeadOT={setHrLeadOT}
      />
    );
  }

  if (physicalType === "hourly_flat") {
    return (
      <FlatHourlyBlock
        flatRate={flatRate}
        setFlatRate={setFlatRate}
        flatOT={flatOT}
        setFlatOT={setFlatOT}
      />
    );
  }

  // session-based
  const showHalf = physicalType === "half_day";
  const showFull = physicalType === "full_day";
  const show2d1n = physicalType === "2d1n";
  const show3d2n = physicalType === "3d2n";

  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Session payment (Physical)</div>

      {showHalf && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>Half Day (per person)</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Junior (RM)</div>
              <input value={pHalfJr} onChange={(e) => setPHalfJr(e.target.value)} inputMode="decimal" />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Senior (RM)</div>
              <input value={pHalfSr} onChange={(e) => setPHalfSr(e.target.value)} inputMode="decimal" />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Lead Host (RM)</div>
              <input
                value={pHalfLead}
                onChange={(e) => setPHalfLead(e.target.value)}
                inputMode="decimal"
              />
            </div>
          </div>
        </div>
      )}

      {showFull && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>Full Day (per person)</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Junior (RM)</div>
              <input value={pFullJr} onChange={(e) => setPFullJr(e.target.value)} inputMode="decimal" />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Senior (RM)</div>
              <input value={pFullSr} onChange={(e) => setPFullSr(e.target.value)} inputMode="decimal" />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Lead Host (RM)</div>
              <input
                value={pFullLead}
                onChange={(e) => setPFullLead(e.target.value)}
                inputMode="decimal"
              />
            </div>
          </div>
        </div>
      )}

      {show2d1n && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>2D1N (per person)</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Junior (RM)</div>
              <input value={p2d1nJr} onChange={(e) => setP2d1nJr(e.target.value)} inputMode="decimal" />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Senior (RM)</div>
              <input value={p2d1nSr} onChange={(e) => setP2d1nSr(e.target.value)} inputMode="decimal" />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Lead Host (RM)</div>
              <input
                value={p2d1nLead}
                onChange={(e) => setP2d1nLead(e.target.value)}
                inputMode="decimal"
              />
            </div>
          </div>
        </div>
      )}

      {show3d2n && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>3D2N (per person)</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Junior (RM)</div>
              <input value={p3d2nJr} onChange={(e) => setP3d2nJr(e.target.value)} inputMode="decimal" />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Senior (RM)</div>
              <input value={p3d2nSr} onChange={(e) => setP3d2nSr(e.target.value)} inputMode="decimal" />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>Lead Host (RM)</div>
              <input
                value={p3d2nLead}
                onChange={(e) => setP3d2nLead(e.target.value)}
                inputMode="decimal"
              />
            </div>
          </div>
        </div>
      )}

      {/* Optional hourly add-on for session variants */}
      <div
        style={{
          marginTop: 8,
          paddingTop: 8,
          borderTop: "1px solid #e5e7eb",
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
        <div style={{ marginTop: 12, background: "#f8fafc", padding: 10, borderRadius: 8 }}>
          <HourlySimpleGrid
            title="Hourly add-on (Physical)"
            hrJr={hrJr}
            setHrJr={setHrJr}
            hrJrOT={hrJrOT}
            setHrJrOT={setHrJrOT}
            hrSr={hrSr}
            setHrSr={setHrSr}
            hrSrOT={hrSrOT}
            setHrSrOT={setHrSrOT}
            hrLead={hrLead}
            setHrLead={setHrLead}
            hrLeadOT={hrLeadOT}
            setHrLeadOT={setHrLeadOT}
          />
        </div>
      )}
    </div>
  );
});

/* =========================
   Main Component: JobModal
   ========================= */
export default function JobModal({ open, job, onClose, onCreated, onUpdated }) {
  if (!open) return null;
  const editing = !!job?.id;

  /* -------- inference (back-compat) -------- */
  const sessionKindFromRate = job?.rate?.sessionKind;
  const inferMode = () => {
    if (sessionKindFromRate === "virtual") return "virtual";
    if (["half_day", "full_day", "2d1n", "3d2n", "hourly_by_role", "hourly_flat"].includes(
      sessionKindFromRate
    ))
      return "physical";
    return job?.session?.mode || job?.sessionMode || job?.mode || "virtual";
  };
  const inferPhysType = () => {
    if (["half_day", "full_day", "2d1n", "3d2n", "hourly_by_role", "hourly_flat"].includes(
      sessionKindFromRate
    ))
      return sessionKindFromRate;
    const legacy = job?.session?.physicalType || job?.physicalType || job?.physicalSubtype;
    return ["half_day", "full_day", "2d1n", "3d2n", "hourly_by_role", "hourly_flat"].includes(
      legacy
    )
      ? legacy
      : "half_day";
  };

  /* ---------- base fields ---------- */
  const [title, setTitle] = useState(job?.title || "");
  const [venue, setVenue] = useState(job?.venue || "");
  const [description, setDescription] = useState(job?.description || "");

  const [sessionMode, setSessionMode] = useState(inferMode());
  const [physicalType, setPhysicalType] = useState(inferPhysType());

  /* ---------- transport ---------- */
  const gl = loadGlobalDefaults();
  const [optBus, setOptBus] = useState(job?.transportOptions?.bus !== false);
  const [optOwn, setOptOwn] = useState(job?.transportOptions?.own !== false);
  const [parkingAmount, setParkingAmount] = useState(
    String(
      editing
        ? job?.allowances?.parking?.amount ??
            job?.rate?.transportAllowance ??
            job?.rate?.transportBus ??
            0
        : gl?.parkingAllowance ?? 0
    )
  );

  /* ---------- Headcount (informational only) ---------- */
  const [headcount, setHeadcount] = useState(
    String(job?.headcount ?? job?.rolePlan?.junior ?? 0)
  );

  /* ---------- time & date ---------- */
  const startInit = job?.startTime ? dayjs(job.startTime) : dayjs();
  const endInit = job?.endTime ? dayjs(job.endTime) : startInit;

  const [dateStart] = useState(startInit.format("YYYY-MM-DD"));
  const [timeStart] = useState(startInit.format("HH:mm"));
  const [dateEnd] = useState(endInit.format("YYYY-MM-DD"));
  const [timeEnd] = useState(endInit.format("HH:mm"));

  // Uncontrolled refs (keep native pickers open)
  const dateStartRef = useRef(null);
  const timeStartRef = useRef(null);
  const dateEndRef = useRef(null);
  const timeEndRef = useRef(null);

  /* ---------- pay state ---------- */
  // hardcoded fallbacks if no global defaults stored
  const defaultsHourly = { jr: "15", sr: "20", lead: "25" };
  const defaultsHalf = { jr: "60", sr: "80", lead: "100" };
  const defaultsFull = { jr: "120", sr: "160", lead: "200" };
  const defaults2d1n = { jr: "300", sr: "400", lead: "500" };
  const defaults3d2n = { jr: "450", sr: "600", lead: "750" };

  const tr = job?.rate?.tierRates || {};
  const gHr = gl?.hourly_by_role || {};
  const gFlat = gl?.hourly_flat || {};
  const gSess = gl?.session || {};

  // Hourly (role-based): Rate + OT Rate
  const [hrJr, setHrJr] = useState(
    String(editing ? tr.junior?.base ?? defaultsHourly.jr : gHr.junior?.base ?? defaultsHourly.jr)
  );
  const [hrSr, setHrSr] = useState(
    String(editing ? tr.senior?.base ?? defaultsHourly.sr : gHr.senior?.base ?? defaultsHourly.sr)
  );
  const [hrLead, setHrLead] = useState(
    String(editing ? tr.lead?.base ?? defaultsHourly.lead : gHr.lead?.base ?? defaultsHourly.lead)
  );

  const [hrJrOT, setHrJrOT] = useState(
    String(editing ? tr.junior?.otRatePerHour ?? "0" : gHr.junior?.otRatePerHour ?? "0")
  );
  const [hrSrOT, setHrSrOT] = useState(
    String(editing ? tr.senior?.otRatePerHour ?? "0" : gHr.senior?.otRatePerHour ?? "0")
  );
  const [hrLeadOT, setHrLeadOT] = useState(
    String(editing ? tr.lead?.otRatePerHour ?? "0" : gHr.lead?.otRatePerHour ?? "0")
  );

  // Hourly (flat for all / “Backend”)
  const [flatRate, setFlatRate] = useState(
    String(
      editing
        ? job?.rate?.flatHourly?.base ?? tr.junior?.base ?? defaultsHourly.jr
        : gFlat.base ?? gHr.junior?.base ?? defaultsHourly.jr
    )
  );
  const [flatOT, setFlatOT] = useState(
    String(
      editing
        ? job?.rate?.flatHourly?.otRatePerHour ?? tr.junior?.otRatePerHour ?? "0"
        : gFlat.otRatePerHour ?? gHr.junior?.otRatePerHour ?? "0"
    )
  );

  // Session prices (Half/Full/2D1N/3D2N)
  const [pHalfJr, setPHalfJr] = useState(
    String(
      editing
        ? tr.junior?.halfDay ?? tr.junior?.specificPayment ?? defaultsHalf.jr
        : gSess?.half_day?.jr ?? defaultsHalf.jr
    )
  );
  const [pHalfSr, setPHalfSr] = useState(
    String(
      editing
        ? tr.senior?.halfDay ?? tr.senior?.specificPayment ?? defaultsHalf.sr
        : gSess?.half_day?.sr ?? defaultsHalf.sr
    )
  );
  const [pHalfLead, setPHalfLead] = useState(
    String(
      editing
        ? tr.lead?.halfDay ?? tr.lead?.specificPayment ?? defaultsHalf.lead
        : gSess?.half_day?.lead ?? defaultsHalf.lead
    )
  );

  const [pFullJr, setPFullJr] = useState(
    String(
      editing
        ? tr.junior?.fullDay ?? tr.junior?.specificPayment ?? defaultsFull.jr
        : gSess?.full_day?.jr ?? defaultsFull.jr
    )
  );
  const [pFullSr, setPFullSr] = useState(
    String(
      editing
        ? tr.senior?.fullDay ?? tr.senior?.specificPayment ?? defaultsFull.sr
        : gSess?.full_day?.sr ?? defaultsFull.sr
    )
  );
  const [pFullLead, setPFullLead] = useState(
    String(
      editing
        ? tr.lead?.fullDay ?? tr.lead?.specificPayment ?? defaultsFull.lead
        : gSess?.full_day?.lead ?? defaultsFull.lead
    )
  );

  const [p2d1nJr, setP2d1nJr] = useState(
    String(
      editing
        ? tr.junior?.twoD1N ?? tr.junior?.specificPayment ?? defaults2d1n.jr
        : gSess?.twoD1N?.jr ?? defaults2d1n.jr
    )
  );
  const [p2d1nSr, setP2d1nSr] = useState(
    String(
      editing
        ? tr.senior?.twoD1N ?? tr.senior?.specificPayment ?? defaults2d1n.sr
        : gSess?.twoD1N?.sr ?? defaults2d1n.sr
    )
  );
  const [p2d1nLead, setP2d1nLead] = useState(
    String(
      editing
        ? tr.lead?.twoD1N ?? tr.lead?.specificPayment ?? defaults2d1n.lead
        : gSess?.twoD1N?.lead ?? defaults2d1n.lead
    )
  );

  const [p3d2nJr, setP3d2nJr] = useState(
    String(
      editing
        ? tr.junior?.threeD2N ?? tr.junior?.specificPayment ?? defaults3d2n.jr
        : gSess?.threeD2N?.jr ?? defaults3d2n.jr
    )
  );
  const [p3d2nSr, setP3d2nSr] = useState(
    String(
      editing
        ? tr.senior?.threeD2N ?? tr.senior?.specificPayment ?? defaults3d2n.sr
        : gSess?.threeD2N?.sr ?? defaults3d2n.sr
    )
  );
  const [p3d2nLead, setP3d2nLead] = useState(
    String(
      editing
        ? tr.lead?.threeD2N ?? tr.lead?.specificPayment ?? defaults3d2n.lead
        : gSess?.threeD2N?.lead ?? defaults3d2n.lead
    )
  );

  // Optional hourly add-on for session variants
  const [hourlyAddon, setHourlyAddon] = useState(
    !!(job?.session?.hourlyEnabled || job?.physicalHourlyEnabled)
  );

  /* ---- Early Call & Loading/Unloading (physical only) ---- */
  const [ecEnabled, setEcEnabled] = useState(!!job?.earlyCall?.enabled);
  const [ecAmount, setEcAmount] = useState(String(job?.earlyCall?.amount ?? 0));

  const [luEnabled, setLuEnabled] = useState(!!job?.loadingUnload?.enabled);
  const [luPrice, setLuPrice] = useState(String(job?.loadingUnload?.price ?? 0));
  const [luQuota, setLuQuota] = useState(String(job?.loadingUnload?.quota ?? 0));

  function buildTierRates() {
    const kind = sessionMode === "virtual" ? "virtual" : physicalType;

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

    // Session-based (half/full/2d1n/3d2n)
    const priceFor = (tier) => {
      if (kind === "half_day") return tier === "jr" ? N(pHalfJr) : tier === "sr" ? N(pHalfSr) : N(pHalfLead);
      if (kind === "full_day") return tier === "jr" ? N(pFullJr) : tier === "sr" ? N(pFullSr) : N(pFullLead);
      if (kind === "2d1n") return tier === "jr" ? N(p2d1nJr) : tier === "sr" ? N(p2d1nSr) : N(p2d1nLead);
      // 3d2n
      return tier === "jr" ? N(p3d2nJr) : tier === "sr" ? N(p3d2nSr) : N(p3d2nLead);
    };

    const mode = hourlyAddon ? "specific_plus_hourly" : "specific";
    const ifHourly = (base, ot) => (hourlyAddon ? { base, otRatePerHour: ot } : {});

    return {
      junior: {
        payMode: mode,
        specificPayment: priceFor("jr"),
        ...ifHourly(N(hrJr, 15), N(hrJrOT, 0)),
        halfDay: N(pHalfJr),
        fullDay: N(pFullJr),
        twoD1N: N(p2d1nJr),
        threeD2N: N(p3d2nJr),
      },
      senior: {
        payMode: mode,
        specificPayment: priceFor("sr"),
        ...ifHourly(N(hrSr, 20), N(hrSrOT, 0)),
        halfDay: N(pHalfSr),
        fullDay: N(pFullSr),
        twoD1N: N(p2d1nSr),
        threeD2N: N(p3d2nSr),
      },
      lead: {
        payMode: mode,
        specificPayment: priceFor("lead"),
        ...ifHourly(N(hrLead, 25), N(hrLeadOT, 0)),
        halfDay: N(pHalfLead),
        fullDay: N(pFullLead),
        twoD1N: N(p2d1nLead),
        threeD2N: N(p3d2nLead),
      },
    };
  }

  const [busy, setBusy] = useState(false);

  async function onSave() {
    if (!title.trim()) return alert("Title is required.");
    if (!venue.trim()) return alert("Venue is required.");

    // Transport options only for physical
    if (sessionMode === "physical" && !optBus && !optOwn) {
      return alert("Select at least one transport option for a physical session.");
    }

    const kind = sessionMode === "virtual" ? "virtual" : physicalType;
    const singleDate = ["virtual", "half_day", "full_day", "hourly_by_role", "hourly_flat"].includes(
      kind
    );

    const ds = dateStartRef.current?.value || dateStart;
    const ts = timeStartRef.current?.value || timeStart;
    const te = timeEndRef.current?.value || timeEnd;
    const deCandidate = dateEndRef.current?.value || dateEnd;
    const de = singleDate ? ds : deCandidate || DEFAULT_END_BY_TYPE[kind]?.(ds) || ds;

    if (!ds || !ts || !te) return alert("Please fill date/time fields.");

    const startISO = combineLocal(ds, ts);
    const endISO = combineLocal(de, te);
    if (!startISO || !endISO) return alert("Invalid start/end date or time.");

    const isPhysical = sessionMode === "physical";
    const transportOptions = isPhysical
      ? { bus: !!optBus, own: !!optOwn, atagTransport: !!optBus, ownTransport: !!optOwn }
      : { bus: false, own: false, atagTransport: false, ownTransport: false };

    const parking =
      isPhysical && optBus
        ? { enabled: true, amount: N(parkingAmount, 0) }
        : { enabled: false, amount: 0 };

    // Early Call & Loading/Unloading (only if physical)
    const earlyCall = isPhysical
      ? { enabled: !!ecEnabled, amount: N(ecAmount, 0) }
      : { enabled: false, amount: 0 };

    const loadingUnload = isPhysical
      ? { enabled: !!luEnabled, price: N(luPrice, 0), quota: N(luQuota, 0) }
      : { enabled: false, price: 0, quota: 0 };

    setBusy(true);
    try {
      const payload = {
        title: title.trim(),
        venue: venue.trim(),
        description,
        startTime: startISO,
        endTime: endISO,
        headcount: N(headcount, 0),

        session: {
          mode: sessionMode,
          physicalType: isPhysical ? physicalType : null,
          hourlyEnabled:
            isPhysical && ["half_day", "full_day", "2d1n", "3d2n"].includes(physicalType)
              ? !!hourlyAddon
              : false,
        },

        // mirrors
        mode: sessionMode,
        sessionMode,
        sessionKind: kind,
        physicalType: isPhysical ? physicalType : null,
        physicalSubtype: isPhysical ? physicalType : null,
        physicalHourlyEnabled:
          isPhysical && ["half_day", "full_day", "2d1n", "3d2n"].includes(physicalType)
            ? !!hourlyAddon
            : false,

        transportOptions,

        // keep rolePlan for back-compat (not used as caps)
        rolePlan: { junior: 0, senior: 0, lead: 0 },

        rate: {
          transportBus: isPhysical ? N(parkingAmount, 0) : 0,
          transportAllowance: isPhysical ? N(parkingAmount, 0) : 0,
          parkingAllowance: isPhysical ? N(parkingAmount, 0) : 0,
          sessionKind: kind,
          tierRates: buildTierRates(),
          ...(physicalType === "hourly_flat" && isPhysical
            ? { flatHourly: { base: N(flatRate, 15), otRatePerHour: N(flatOT, 0) } }
            : {}),
        },

        allowances: { ...job?.allowances, parking },

        // NEW blocks
        earlyCall,
        loadingUnload,
      };

      if (editing) {
        await apiPatch(`/jobs/${job.id}`, payload);
        onUpdated && onUpdated();
      } else {
        await apiPost("/jobs", payload);
        onCreated && onCreated();
      }
    } catch (e) {
      alert("Save failed: " + (e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="modal-backdrop" onClick={busy ? undefined : onClose} />
      <div className="modal" role="dialog" aria-modal="true">
        <div
          className="modal-card modal-lg"
          style={{
            maxHeight: "90vh",
            width: "min(960px, 100%)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div className="modal-header">{editing ? "Edit Job" : "Create Job"}</div>

          <div
            className="modal-body"
            style={{
              display: "grid",
              gap: 12,
              padding: 16,
              overflowY: "auto",
              flex: 1,
            }}
          >
            {/* Basics */}
            <div className="card" style={{ padding: 12 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>Title</div>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>Venue</div>
                  <input value={venue} onChange={(e) => setVenue(e.target.value)} />
                </div>
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Description</div>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </div>
            </div>

            {/* Session FIRST */}
            <div className="card" style={{ padding: 12 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    sessionMode === "physical" ? "repeat(2, minmax(0, 1fr))" : "1fr",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>Session Type</div>
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
                    <div style={{ fontSize: 12, fontWeight: 600 }}>Physical Subtype</div>
                    <select
                      value={physicalType}
                      onChange={(e) => setPhysicalType(e.target.value)}
                    >
                      <option value="half_day">Half Day</option>
                      <option value="full_day">Full Day</option>
                      <option value="2d1n">2D1N</option>
                      <option value="3d2n">3D2N</option>
                      <option value="hourly_by_role">Hourly (by role)</option>
                      <option value="hourly_flat">Backend (flat hourly for all)</option>
                    </select>
                  </div>
                )}
              </div>
            </div>

            {/* Transport (ONLY for physical) */}
            {sessionMode === "physical" && (
              <div className="card" style={{ padding: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>Transport options</div>
                <div
                  className="transport-options"
                  style={{ marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap" }}
                >
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={optBus}
                      onChange={(e) => setOptBus(e.target.checked)}
                    />{" "}
                    ATAG Transport
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={optOwn}
                      onChange={(e) => setOptOwn(e.target.checked)}
                    />{" "}
                    Own Transport
                  </label>
                </div>

                {optBus && (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.2fr)",
                      gap: 12,
                      marginTop: 8,
                      alignItems: "flex-end",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>
                        Parking Allowance (RM)
                      </div>
                      <input
                        inputMode="decimal"
                        value={parkingAmount}
                        onChange={(e) => setParkingAmount(e.target.value)}
                      />
                    </div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                      Applied to every person who selects <b>ATAG Transport</b>.
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Dates & Times */}
            <DatesBlock
              sessionMode={sessionMode}
              physicalType={physicalType}
              dateStart={dateStart}
              dateEnd={dateEnd}
              timeStart={timeStart}
              timeEnd={timeEnd}
              dateStartRef={dateStartRef}
              dateEndRef={dateEndRef}
              timeStartRef={timeStartRef}
              timeEndRef={timeEndRef}
            />

            {/* Headcount */}
            <div className="card" style={{ padding: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Headcount</div>
              <input
                value={headcount}
                onChange={(e) => setHeadcount(e.target.value)}
                inputMode="numeric"
                style={{ maxWidth: 240 }}
              />
              <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
                Target number of people to hire. Everyone can apply — PM/Admin approval is
                still required for each person.
              </div>
            </div>

            {/* Payments */}
            <PaymentBlock
              sessionMode={sessionMode}
              physicalType={physicalType}
              hrJr={hrJr}
              setHrJr={setHrJr}
              hrJrOT={hrJrOT}
              setHrJrOT={setHrJrOT}
              hrSr={hrSr}
              setHrSr={setHrSr}
              hrSrOT={hrSrOT}
              setHrSrOT={setHrSrOT}
              hrLead={hrLead}
              setHrLead={setHrLead}
              hrLeadOT={hrLeadOT}
              setHrLeadOT={setHrLeadOT}
              flatRate={flatRate}
              setFlatRate={setFlatRate}
              flatOT={flatOT}
              setFlatOT={setFlatOT}
              pHalfJr={pHalfJr}
              setPHalfJr={setPHalfJr}
              pHalfSr={pHalfSr}
              setPHalfSr={setPHalfSr}
              pHalfLead={pHalfLead}
              setPHalfLead={setPHalfLead}
              pFullJr={pFullJr}
              setPFullJr={setPFullJr}
              pFullSr={pFullSr}
              setPFullSr={setPFullSr}
              pFullLead={pFullLead}
              setPFullLead={setPFullLead}
              p2d1nJr={p2d1nJr}
              setP2d1nJr={setP2d1nJr}
              p2d1nSr={p2d1nSr}
              setP2d1nSr={setP2d1nSr}
              p2d1nLead={p2d1nLead}
              setP2d1nLead={setP2d1nLead}
              p3d2nJr={p3d2nJr}
              setP3d2nJr={setP3d2nJr}
              p3d2nSr={p3d2nSr}
              setP3d2nSr={setP3d2nSr}
              p3d2nLead={p3d2nLead}
              setP3d2nLead={setP3d2nLead}
              hourlyAddon={hourlyAddon}
              setHourlyAddon={setHourlyAddon}
            />

            {/* Event extras (AFTER Session payment) */}
            {sessionMode === "physical" && (
              <div className="card" style={{ padding: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Event extras (Physical)</div>

                {/* Early Call – amount only */}
                <div style={{ marginBottom: 16 }}>
                  <label
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={ecEnabled}
                      onChange={(e) => setEcEnabled(e.target.checked)}
                    />
                    <span style={{ fontWeight: 600 }}>Enable Early Call</span>
                  </label>

                  {ecEnabled && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 200px)",
                        gap: 12,
                        marginBottom: 6,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>
                          Early Call Amount (RM)
                        </div>
                        <input
                          value={ecAmount}
                          onChange={(e) => setEcAmount(e.target.value)}
                          inputMode="decimal"
                        />
                      </div>
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    Flat stipend paid for earlier reporting time (amount per person).
                  </div>
                </div>

                {/* Loading & Unloading */}
                <div>
                  <label
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={luEnabled}
                      onChange={(e) => setLuEnabled(e.target.checked)}
                    />
                    <span style={{ fontWeight: 600 }}>Enable Loading &amp; Unloading</span>
                  </label>

                  {luEnabled && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(160px, minmax(0, 1fr)))",
                        gap: 12,
                        marginBottom: 6,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>Helper Pay (RM)</div>
                        <input
                          value={luPrice}
                          onChange={(e) => setLuPrice(e.target.value)}
                          inputMode="decimal"
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>Quota (pax)</div>
                        <input
                          value={luQuota}
                          onChange={(e) => setLuQuota(e.target.value)}
                          inputMode="numeric"
                        />
                      </div>
                      <div style={{ alignSelf: "end", fontSize: 12, color: "#6b7280" }}>
                        PM confirms who actually helped during check-out.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div
            className="modal-footer"
            style={{
              padding: 12,
              borderTop: "1px solid #e5e7eb",
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              background: "#fff",
              flexShrink: 0,
            }}
          >
            <button className="btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button className="btn primary" onClick={onSave} disabled={busy}>
              {busy ? (editing ? "Saving…" : "Creating…") : editing ? "Save changes" : "Create job"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
