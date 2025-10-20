// web/src/pages/Admin.jsx
import React, { useEffect, useState } from "react";
import { apiGet, apiPost, apiGetBlob, apiPatch } from "../api";

function money(n) {
  if (isNaN(n)) return "RM0";
  return "RM" + Math.round(n);
}

export default function Admin({ navigate, user }) {
  const [jobs, setJobs] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedJob, setSelectedJob] = useState(null);
  const [error, setError] = useState("");

  // ----- Rate + extras state -----
  const [payMode, setPayMode] = useState("hourly"); // hourly | specific | specific_plus_hourly

  // store text to avoid "1 digit only" glitch and spinners
  const [paymentPrice, setPaymentPrice] = useState(""); // (string)
  const [baseRate, setBaseRate] = useState("15");       // (string)
  const [transportAllowance, setTransportAllowance] = useState("0"); // (string)

  // L&U (optional)
  const [lduEnabled, setLduEnabled] = useState(false);
  const [lduPrice, setLduPrice] = useState("30");

  // Early Call
  const [earlyCallEnabled, setEarlyCallEnabled] = useState(false);
  const [earlyCallAmount, setEarlyCallAmount] = useState("20");
  const [earlyCallThreshold, setEarlyCallThreshold] = useState("3"); // hours

  // Payroll rows + summary
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({ employees: 0, hours: 0, wages: 0, jobs: 0 });

  // Load jobs
  useEffect(() => {
    if (user?.role !== "admin") return;
    apiGet("/jobs").then((j) => setJobs(j || [])).catch((e) => setError(String(e)));
  }, [user]);

  // Load job details when selected
  useEffect(() => {
    if (!selectedId) { setSelectedJob(null); return; }
    apiGet(`/jobs/${selectedId}`)
      .then((j) => {
        setSelectedJob(j);
        const r = j.rate || {};

        setPayMode(r.payMode || "hourly");

        // initialise strings
        const sess = Number.isFinite(r.paymentPrice)
          ? r.paymentPrice
          : (Number.isFinite(r.specificPayment) ? r.specificPayment : 0);
        setPaymentPrice(String(sess ?? ""));

        setBaseRate(String(Number.isFinite(r.base) ? r.base : 15));
        const ta = Number.isFinite(r.transportBus)
          ? r.transportBus
          : (Number.isFinite(r.transportAllowance) ? r.transportAllowance : 0);
        setTransportAllowance(String(ta));

        // L&U
        const lduOn = (j?.loadingUnload && typeof j.loadingUnload.enabled === "boolean")
          ? j.loadingUnload.enabled
          : ((Number(j?.loadingUnload?.price) || 0) > 0 || (Number(j?.loadingUnload?.quota) || 0) > 0);
        setLduEnabled(lduOn);
        setLduPrice(String(j?.loadingUnload?.price ?? r.lduPrice ?? 30));

        // Early call
        setEarlyCallEnabled(!!j?.earlyCall?.enabled);
        setEarlyCallAmount(String(j?.earlyCall?.amount ?? r.earlyCallAmount ?? 20));
        setEarlyCallThreshold(String(j?.earlyCall?.thresholdHours ?? r.earlyCallThresholdHours ?? 3));
      })
      .catch((e) => setError(String(e)));
  }, [selectedId]);

  if (!user || user.role !== "admin") {
    return (
      <div className="container">
        <div className="card">Admin only.</div>
      </div>
    );
  }

  async function saveRates() {
    if (!selectedJob) return;
    try {
      // Persist core / rate fields
      await apiPost(`/jobs/${selectedJob.id}/rate`, {
        base: payMode !== "specific" ? Number(baseRate || 0) : undefined,
        transportBus: Number(transportAllowance || 0),
        payMode: String(payMode),
        specificPayment: (payMode !== "hourly") ? Number(paymentPrice || 0) : undefined,

        // extras
        lduPrice: Number(lduPrice || 0),
        lduEnabled: !!lduEnabled,
        earlyCallAmount: Number(earlyCallAmount || 0),
        earlyCallThresholdHours: Number(earlyCallThreshold || 0),
      });

      // Mirror to job blocks (authoritative for feature toggles)
      await apiPatch(`/jobs/${selectedJob.id}`, {
        ldu: {
          enabled: !!lduEnabled,
          quota: Number(selectedJob?.loadingUnload?.quota ?? 0),
          price: Number(lduPrice || 0),
        },
        earlyCall: {
          enabled: !!earlyCallEnabled,
          amount: Number(earlyCallAmount || 0),
          thresholdHours: Number(earlyCallThreshold || 0),
        },
        rate: {
          lduPrice: Number(lduPrice || 0),
          lduEnabled: !!lduEnabled,
          earlyCallAmount: Number(earlyCallAmount || 0),
          earlyCallThresholdHours: Number(earlyCallThreshold || 0),
          paymentPrice: (payMode !== "hourly") ? Number(paymentPrice || 0) : undefined,
          specificPayment: (payMode !== "hourly") ? Number(paymentPrice || 0) : undefined,
        },
      });

      alert("Saved");
    } catch (e) {
      alert("Save failed: " + e);
    }
  }

  function calcWages() {
    if (!selectedJob) return;

    const approvedSet = new Set(selectedJob.approved || []);
    const apps = selectedJob.applications || [];
    const byUserTransport = new Map();
    apps.forEach((a) => byUserTransport.set(a.userId, a.transport || "Own Transport"));

    const att = selectedJob.attendance || {};
    const outRows = [];

    const lduHelpers = new Set((selectedJob.loadingUnload && selectedJob.loadingUnload.participants) || []);

    Object.keys(att).forEach((userId) => {
      if (!approvedSet.has(userId)) return;
      const rec = att[userId] || {};
      if (!rec.in || !rec.out) return;

      const start = new Date(rec.in).getTime();
      const end = new Date(rec.out).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;

      let hours = (end - start) / 3600000;
      const base = Number(baseRate || 0);

      let wage = 0;
      if (payMode === "hourly") wage = hours * base;
      else if (payMode === "specific") wage = Number(paymentPrice || 0);
      else wage = Number(paymentPrice || 0) + hours * base;

      // Transport allowance (bus only)
      const transport = byUserTransport.get(userId) || "Own Transport";
      if (transport === "ATAG Bus") wage += Number(transportAllowance || 0);

      // Early call (flat add if enabled)
      if (earlyCallEnabled) wage += Number(earlyCallAmount || 0);

      // L&U (add only when enabled AND helper is ticked)
      if (lduEnabled && lduHelpers.has(userId)) wage += Number(lduPrice || 0);

      outRows.push({
        userId,
        employee: (selectedJob.applications.find((a) => a.userId === userId)?.email) || userId,
        jobTitle: selectedJob.title,
        hours: Number(hours.toFixed(2)),
        transport,
        wage,
      });
    });

    const employees = outRows.length;
    const hoursSum = outRows.reduce((s, r) => s + r.hours, 0);
    const wagesSum = outRows.reduce((s, r) => s + r.wage, 0);
    setRows(outRows);
    setSummary({ employees, hours: hoursSum, wages: wagesSum, jobs: 1 });
  }

  async function exportPayrollCSV() {
    if (!rows.length) { alert("No rows to export. Click Calculate Wages first."); return; }
    const headers = ["Employee", "Job", "Hours", "Transport", "Wage"];
    const lines = [headers.join(",")];
    rows.forEach((r) => {
      const line = [
        `"${r.employee.replace(/"/g, '""')}"`,
        `"${r.jobTitle.replace(/"/g, '""')}"`,
        r.hours,
        `"${r.transport}"`,
        Math.round(r.wage),
      ].join(",");
      lines.push(line);
    });
    lines.push("");
    lines.push(`Total Employees,${summary.employees}`);
    lines.push(`Total Hours,${summary.hours.toFixed(2)}`);
    lines.push(`Total Wages,${Math.round(summary.wages)}`);
    lines.push(`Jobs Included,${summary.jobs}`);

    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-${selectedJob?.id || "all"}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  async function downloadJobCSV(jobId) {
    try {
      const blob = await apiGetBlob(`/jobs/${jobId}/csv`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `job-${jobId}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Download failed: " + e);
    }
  }

  // ---- tiny UI helpers ----
  const Field = ({ label, children }) => (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#374151" }}>{label}</div>
      {children}
    </div>
  );
  const Toggle = ({ id, checked, onChange, text }) => (
    <label htmlFor={id} style={{ display: "inline-flex", alignItems: "center", gap: 8, userSelect: "none" }}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{text}</span>
    </label>
  );

  return (
    <div className="container">
      {error && (
        <div className="card" style={{ background: "#fff4f4", color: "#b00" }}>
          {String(error)}
        </div>
      )}

      {/* Rate Configuration */}
      <div className="card" style={{ padding: 18, borderRadius: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>Rate Configuration</div>
          <button className="btn primary" onClick={saveRates} disabled={!selectedJob}>Save Configuration</button>
        </div>

        <div style={{ marginTop: 10 }}>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            style={{ width: "100%", padding: 10, borderRadius: 8 }}
          >
            <option value="">Select a job to configure rates</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.title}</option>
            ))}
          </select>
        </div>

        {/* Row 1: Pay mode / Hourly / Transport */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginTop: 12 }}>
          <Field label="Pay Mode">
            <select value={payMode} onChange={(e) => setPayMode(e.target.value)}>
              <option value="hourly">Hourly only</option>
              <option value="specific">Session payment only</option>
              <option value="specific_plus_hourly">Session + Hourly</option>
            </select>
          </Field>

          {payMode !== "specific" && (
            <Field label="Hourly Base (RM / hour)">
              <input
                type="text"
                inputMode="decimal"
                value={baseRate}
                onChange={(e) => setBaseRate(e.target.value)}
              />
            </Field>
          )}

          <Field label="Transport Allowance (RM, ATAG Bus)">
            <input
              type="text"
              inputMode="decimal"
              value={transportAllowance}
              onChange={(e) => setTransportAllowance(e.target.value)}
            />
          </Field>
        </div>

        {/* Row 2: Payment Price (only when session pay is used) */}
        {payMode !== "hourly" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginTop: 12 }}>
            <Field label="Payment Price (RM / session)">
              <input
                type="text"
                inputMode="decimal"
                value={paymentPrice}
                onChange={(e) => setPaymentPrice(e.target.value)}
                placeholder="e.g. 120"
              />
            </Field>
          </div>
        )}

        {/* Row 3: L&U (optional) & Early Call (optional) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <div className="card" style={{ padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 600 }}>Loading & Unloading</div>
              <Toggle id="ldu-en" checked={lduEnabled} onChange={setLduEnabled} text="Enabled" />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr",
                gap: 8,
                marginTop: 8,
                opacity: lduEnabled ? 1 : 0.5,
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#374151" }}>
                  Price (RM / helper)
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  value={lduPrice}
                  onChange={(e) => setLduPrice(e.target.value)}
                  disabled={!lduEnabled}
                />
              </div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                Paid only to helpers ticked by PM (and only when enabled).
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 600 }}>Early Call</div>
              <Toggle id="ec-en" checked={earlyCallEnabled} onChange={setEarlyCallEnabled} text="Enabled" />
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
                marginTop: 8,
                opacity: earlyCallEnabled ? 1 : 0.5,
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#374151" }}>
                  Amount (RM)
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  value={earlyCallAmount}
                  onChange={(e) => setEarlyCallAmount(e.target.value)}
                  disabled={!earlyCallEnabled}
                />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#374151" }}>
                  Threshold (hours)
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  value={earlyCallThreshold}
                  onChange={(e) => setEarlyCallThreshold(e.target.value)}
                  disabled={!earlyCallEnabled}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Wage Calculation */}
      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700 }}>Wage Calculation</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={calcWages} disabled={!selectedJob}>Calculate Wages</button>
            {selectedJob && <button className="btn" onClick={() => downloadJobCSV(selectedJob.id)}>Download Job CSV</button>}
          </div>
        </div>

        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table width="100%" cellPadding="8" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #ddd" }}>
                <th align="left">Employee</th>
                <th align="left">Job</th>
                <th align="right">Hours</th>
                <th align="left">Transport</th>
                <th align="right">Wage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td>{r.employee}</td>
                  <td>{r.jobTitle}</td>
                  <td align="right">{r.hours.toFixed(2)}</td>
                  <td>{r.transport}</td>
                  <td align="right">{money(r.wage)}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={5} style={{ opacity: 0.6 }}>No rows yet. Click “Calculate Wages”.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payroll Export */}
      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700 }}>Payroll Export</div>
          <button className="btn" onClick={exportPayrollCSV} disabled={!rows.length}>Export to CSV</button>
        </div>
        <div style={{ marginTop: 10, fontSize: 14, opacity: 0.9 }}>
          <div><strong>Export Summary</strong></div>
          <div>Total Employees: {summary.employees}</div>
          <div>Total Hours: {summary.hours.toFixed(2)}</div>
          <div>Total Wages: {money(summary.wages)}</div>
          <div>Jobs Included: {summary.jobs}</div>
        </div>
      </div>
    </div>
  );
}
