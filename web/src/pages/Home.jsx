// web/src/pages/Home.jsx
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { apiGet, apiPost, apiDelete } from "../api";
import JobList from "../components/JobList";
import JobModal from "../components/JobModal";

/* ------------------------------
   Helpers shared with Apply flow
------------------------------ */
function deriveKind(job) {
  const kind =
    job?.rate?.sessionKind ||
    job?.sessionKind ||
    job?.physicalSubtype ||
    job?.session?.physicalType ||
    (job?.session?.mode === "virtual" ? "virtual" : null);

  const mode = job?.session?.mode || job?.sessionMode || job?.mode || (kind === "virtual" ? "virtual" : "physical");
  const isVirtual = mode === "virtual" || kind === "virtual";

  const resolvedKind = isVirtual
    ? "virtual"
    : ["half_day", "full_day", "2d1n", "3d2n", "hourly_by_role", "hourly_flat"].includes(kind)
      ? kind
      : "half_day";

  return { isVirtual, kind: resolvedKind };
}

/* ------------------------------
   Inline Apply Modal (with L&U opt-in)
------------------------------ */
function ApplyModal({ open, job, onClose, onSubmit }) {
  if (!open || !job) return null;
  const { isVirtual } = deriveKind(job);
  const isPhysical = !isVirtual;

  // Transport choices only for physical
  const allow = isPhysical ? (job.transportOptions || { bus: true, own: true }) : { bus: false, own: false };
  const choices = !isPhysical ? [] : [
    ...(allow.bus ? [{ key: "ATAG Bus", label: "ATAG Bus" }] : []),
    ...(allow.own ? [{ key: "Own Transport", label: "Own Transport" }] : []),
  ];
  const [selected, setSelected] = useState(choices.length ? choices[0].key : "");

  // Loading & Unloading opt-in (only if physical AND enabled AND quota remaining)
  const luEnabled = isPhysical && !!job.loadingUnload?.enabled;
  const luQuota = Number(luEnabled ? job.loadingUnload?.quota || 0 : 0);
  const luApplicants = Number(
    luEnabled
      ? Array.isArray(job.loadingUnload?.applicants)
        ? job.loadingUnload.applicants.length
        : job.loadingUnload?.applicants || 0
      : 0
  );
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
      setSelected(""); // not required for virtual
    }
    setWantsLU(false);
  }, [job?.id, isPhysical]);

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

            {/* Loading & Unloading opt-in (PHYSICAL ONLY + ENABLED) */}
            {showLU && (
              <div className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
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
            <button className="btn" onClick={onClose}>Cancel</button>
            <button
              className="btn primary"
              onClick={() => onSubmit(isPhysical ? selected : null, showLU ? wantsLU : false)}
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

/* ------------------------------
   Home = Jobs Management
------------------------------ */
export default function Home({ navigate, user }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  // for part-timer status badges + “Apply Again”
  const [myStatuses, setMyStatuses] = useState({});

  // modals
  const [showCreate, setShowCreate] = useState(false);
  const [editJob, setEditJob] = useState(null);

  // apply modal
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyJob, setApplyJob] = useState(null);

  const canManage = useMemo(
    () => !!user && (user.role === "pm" || user.role === "admin"),
    [user]
  );
  const canApply = !user || user.role === "part-timer";

  async function load() {
    setLoading(true);
    try {
      const list = await apiGet("/jobs");
      // HYDRATE each list item with full details so pay display is consistent with JobDetails
      const full = await Promise.all(
        (list || []).map(async (j) => {
          try {
            const fj = await apiGet(`/jobs/${j.id}`);
            return {
              ...j,
              ...fj,
              appliedCount: j.appliedCount ?? fj.appliedCount,
              approvedCount: j.approvedCount ?? fj.approvedCount,
            };
          } catch {
            return j;
          }
        })
      );
      setJobs(full || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (user?.role === "part-timer") {
      apiGet("/me/jobs")
        .then((list) => {
          const map = {};
          for (const j of list || []) map[j.id] = j.myStatus;
          setMyStatuses(map);
        })
        .catch(() => setMyStatuses({}));
    } else {
      setMyStatuses({});
    }
  }, [user]);

  function onView(j) {
    navigate(`#/jobs/${j.id}`);
  }

  // ---- Apply flow
  function onApply(job) {
    if (!user) return navigate("#/login");
    if (user.role !== "part-timer") return;
    setApplyJob(job);
    setApplyOpen(true);
  }

  async function handleSubmitApply(transport, wantsLU) {
    try {
      // For virtual sessions, transport may be null — backend should ignore.
      const payload = { ...(transport ? { transport } : {}), ...(wantsLU ? { wantsLU: true } : { wantsLU: false }) };
      await apiPost(`/jobs/${applyJob.id}/apply`, payload);
      const list = await apiGet("/me/jobs");
      const map = {};
      for (const it of list || []) map[it.id] = it.myStatus;
      setMyStatuses(map);
      setApplyOpen(false);
      setApplyJob(null);
      window.alert("Applied!");
      load(); // refresh counters (L&U remaining etc.)
    } catch (e) {
      try {
        const j = JSON.parse(String(e));
        window.alert(j.error || "Apply failed");
      } catch {
        window.alert("Apply failed");
      }
    }
  }

  // ---- Edit/Delete
  async function handleEdit(job) {
    try {
      const full = await apiGet(`/jobs/${job.id}`); // ensure full fields (rolePlan, tierRates, etc.)
      setEditJob(full);
    } catch (e) {
      alert("Failed to load job: " + e);
    }
  }

  async function handleDelete(job) {
    if (!window.confirm(`Delete "${job.title}"? This cannot be undone.`)) return;
    try {
      await apiDelete(`/jobs/${job.id}`);
      await load();
    } catch (e) {
      window.alert("Delete failed: " + e);
    }
  }

  return (
    <div className="container" style={{ paddingTop: 16 }}>
      {/* Top bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>Jobs Management</div>
        {canManage && (
          <button className="btn primary" onClick={() => setShowCreate(true)}>
            + Create Job
          </button>
        )}
      </div>

      {/* List */}
      <JobList
        jobs={jobs}
        loading={loading}
        onApply={onApply}
        onView={onView}
        canApply={canApply}
        canManage={canManage}
        myStatuses={myStatuses}
        onChanged={load}
        onApplyAgain={onApply}
        onEdit={handleEdit}
        onDelete={handleDelete}
        showFullDetails
        viewerUser={user}   // role-based display
      />

      {/* Create Job Modal */}
      {canManage && showCreate && (
        <JobModal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}

      {/* Edit Job Modal */}
      {canManage && editJob && (
        <JobModal
          open={!!editJob}
          job={editJob}
          onClose={() => setEditJob(null)}
          onUpdated={() => {
            setEditJob(null);
            load();
          }}
        />
      )}

      {/* Apply Modal (part-timer) */}
      {applyOpen && applyJob && (
        <ApplyModal
          open={applyOpen}
          job={applyJob}
          onClose={() => {
            setApplyOpen(false);
            setApplyJob(null);
          }}
          onSubmit={handleSubmitApply}
        />
      )}
    </div>
  );
}
