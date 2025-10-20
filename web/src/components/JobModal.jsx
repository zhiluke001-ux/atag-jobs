// web/src/components/JobModal.jsx
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { apiPost, apiPatch } from "../api";

export default function JobModal({ open, job, onClose, onCreated, onUpdated }) {
  const isEdit = !!job;

  const pad = (n) => String(n).padStart(2, "0");
  const toDateValue = (iso) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const toTimeValue = (iso) => {
    const d = new Date(iso);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const [form, setForm] = useState({
    title: "",
    venue: "",
    description: "",
    date: "",
    startTime: "",
    endTime: "",
    headcount: 5,
    transportOptions: { bus: true, own: true },
    // Payment & extras
    rate: {
      payMode: "hourly",          // hourly | specific | specific_plus_hourly
      paymentPrice: 0,            // RM / session
      base: 20,                   // RM / hour
      lduPrice: 30,
      earlyCallAmount: 20,
      earlyCallThresholdHours: 3,
    },
    earlyCall: {
      enabled: false,
      amount: 20,
      thresholdHours: 3,
    },
    ldu: {
      enabled: false,             // <-- NEW toggle
      quota: 0,
      price: 30,
    },
  });

  // hydrate (create vs edit)
  useEffect(() => {
    if (!isEdit) return;
    const st = new Date(job.startTime);
    const en = new Date(job.endTime);

    const lduSrc = job.loadingUnload || job.ldu || {};
    const lduEnabledDerived =
      typeof lduSrc.enabled === "boolean"
        ? lduSrc.enabled
        : ((Number(lduSrc.price) || 0) > 0 || (Number(lduSrc.quota) || 0) > 0);

    setForm((f) => ({
      ...f,
      title: job.title || "",
      venue: job.venue || "",
      description: job.description || "",
      date: toDateValue(st),
      startTime: toTimeValue(st),
      endTime: toTimeValue(en),
      headcount: job.headcount ?? 5,
      transportOptions: {
        bus: !!job.transportOptions?.bus,
        own: !!job.transportOptions?.own,
      },
      rate: {
        payMode: job.rate?.payMode || f.rate.payMode,
        paymentPrice: Number.isFinite(job.rate?.paymentPrice)
          ? job.rate.paymentPrice
          : (Number.isFinite(job.rate?.specificPayment) ? job.rate.specificPayment : f.rate.paymentPrice),
        base: Number.isFinite(job.rate?.base) ? job.rate.base : f.rate.base,
        lduPrice: Number.isFinite(job.rate?.lduPrice) ? job.rate.lduPrice : (Number.isFinite(lduSrc.price) ? lduSrc.price : f.rate.lduPrice),
        earlyCallAmount: Number.isFinite(job.rate?.earlyCallAmount) ? job.rate.earlyCallAmount : f.rate.earlyCallAmount,
        earlyCallThresholdHours: Number.isFinite(job.rate?.earlyCallThresholdHours)
          ? job.rate.earlyCallThresholdHours
          : f.rate.earlyCallThresholdHours,
      },
      earlyCall: {
        enabled: !!job.earlyCall?.enabled,
        amount: Number.isFinite(job.earlyCall?.amount) ? job.earlyCall.amount : (job.rate?.earlyCallAmount ?? f.earlyCall.amount),
        thresholdHours: Number.isFinite(job.earlyCall?.thresholdHours)
          ? job.earlyCall.thresholdHours
          : (job.rate?.earlyCallThresholdHours ?? f.earlyCall.thresholdHours),
      },
      ldu: {
        enabled: !!lduEnabledDerived,                         // <-- hydrate enabled
        quota: Number.isFinite(lduSrc.quota) ? lduSrc.quota : f.ldu.quota,
        price: Number.isFinite(lduSrc.price)
          ? lduSrc.price
          : (Number.isFinite(job.rate?.lduPrice) ? job.rate.lduPrice : f.ldu.price),
      },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, job?.id]);

  // lock scroll when open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => (document.body.style.overflow = prev);
  }, [open]);

  const update = (path, value) => {
    setForm((f) => {
      const copy = structuredClone(f);
      const keys = Array.isArray(path) ? path : [path];
      let cur = copy;
      for (let i = 0; i < keys.length - 1; i++) cur = cur[keys[i]];
      cur[keys.at(-1)] = value;
      return copy;
    });
  };

  async function submit() {
    const startISO = new Date(`${form.date}T${form.startTime || "00:00"}:00`).toISOString();
    const endISO = new Date(`${form.date}T${form.endTime || "00:00"}:00`).toISOString();

    const lduBlock = {
      enabled: !!form.ldu.enabled,
      quota: Number(form.ldu.quota || 0),
      price: Number(form.ldu.price || form.rate.lduPrice || 0),
    };

    const payload = {
      title: form.title.trim(),
      venue: form.venue.trim(),
      description: form.description.trim(),
      startTime: startISO,
      endTime: endISO,
      headcount: Number(form.headcount),
      transportOptions: { bus: !!form.transportOptions.bus, own: !!form.transportOptions.own },
      rate: {
        payMode: String(form.rate.payMode || "hourly"),
        specificPayment: Number(form.rate.paymentPrice || 0),
        paymentPrice: Number(form.rate.paymentPrice || 0), // alias
        base: Number(form.rate.base || 0),
        lduPrice: Number(form.rate.lduPrice || lduBlock.price || 0),
        earlyCallAmount: Number(form.rate.earlyCallAmount || 0),
        earlyCallThresholdHours: Number(form.rate.earlyCallThresholdHours || 0),
      },
      earlyCall: {
        enabled: !!form.earlyCall.enabled,
        amount: Number(form.earlyCall.amount || form.rate.earlyCallAmount || 0),
        thresholdHours: Number(form.earlyCall.thresholdHours || form.rate.earlyCallThresholdHours || 0),
      },
      // Provide both keys to be compatible with different backends
      ldu: lduBlock,
      loadingUnload: lduBlock,
    };

    try {
      if (isEdit) {
        await apiPatch(`/jobs/${job.id}`, payload);
        onUpdated && onUpdated();
      } else {
        await apiPost("/jobs", payload);
        onCreated && onCreated();
      }
    } catch (e) {
      alert("Save failed: " + e);
    }
  }

  if (!open) return null;

  return createPortal(
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-card" style={{ maxWidth: 760 }}>
          <div className="modal-header">{isEdit ? "Edit Job" : "Create New Job"}</div>

          <div className="modal-body">
            {/* Title */}
            <div className="card">
              <label>Job Title</label>
              <input value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="Type here..." />
            </div>

            {/* Venue */}
            <div className="card">
              <label>Venue</label>
              <input value={form.venue} onChange={(e) => update("venue", e.target.value)} placeholder="Venue..." />
            </div>

            {/* Date */}
            <div className="card">
              <label>Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => update("date", e.target.value)}
                style={{ width: "100%", maxWidth: 360, minWidth: 260 }}
              />
            </div>

            {/* Start / End / Headcount */}
            <div className="card" style={{ paddingBottom: 0 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                <div className="card">
                  <label>Start</label>
                  <input type="time" value={form.startTime} onChange={(e) => update("startTime", e.target.value)} />
                </div>
                <div className="card">
                  <label>End</label>
                  <input type="time" value={form.endTime} onChange={(e) => update("endTime", e.target.value)} />
                </div>
                <div className="card">
                  <label>Headcount</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    value={form.headcount}
                    onChange={(e) => update("headcount", e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="card">
              <label>Description</label>
              <textarea rows={3} value={form.description} onChange={(e) => update("description", e.target.value)} placeholder="Optional..." />
            </div>

            {/* Payment */}
            <div className="card">
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Payment</div>
              <div className="grid" style={{ gap: 12 }}>
                <div className="card" style={{ gridColumn: "span 6" }}>
                  <label>Pay Mode</label>
                  <select value={form.rate.payMode} onChange={(e) => update(["rate", "payMode"], e.target.value)}>
                    <option value="hourly">Hourly only</option>
                    <option value="specific">Session payment only</option>
                    <option value="specific_plus_hourly">Session + Hourly</option>
                  </select>
                </div>

                {(form.rate.payMode === "specific" || form.rate.payMode === "specific_plus_hourly") && (
                  <div className="card" style={{ gridColumn: "span 6" }}>
                    <label>Payment Price (RM / session)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={String(form.rate.paymentPrice)}
                      onChange={(e) => update(["rate", "paymentPrice"], e.target.value)}
                    />
                  </div>
                )}

                {(form.rate.payMode === "hourly" || form.rate.payMode === "specific_plus_hourly") && (
                  <div className="card" style={{ gridColumn: "span 6" }}>
                    <label>Hourly Base (RM / hour)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={String(form.rate.base)}
                      onChange={(e) => update(["rate", "base"], e.target.value)}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Transport Options */}
            <div className="card">
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Transport Options</div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={!!form.transportOptions.bus}
                    onChange={(e) => update(["transportOptions", "bus"], e.target.checked)}
                  />
                  <span>ATAG Bus</span>
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={!!form.transportOptions.own}
                    onChange={(e) => update(["transportOptions", "own"], e.target.checked)}
                  />
                  <span>Own Transport</span>
                </label>
              </div>
            </div>

            {/* Early Call */}
            <div className="card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontWeight: 700 }}>Early Call Allowance</div>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={!!form.earlyCall.enabled}
                    onChange={(e) => update(["earlyCall", "enabled"], e.target.checked)}
                  />
                  <span>Enable</span>
                </label>
              </div>
              <div style={{ marginTop: 10, opacity: form.earlyCall.enabled ? 1 : 0.5 }}>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: 320 }}>
                    <label style={{ minWidth: 120 }}>Amount (RM)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={String(form.earlyCall.amount)}
                      onChange={(e) => update(["earlyCall", "amount"], e.target.value)}
                      disabled={!form.earlyCall.enabled}
                    />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: 320 }}>
                    <label style={{ minWidth: 120 }}>Threshold (hours)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={String(form.earlyCall.thresholdHours)}
                      onChange={(e) => update(["earlyCall", "thresholdHours"], e.target.value)}
                      disabled={!form.earlyCall.enabled}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Loading & Unloading with Enable toggle (NEW) */}
            <div className="card">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontWeight: 700 }}>Loading & Unloading</div>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={!!form.ldu.enabled}
                    onChange={(e) => update(["ldu", "enabled"], e.target.checked)}
                  />
                  <span>Enable</span>
                </label>
              </div>

              <div style={{ marginTop: 10, opacity: form.ldu.enabled ? 1 : 0.5 }}>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <label style={{ minWidth: 170 }}>Quota (helpers)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={String(form.ldu.quota)}
                      onChange={(e) => update(["ldu", "quota"], e.target.value)}
                      disabled={!form.ldu.enabled}
                    />
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <label style={{ minWidth: 170 }}>Price (RM / helper)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={String(form.ldu.price)}
                      onChange={(e) => update(["ldu", "price"], e.target.value)}
                      disabled={!form.ldu.enabled}
                    />
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                  Part-timers can opt-in when applying. PM will tick who actually helped.
                </div>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={submit}>
              {isEdit ? "Save" : "Create Job"}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
