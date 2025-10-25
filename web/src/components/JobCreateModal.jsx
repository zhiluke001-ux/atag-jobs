// web/src/components/JobCreateModal.jsx
import React, { useEffect, useMemo, useState } from "react";
import { apiPost } from "../api";

/**
 * Props
 * - open: boolean
 * - initial?: job object (for edit)
 * - onClose(): void
 * - onSaved(job): void
 */
const ROLES = ["junior", "senior", "leadHost"]; // display labels below

const roleLabel = {
  junior: "Junior",
  senior: "Senior",
  leadHost: "Lead Host",
};

const emptyHourly = () =>
  ROLES.reduce((m, r) => {
    m[r] = { rate: "", minHours: "", otAfterHour: "", otRatePerHour: "", breakDeductHour: "" };
    return m;
  }, {});

export default function JobCreateModal({ open, initial, onClose, onSaved }) {
  const isEdit = !!initial;

  // ---------- core fields ----------
  const [title, setTitle] = useState(initial?.title || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [venue, setVenue] = useState(initial?.venue || "");

  // Date & time split (UX you asked)
  const [date, setDate] = useState(initial ? new Date(initial.startTime).toISOString().slice(0, 10) : "");
  const [timeStart, setTimeStart] = useState(initial ? new Date(initial.startTime).toISOString().slice(11, 16) : "");
  const [timeEnd, setTimeEnd] = useState(initial ? new Date(initial.endTime).toISOString().slice(11, 16) : "");

  // session
  const [sessionType, setSessionType] = useState(initial?.session?.type || "virtual"); // "virtual" | "physical"
  const [physicalKind, setPhysicalKind] = useState(initial?.session?.physicalKind || "halfDay"); // Half Day, Full Day, 2D1N, 3D2N

  // transport
  const [transport, setTransport] = useState(() => {
    const t = initial?.transportOptions || {};
    return { atagTransport: !!t.atagTransport, ownTransport: !!t.ownTransport };
  });

  // parking allowance (only when ATAG Transport checked)
  const [parkingAllowance, setParkingAllowance] = useState(() => {
    const a = initial?.allowances?.parking;
    return { enabled: !!a?.enabled, amount: a?.amount ?? "" };
  });

  // pricing
  const [pricing, setPricing] = useState(() => {
    const p = initial?.pricing || {};
    return {
      // Hourly — now includes the extras you requested
      hourly: p.hourly || emptyHourly(),
      // Physical sessions, one price per role per type
      halfDay: p.halfDay || { junior: "", senior: "", leadHost: "" },
      fullDay: p.fullDay || { junior: "", senior: "", leadHost: "" },
      twoDOneN: p.twoDOneN || { junior: "", senior: "", leadHost: "" },
      threeDTwoN: p.threeDTwoN || { junior: "", senior: "", leadHost: "" },
    };
  });

  // show/hide parking allowance dynamically
  useEffect(() => {
    if (!transport.atagTransport) {
      setParkingAllowance((p) => ({ ...p, enabled: false })); // hide & disable when not ATAG Transport
    } else {
      setParkingAllowance((p) => ({ ...p, enabled: true })); // auto-enable on select
    }
  }, [transport.atagTransport]);

  function updateHourly(role, key, value) {
    setPricing((prev) => ({
      ...prev,
      hourly: {
        ...prev.hourly,
        [role]: { ...prev.hourly[role], [key]: value },
      },
    }));
  }

  function updatePhysical(which, role, value) {
    setPricing((prev) => ({
      ...prev,
      [which]: { ...prev[which], [role]: value },
    }));
  }

  const disableTimeMirror = useMemo(() => {
    // your rule: Virtual: single date; Physical Half/Full Day: single date; 2D1N/3D2N use same date + next day(s)
    return true; // we keep one date input; times use separate start/end inputs already
  }, []);

  async function save() {
    if (!title || !date || !timeStart || !timeEnd) {
      alert("Please fill in title, date, start & end time.");
      return;
    }

    const startTime = new Date(`${date}T${timeStart}:00`);
    const endTime = new Date(`${date}T${timeEnd}:00`);

    // session payload
    const session = { type: sessionType };
    if (sessionType === "physical") session.physicalKind = physicalKind;

    const payload = {
      ...(isEdit ? { id: initial.id } : {}),
      title,
      description,
      venue,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      session,
      transportOptions: { ...transport }, // { atagTransport, ownTransport }
      allowances: {
        parking: transport.atagTransport
          ? { enabled: !!parkingAllowance.enabled, amount: Number(parkingAllowance.amount || 0) }
          : { enabled: false, amount: 0 },
      },
      pricing,
    };

    const url = isEdit ? `/jobs/${initial.id}/edit` : "/jobs/create";
    const saved = await apiPost(url, payload);
    onSaved?.(saved);
    onClose?.();
  }

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ width: "min(860px, 96vw)" }}>
        <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 12 }}>
          {isEdit ? "Edit Job" : "Create Job"}
        </div>

        {/* Basics */}
        <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 12 }}>
          <label>
            <div>Title</div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Expo Registration Desk" />
          </label>

          <label>
            <div>Description</div>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </label>

          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label>
              <div>Date</div>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              <div>Venue</div>
              <input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="MITEC Level 1, Hall A" />
            </label>
          </div>

          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <label>
              <div>Start Time</div>
              <input type="time" value={timeStart} onChange={(e) => setTimeStart(e.target.value)} />
            </label>
            <label>
              <div>End Time</div>
              <input type="time" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} />
            </label>
          </div>
        </div>

        {/* Session Type */}
        <div className="card" style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Session Type</div>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <label><input type="radio" name="stype" checked={sessionType === "virtual"} onChange={() => setSessionType("virtual")} /> Virtual</label>
            <label><input type="radio" name="stype" checked={sessionType === "physical"} onChange={() => setSessionType("physical")} /> Physical</label>

            {sessionType === "physical" && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ marginLeft: 10, fontWeight: 600 }}>Physical session:</span>
                <select value={physicalKind} onChange={(e) => setPhysicalKind(e.target.value)}>
                  <option value="halfDay">Half Day</option>
                  <option value="fullDay">Full Day</option>
                  <option value="twoDOneN">2D1N</option>
                  <option value="threeDTwoN">3D2N</option>
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Transport Options */}
        <div className="card" style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Transport Options</div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={transport.atagTransport}
                onChange={(e) => setTransport((t) => ({ ...t, atagTransport: e.target.checked }))}
              />
              <span>ATAG Transport</span>
            </label>
            <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={transport.ownTransport}
                onChange={(e) => setTransport((t) => ({ ...t, ownTransport: e.target.checked }))}
              />
              <span>Own Transport</span>
            </label>
          </div>

          {/* Parking Allowance appears only when ATAG Transport is selected */}
          {transport.atagTransport && (
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
              <label>
                <div>Parking Allowance (RM)</div>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={parkingAllowance.amount}
                  onChange={(e) => setParkingAllowance({ enabled: true, amount: e.target.value })}
                />
              </label>
              <div style={{ alignSelf: "end", color: "#6b7280" }}>
                This allowance applies to every person who selects <b>ATAG Transport</b>.
              </div>
            </div>
          )}
        </div>

        {/* Pricing */}
        <div className="card" style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Payment</div>

          {/* Hourly — always shown, your new fields included */}
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Hourly (Virtual or Physical by hours)</div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: "#6b7280" }} />
            <div style={{ fontSize: 12, color: "#6b7280" }}>Rate (RM/hr)</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>Min hours</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>OT starts after (hr)</div>
            <div style={{ fontSize: 12, color: "#6b7280" }}>OT rate (RM/hr)</div>
          </div>
          {ROLES.map((r) => (
            <div key={r} className="grid" style={{ gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", fontWeight: 600 }}>{roleLabel[r]}</div>
              <input type="number" min="0" step="1" value={pricing.hourly[r].rate} onChange={(e) => updateHourly(r, "rate", e.target.value)} />
              <input type="number" min="0" step="0.5" value={pricing.hourly[r].minHours} onChange={(e) => updateHourly(r, "minHours", e.target.value)} />
              <input type="number" min="0" step="0.5" value={pricing.hourly[r].otAfterHour} onChange={(e) => updateHourly(r, "otAfterHour", e.target.value)} />
              <input type="number" min="0" step="1" value={pricing.hourly[r].otRatePerHour} onChange={(e) => updateHourly(r, "otRatePerHour", e.target.value)} />
            </div>
          ))}
          {/* break deduction row */}
          <div className="grid" style={{ gridTemplateColumns: "1fr repeat(4, 1fr)", gap: 8, marginTop: 6 }}>
            <div style={{ display: "flex", alignItems: "center", fontWeight: 600 }}>Break deduction (hr)</div>
            {ROLES.map((r) => (
              <input
                key={r}
                type="number"
                min="0"
                step="0.25"
                value={pricing.hourly[r].breakDeductHour}
                onChange={(e) => updateHourly(r, "breakDeductHour", e.target.value)}
              />
            ))}
          </div>

          {/* Physical sessions — only show the one selected */}
          {sessionType === "physical" && (
            <>
              <div style={{ fontWeight: 600, margin: "14px 0 6px" }}>
                {physicalKind === "halfDay" && "Half Day (RM / session)"}
                {physicalKind === "fullDay" && "Full Day (RM / session)"}
                {physicalKind === "twoDOneN" && "2D1N (RM / session)"}
                {physicalKind === "threeDTwoN" && "3D2N (RM / session)"}
              </div>
              <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                <label>
                  <div>Junior</div>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={pricing[physicalKind].junior}
                    onChange={(e) => updatePhysical(physicalKind, "junior", e.target.value)}
                  />
                </label>
                <label>
                  <div>Senior</div>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={pricing[physicalKind].senior}
                    onChange={(e) => updatePhysical(physicalKind, "senior", e.target.value)}
                  />
                </label>
                <label>
                  <div>Lead Host</div>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={pricing[physicalKind].leadHost}
                    onChange={(e) => updatePhysical(physicalKind, "leadHost", e.target.value)}
                  />
                </label>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>{isEdit ? "Save changes" : "Create job"}</button>
        </div>
      </div>
    </div>
  );
}
