import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function ApplyModal({ open, job, onClose, onSubmit }) {
  if (!open || !job) return null;

  const allow = job.transportOptions || { bus: true, own: true };
  const choices = [
    ...(allow.bus ? [{ key: "ATAG Bus", label: "ATAG Bus" }] : []),
    ...(allow.own ? [{ key: "Own Transport", label: "Own Transport" }] : []),
  ];

  const [selected, setSelected] = useState("");
  const [wantsLU, setWantsLU] = useState(false);

  const luEnabled = (job.loadingUnload?.quota || 0) > 0;
  const luQuota = job.loadingUnload?.quota || 0;
  // when coming from /jobs (public view), we only have count; when from /jobs/:id we have array
  const luAppliedCount = Array.isArray(job.loadingUnload?.applicants)
    ? job.loadingUnload.applicants.length
    : (job.loadingUnload?.applicants || 0);
  const luFull = luEnabled && luAppliedCount >= luQuota;

  useEffect(() => {
    const first =
      (job.transportOptions?.bus && "ATAG Bus") ||
      (job.transportOptions?.own && "Own Transport") ||
      "";
    setSelected(first);
    setWantsLU(false);
  }, [job?.id]);

  function handleApply() {
    if (!selected) return;
    onSubmit(selected, luEnabled ? wantsLU : false);
  }

  return createPortal(
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-card modal-sm">
          <div className="modal-header">Apply for: {job.title}</div>
          <div className="modal-body">
            <div className="card">
              <label>Choose Transport</label>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, alignItems:"center" }}>
                {choices.map((c)=>(
                  <label key={c.key} style={{ display:"flex", gap:8, alignItems:"center" }}>
                    <input
                      type="radio"
                      name="transport"
                      value={c.key}
                      checked={selected === c.key}
                      onChange={() => setSelected(c.key)}
                    />
                    {c.label}
                  </label>
                ))}
                {!choices.length && (
                  <div style={{ gridColumn:"span 2", color:"#b91c1c" }}>
                    No transport option available for this job.
                  </div>
                )}
              </div>
            </div>

            {luEnabled && (
              <div className="card" style={{ marginTop:10 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <label style={{ fontWeight:700 }}>Loading & Unloading</label>
                  <div className="status">Quota {luAppliedCount}/{luQuota}</div>
                </div>
                <label style={{ display:"flex", gap:8, alignItems:"center", marginTop:8, opacity: luFull && !wantsLU ? 0.6 : 1 }}>
                  <input
                    type="checkbox"
                    disabled={luFull && !wantsLU}
                    checked={wantsLU}
                    onChange={(e)=>setWantsLU(e.target.checked)}
                  />
                  I want to help with loading & unloading (RM {job.rate?.loadingUnloading?.amount ?? 30})
                </label>
                <div style={{ color:"#6b7280", fontSize:12, marginTop:6 }}>
                  PM will confirm after event. Must be present for both parts to receive allowance.
                </div>
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={handleApply} disabled={!selected || (luEnabled && luFull && wantsLU)}>
              Apply
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
