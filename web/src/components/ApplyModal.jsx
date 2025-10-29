// web/src/components/ApplyModal.jsx
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

/** Derive session kind from a job record (virtual vs physical) */
function deriveKind(job) {
  const kind =
    job?.rate?.sessionKind ||
    job?.sessionKind ||
    job?.physicalSubtype ||
    job?.session?.physicalType ||
    (job?.session?.mode === "virtual" ? "virtual" : null);

  const mode =
    job?.session?.mode ||
    job?.sessionMode ||
    job?.mode ||
    (kind === "virtual" ? "virtual" : "physical");

  const isVirtual = mode === "virtual" || kind === "virtual";
  const resolvedKind = isVirtual
    ? "virtual"
    : ["half_day", "full_day", "2d1n", "3d2n", "hourly_by_role", "hourly_flat"].includes(kind)
    ? kind
    : "half_day";

  return { isVirtual, kind: resolvedKind };
}

/**
 * Props:
 * - open: boolean
 * - job: Job object
 * - onClose(): void
 * - onSubmit(transport: "ATAG Bus"|"Own Transport", wantsLU: boolean): void
 */
export default function ApplyModal({ open, job, onClose, onSubmit }) {
  if (!open || !job) return null;

  const { isVirtual } = deriveKind(job);
  const isPhysical = !isVirtual;

  // Transport: only shown for physical; for virtual we'll silently send "Own Transport"
  const allow = useMemo(
    () =>
      isPhysical
        ? job.transportOptions || { bus: true, own: true }
        : { bus: false, own: false },
    [isPhysical, job.transportOptions]
  );

  const choices = useMemo(() => {
    if (!isPhysical) return [];
    const c = [];
    if (allow.bus) c.push({ key: "ATAG Bus", label: "ATAG Bus" });
    if (allow.own) c.push({ key: "Own Transport", label: "Own Transport" });
    return c;
  }, [isPhysical, allow]);

  const [selected, setSelected] = useState(
    isPhysical
      ? (allow?.bus && "ATAG Bus") || (allow?.own && "Own Transport") || ""
      : "Own Transport" // default used for virtual (won't be shown)
  );

  // Loading & Unloading opt-in (physical + enabled + remaining quota)
  const luEnabled = isPhysical && !!job.loadingUnload?.enabled;
  const luQuota = luEnabled ? Number(job.loadingUnload?.quota || 0) : 0;
  const luApplicants = luEnabled
    ? Array.isArray(job.loadingUnload?.applicants)
      ? job.loadingUnload.applicants.length
      : Number(job.loadingUnload?.applicants || 0)
    : 0;
  const luRemaining = luEnabled && luQuota > 0 ? Math.max(0, luQuota - luApplicants) : 0;
  const showLU = luEnabled && luRemaining > 0;
  const [wantsLU, setWantsLU] = useState(false);

  useEffect(() => {
    if (isPhysical) {
      const first =
        (job.transportOptions?.bus && "ATAG Bus") ||
        (job.transportOptions?.own && "Own Transport") ||
        "";
      setSelected(first);
    } else {
      // virtual: we still send a valid transport for server compatibility
      setSelected("Own Transport");
    }
    setWantsLU(false);
  }, [job?.id, isPhysical, job.transportOptions?.bus, job.transportOptions?.own]);

  function submit() {
    // Always pass a valid transport string for the server API
    const transport = selected || "Own Transport";
    onSubmit(transport, showLU ? wantsLU : false);
  }

  return createPortal(
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-card modal-sm">
          <div className="modal-header">Apply for: {job.title}</div>

          <div className="modal-body" style={{ display: "grid", gap: 12 }}>
            {/* Transport (PHYSICAL ONLY) */}
            {isPhysical && (
              <div className="card">
                <label style={{ fontWeight: 600 }}>Choose Transport</label>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 16,
                    alignItems: "center",
                    marginTop: 8,
                  }}
                >
                  {choices.map((c) => (
                    <label key={c.key} style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
                    <div style={{ gridColumn: "span 2", color: "#b91c1c" }}>
                      No transport option available for this job.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Loading & Unloading opt-in (PHYSICAL ONLY + ENABLED + QUOTA LEFT) */}
            {showLU && (
              <div className="card">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <label style={{ display: "flex", gap: 8, alignItems: "center", margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={wantsLU}
                      onChange={(e) => setWantsLU(e.target.checked)}
                    />
                    I can help with <strong>Loading &amp; Unloading</strong>
                  </label>
                  <div style={{ fontSize: 12, color: "#667085" }}>
                    Helpers needed: {luRemaining} remaining
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "#667085", marginTop: 6 }}>
                  PM will confirm who actually helped during the event.
                </div>
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn primary"
              onClick={submit}
              disabled={isPhysical && !selected}
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
