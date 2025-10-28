// web/src/components/JobCreateModal.jsx
import React, { useMemo, useState } from "react";
import dayjs from "dayjs";
import { apiPost } from "../api";

/**
 * Props:
 * - onClose()
 * - onCreated?(job)
 */
const Card = ({ title, children, style }) => (
  <div className="card" style={{ padding: 12, borderRadius: 12, ...style }}>
    {title && <div style={{ fontWeight: 800, marginBottom: 8 }}>{title}</div>}
    {children}
  </div>
);

const Row2 = ({ children }) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>{children}</div>
);

const Field = ({ label, children, hint }) => (
  <div className="card" style={{ padding: 10 }}>
    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#374151" }}>{label}</div>
    {children}
    {hint ? <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>{hint}</div> : null}
  </div>
);

const money = (n) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

export default function JobCreateModal({ onClose, onCreated }) {
  // Step 1 — basics
  const [title, setTitle] = useState("");
  const [venue, setVenue] = useState("");
  const [description, setDescription] = useState("");
  const basicsOK = title.trim() && venue.trim();

  // Dates / times & headcount
  const [startDate, setStartDate] = useState(dayjs().format("YYYY-MM-DD"));
  const [startTime, setStartTime] = useState("09:00");
  const [endDate, setEndDate] = useState(dayjs().add(1, "hour").format("YYYY-MM-DD"));
  const [endTime, setEndTime] = useState("12:00");
  const [headcount, setHeadcount] = useState(5);

  // Step 2 — session type
  const [sessionType, setSessionType] = useState(""); // "physical" | "virtual"
  const isVirtual = sessionType === "virtual";
  const sessionOK = basicsOK && (sessionType === "physical" || sessionType === "virtual");

  // Step 3 — physical subtype (if physical)
  const [physicalSubtype, setPhysicalSubtype] = useState(""); // half_day, full_day, 2d1n, 3d2n, hourly_by_role, hourly_flat
  const physicalOK = sessionOK && (isVirtual || (!!physicalSubtype && sessionType === "physical"));

  // Step 4 — physical-only options
  const [transportBus, setTransportBus] = useState(false);
  const [transportOwn, setTransportOwn] = useState(false);
  const [parkingAllowance, setParkingAllowance] = useState("");

  const [ecEnabled, setEcEnabled] = useState(false);
  const [ecAmount, setEcAmount] = useState("");
  const [ecThresholdHours, setEcThresholdHours] = useState("2");

  const [luEnabled, setLuEnabled] = useState(false);
  const [luQuota, setLuQuota] = useState("0");
  const [luPrice, setLuPrice] = useState("");

  // Scanner defaults
  const [scanMaxMeters, setScanMaxMeters] = useState(500);

  // Pay settings (simple / minimal)
  // For hourly_by_role OR virtual: per-tier hourly + OT
  const [jrBase, setJrBase] = useState("");
  const [jrOT, setJrOT] = useState("");
  const [srBase, setSrBase] = useState("");
  const [srOT, setSrOT] = useState("");
  const [leadBase, setLeadBase] = useState("");
  const [leadOT, setLeadOT] = useState("");

  // For hourly_flat (backend flat hourly)
  const [flatBase, setFlatBase] = useState("");
  const [flatOT, setFlatOT] = useState("");

  // For session payments (half/full/2d1n/3d2n)
  const [jrSession, setJrSession] = useState("");
  const [srSession, setSrSession] = useState("");
  const [leadSession, setLeadSession] = useState("");

  const startISO = useMemo(
    () => dayjs(`${startDate}T${startTime}`).toISOString(),
    [startDate, startTime]
  );
  const endISO = useMemo(
    () => dayjs(`${endDate}T${endTime}`).toISOString(),
    [endDate, endTime]
  );

  function buildRate() {
    // Build according to selected mode/kind
    if (isVirtual || physicalSubtype === "hourly_by_role") {
      return {
        sessionKind: isVirtual ? "virtual" : "hourly_by_role",
        tierRates: {
          junior: { base: money(jrBase) || undefined, otRatePerHour: money(jrOT) || undefined },
          senior: { base: money(srBase) || undefined, otRatePerHour: money(srOT) || undefined },
          lead:   { base: money(leadBase) || undefined, otRatePerHour: money(leadOT) || undefined },
        },
        parkingAllowance: money(parkingAllowance) || undefined,
      };
    }
    if (physicalSubtype === "hourly_flat") {
      return {
        sessionKind: "hourly_flat",
        flatHourly: {
          base: money(flatBase) || undefined,
          otRatePerHour: money(flatOT) || undefined,
        },
        parkingAllowance: money(parkingAllowance) || undefined,
      };
    }
    if (["half_day", "full_day", "2d1n", "3d2n"].includes(physicalSubtype)) {
      const key =
        physicalSubtype === "half_day"
          ? "halfDay"
          : physicalSubtype === "full_day"
          ? "fullDay"
          : physicalSubtype === "2d1n"
          ? "twoD1N"
          : "threeD2N";
      return {
        sessionKind: physicalSubtype,
        tierRates: {
          junior: { [key]: money(jrSession) || undefined },
          senior: { [key]: money(srSession) || undefined },
          lead:   { [key]: money(leadSession) || undefined },
        },
        parkingAllowance: money(parkingAllowance) || undefined,
      };
    }
    // Fallback
    return { sessionKind: isVirtual ? "virtual" : "half_day" };
  }

  async function handleCreate() {
    const payload = {
      title: title.trim(),
      venue: venue.trim(),
      description: description.trim(),
      startTime: startISO,
      endTime: endISO,
      headcount: Number(headcount) || 0,

      // Session structure
      session: {
        mode: isVirtual ? "virtual" : "physical",
        physicalType: isVirtual ? undefined : physicalSubtype || undefined,
      },

      // Display helpers to match your readers
      mode: isVirtual ? "virtual" : "physical",
      sessionMode: isVirtual ? "virtual" : "physical",
      physicalSubtype: isVirtual ? undefined : physicalSubtype || undefined,

      // Conditional blocks
      transportOptions: isVirtual
        ? undefined
        : {
            bus: !!transportBus,
            own: !!transportOwn,
          },

      earlyCall: isVirtual
        ? undefined
        : {
            enabled: !!ecEnabled,
            amount: money(ecAmount) || 0,
            thresholdHours: Number(ecThresholdHours) || 0,
          },

      loadingUnload: isVirtual
        ? undefined
        : {
            enabled: !!luEnabled,
            quota: Number(luQuota) || 0,
            price: money(luPrice) || 0,
          },

      // Scan guard only matters for physical
      scanRequired: !isVirtual,
      scanMaxMeters: Number(scanMaxMeters) || 500,

      // Pay setup
      rate: buildRate(),
    };

    const created = await apiPost("/jobs", payload);
    if (onCreated) onCreated(created);
    onClose?.();
  }

  const canSubmit = basicsOK && sessionOK && physicalOK;

  return (
    <div className="modal-overlay">
      <div className="modal card" style={{ width: 900, maxWidth: "95vw" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Create Job</div>
          <button className="btn gray" onClick={onClose}>Close</button>
        </div>

        {/* Step 1 — Basics */}
        <Card title="1) Basics" style={{ marginTop: 10 }}>
          <Row2>
            <Field label="Title">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Event name / role…" />
            </Field>
            <Field label="Venue">
              <input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Where is it?" />
            </Field>
          </Row2>

          <Field label="Description">
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief details for part-timers…"
            />
          </Field>

          <Row2>
            <Field label="Start (date)">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="Start (time)">
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
          </Row2>
          <Row2>
            <Field label="End (date)">
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
            <Field label="End (time)">
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </Field>
          </Row2>

          <Field label="Headcount">
            <input
              type="number"
              min="0"
              value={headcount}
              onChange={(e) => setHeadcount(e.target.value)}
            />
          </Field>
        </Card>

        {/* Step 2 — Session Type */}
        {basicsOK && (
          <Card title="2) Session Type" style={{ marginTop: 10 }}>
            <div style={{ display: "flex", gap: 16 }}>
              <label>
                <input
                  type="radio"
                  name="sessionType"
                  checked={sessionType === "physical"}
                  onChange={() => setSessionType("physical")}
                />{" "}
                Physical
              </label>
              <label>
                <input
                  type="radio"
                  name="sessionType"
                  checked={sessionType === "virtual"}
                  onChange={() => setSessionType("virtual")}
                />{" "}
                Virtual
              </label>
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
              Transport, Early Call, and Loading &amp; Unloading are **physical only** and will be hidden for Virtual jobs.
            </div>
          </Card>
        )}

        {/* Step 3 — Physical subtype */}
        {sessionOK && !isVirtual && (
          <Card title="3) Physical Subtype" style={{ marginTop: 10 }}>
            <Row2>
              <Field label="Subtype">
                <select value={physicalSubtype} onChange={(e) => setPhysicalSubtype(e.target.value)}>
                  <option value="">-- choose --</option>
                  <option value="half_day">Half Day</option>
                  <option value="full_day">Full Day</option>
                  <option value="2d1n">2D1N</option>
                  <option value="3d2n">3D2N</option>
                  <option value="hourly_by_role">Hourly (by role)</option>
                  <option value="hourly_flat">Backend (flat hourly)</option>
                </select>
              </Field>

              <Field label="Scan distance guard (meters)" hint="Default 500m; enforced at server too.">
                <input
                  type="number"
                  min="100"
                  value={scanMaxMeters}
                  onChange={(e) => setScanMaxMeters(e.target.value)}
                />
              </Field>
            </Row2>
          </Card>
        )}

        {/* Step 4 — Physical-only: Transport + Allowances + Early Call + L&U */}
        {physicalOK && !isVirtual && (
          <Card title="4) Physical Options" style={{ marginTop: 10 }}>
            <Field label="Transport options">
              <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                <label>
                  <input type="checkbox" checked={transportBus} onChange={(e) => setTransportBus(e.target.checked)} /> ATAG Bus
                </label>
                <label>
                  <input type="checkbox" checked={transportOwn} onChange={(e) => setTransportOwn(e.target.checked)} /> Own Transport
                </label>
              </div>
            </Field>

            <Row2>
              <Field label="Parking allowance (RM per person)">
                <input
                  type="number"
                  min="0"
                  value={parkingAllowance}
                  onChange={(e) => setParkingAllowance(e.target.value)}
                  placeholder="e.g., 10"
                />
              </Field>
              <div />
            </Row2>

            <Row2>
              <Field label="Early Call">
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <label>
                    <input type="checkbox" checked={ecEnabled} onChange={(e) => setEcEnabled(e.target.checked)} /> Enable
                  </label>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span>Amount</span>
                    <input
                      type="number"
                      min="0"
                      value={ecAmount}
                      onChange={(e) => setEcAmount(e.target.value)}
                      placeholder="RM per person"
                      disabled={!ecEnabled}
                      style={{ width: 140 }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span>Threshold (hours)</span>
                    <input
                      type="number"
                      min="0"
                      value={ecThresholdHours}
                      onChange={(e) => setEcThresholdHours(e.target.value)}
                      disabled={!ecEnabled}
                      style={{ width: 100 }}
                    />
                  </div>
                </div>
              </Field>

              <Field label="Loading & Unloading">
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <label>
                    <input type="checkbox" checked={luEnabled} onChange={(e) => setLuEnabled(e.target.checked)} /> Enable
                  </label>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span>Quota</span>
                    <input
                      type="number"
                      min="0"
                      value={luQuota}
                      onChange={(e) => setLuQuota(e.target.value)}
                      disabled={!luEnabled}
                      style={{ width: 100 }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span>Amount (RM / person)</span>
                    <input
                      type="number"
                      min="0"
                      value={luPrice}
                      onChange={(e) => setLuPrice(e.target.value)}
                      disabled={!luEnabled}
                      style={{ width: 140 }}
                    />
                  </div>
                </div>
              </Field>
            </Row2>
          </Card>
        )}

        {/* Step 5 — Pay (after session + physical options) */}
        {sessionOK && (
          <Card title="5) Pay Settings" style={{ marginTop: 10 }}>
            {(isVirtual || physicalSubtype === "hourly_by_role") && (
              <>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Per-tier hourly (Virtual / Hourly by role)</div>
                <Row2>
                  <Field label="Junior (base / hr)">
                    <input type="number" min="0" value={jrBase} onChange={(e) => setJrBase(e.target.value)} />
                  </Field>
                  <Field label="Junior OT (per hr)">
                    <input type="number" min="0" value={jrOT} onChange={(e) => setJrOT(e.target.value)} />
                  </Field>
                </Row2>
                <Row2>
                  <Field label="Senior (base / hr)">
                    <input type="number" min="0" value={srBase} onChange={(e) => setSrBase(e.target.value)} />
                  </Field>
                  <Field label="Senior OT (per hr)">
                    <input type="number" min="0" value={srOT} onChange={(e) => setSrOT(e.target.value)} />
                  </Field>
                </Row2>
                <Row2>
                  <Field label="Lead (base / hr)">
                    <input type="number" min="0" value={leadBase} onChange={(e) => setLeadBase(e.target.value)} />
                  </Field>
                  <Field label="Lead OT (per hr)">
                    <input type="number" min="0" value={leadOT} onChange={(e) => setLeadOT(e.target.value)} />
                  </Field>
                </Row2>
              </>
            )}

            {physicalSubtype === "hourly_flat" && (
              <>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Backend (flat hourly)</div>
                <Row2>
                  <Field label="Flat base (RM / hr)">
                    <input type="number" min="0" value={flatBase} onChange={(e) => setFlatBase(e.target.value)} />
                  </Field>
                  <Field label="Flat OT (RM / hr)">
                    <input type="number" min="0" value={flatOT} onChange={(e) => setFlatOT(e.target.value)} />
                  </Field>
                </Row2>
              </>
            )}

            {["half_day", "full_day", "2d1n", "3d2n"].includes(physicalSubtype) && (
              <>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Session payment (per person)</div>
                <Row2>
                  <Field label="Junior">
                    <input type="number" min="0" value={jrSession} onChange={(e) => setJrSession(e.target.value)} />
                  </Field>
                  <Field label="Senior">
                    <input type="number" min="0" value={srSession} onChange={(e) => setSrSession(e.target.value)} />
                  </Field>
                </Row2>
                <Row2>
                  <Field label="Lead">
                    <input type="number" min="0" value={leadSession} onChange={(e) => setLeadSession(e.target.value)} />
                  </Field>
                  <div />
                </Row2>
              </>
            )}

            {(!isVirtual && !physicalSubtype) && (
              <div style={{ color: "#6b7280", fontSize: 13 }}>
                Choose a physical subtype to reveal the corresponding pay inputs.
              </div>
            )}
          </Card>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button className="btn gray" onClick={onClose}>Cancel</button>
          <button className="btn red" disabled={!canSubmit} onClick={handleCreate}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
