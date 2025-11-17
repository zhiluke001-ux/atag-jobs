// web/src/pages/Home.jsx
import React, { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiDelete } from "../api";
import JobList from "../components/JobList";
import JobModal from "../components/JobModal";
import ApplyModal from "../components/ApplyModal";

/* Optional: kind derivation if you need to branch UI later */
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
      // Hydrate each to ensure pay details / role rates are consistent with details page
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

  useEffect(() => {
    load();
  }, []);

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
      // Server requires a valid transport string even for virtual jobs.
      const tx = transport || "Own Transport";
      await apiPost(`/jobs/${applyJob.id}/apply`, { transport: tx, wantsLU: !!wantsLU });

      const list = await apiGet("/me/jobs");
      const map = {};
      for (const it of list || []) map[it.id] = it.myStatus;
      setMyStatuses(map);

      setApplyOpen(false);
      setApplyJob(null);
      window.alert("Applied!");
      load(); // refresh counters (including L&U remaining)
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
      const full = await apiGet(`/jobs/${job.id}`);
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

  /* ---------- Derived UI stats (for the header chips) ---------- */
  const stats = useMemo(() => {
    const total = jobs.length || 0;
    let upcoming = 0,
      ongoing = 0,
      ended = 0;
    for (const j of jobs) {
      const s = j?.status || "upcoming";
      if (s === "ongoing") ongoing++;
      else if (s === "ended") ended++;
      else upcoming++;
    }
    const myApplied = Object.keys(myStatuses || {}).length;
    const myApproved = Object.values(myStatuses || {}).filter((s) => s === "approved").length;
    return { total, upcoming, ongoing, ended, myApplied, myApproved };
  }, [jobs, myStatuses]);

  return (
    <div className="container" style={{ paddingTop: 16 }}>
      {/* Header / toolbar */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row-between" style={{ gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>Jobs Management</div>
            {/* small brand underline */}
            <div
              aria-hidden
              style={{ height: 3, width: 36, background: "var(--accent)", borderRadius: 2 }}
            />
          </div>

          {canManage && (
            <div className="actions" style={{ gap: 8 }}>
              <button className="btn primary" onClick={() => setShowCreate(true)}>
                + Create Job
              </button>
            </div>
          )}
        </div>

        {/* Status chips row */}
        <div className="row" style={{ flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          <span className="status" style={{ background: "#111", color: "#fff", borderColor: "#111" }}>
            Total:&nbsp;{stats.total}
          </span>
          <span className="status" style={{ background: "#f3f4f6", color: "#374151" }}>
            Upcoming:&nbsp;{stats.upcoming}
          </span>
          <span className="status" style={{ background: "#d1fae5", color: "#065f46" }}>
            Ongoing:&nbsp;{stats.ongoing}
          </span>
          <span className="status" style={{ background: "#fee2e2", color: "#991b1b" }}>
            Ended:&nbsp;{stats.ended}
          </span>
          {canApply && (
            <>
              <span className="status" style={{ background: "#fef3c7", color: "#92400e" }}>
                My Applied:&nbsp;{stats.myApplied}
              </span>
              <span className="status" style={{ background: "#dcfce7", color: "#166534" }}>
                My Approved:&nbsp;{stats.myApproved}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Jobs list */}
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
        viewerUser={user} // role-based display
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
