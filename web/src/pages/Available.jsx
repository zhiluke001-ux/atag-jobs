import React, { useEffect, useState } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "../api";
import JobList from "../components/JobList";
import JobModal from "../components/JobModal";
import ApplyModal from "../components/ApplyModal";

export default function Available({ navigate, user }) {
  const [jobs, setJobs] = useState([]);
  const [myStatuses, setMyStatuses] = useState({});
  const [loading, setLoading] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editJob, setEditJob] = useState(null);

  const [showApply, setShowApply] = useState(false);
  const [applyJob, setApplyJob] = useState(null);

  const canManage = !!user && (user.role === "pm" || user.role === "admin");
  const canApply  = !user || user.role === "part-timer";

  async function refresh() {
    setLoading(true);
    try {
      const j = await apiGet("/jobs");
      setJobs(j);
      if (user?.role === "part-timer") {
        const list = await apiGet("/me/jobs").catch(() => []);
        const m = {}; list.forEach(it => { m[it.id] = it.myStatus; });
        setMyStatuses(m);
      } else {
        setMyStatuses({});
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (user) refresh(); }, [user]);

  function onView(job){ navigate(`#/jobs/${job.id}`); }

  // New: open pretty Apply modal (no prompt)
  async function onApply(job){
    if (!user) return navigate("#/login");
    if (user.role !== "part-timer") return;
    // fetch full job so we know transportOptions
    const full = await apiGet(`/jobs/${job.id}`).catch(() => job);
    setApplyJob(full);
    setShowApply(true);
  }

  // New: ensure we edit with a FULL job (so transport flags are kept)
  async function onEdit(job){
    const full = await apiGet(`/jobs/${job.id}`).catch(()=>job);
    setEditJob(full);
    setShowEdit(true);
  }

  async function onDelete(job){
    if (!window.confirm("Delete this job?")) return;
    await apiDelete(`/jobs/${job.id}`);
    await refresh();
  }

  return (
    <div className="container">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",margin:"8px 0 12px"}}>
        <div style={{fontSize:20,fontWeight:700}}>Jobs Management</div>
        {canManage && (
          <button className="btn-cta" onClick={()=>setShowCreate(true)}>
            <svg className="plus" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5c.55 0 1 .45 1 1v5h5a1 1 0 1 1 0 2h-5v5a1 1 0 1 1-2 0v-5H6a1 1 0 1 1 0-2h5V6c0-.55.45-1 1-1z"/>
            </svg>
            Create Job
          </button>
        )}
      </div>

      {loading && <div className="card">Loading jobs…</div>}
      {!loading && jobs.length === 0 && <div className="card">No open jobs right now.</div>}

      {!loading && jobs.length > 0 && (
        <JobList
          jobs={jobs}
          onView={onView}
          onApply={onApply}
          canApply={canApply}
          myStatuses={myStatuses}
          canManage={canManage}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}

      {/* CREATE */}
      {showCreate && (
        <JobModal
          mode="create"
          initial={null}
          onClose={()=>setShowCreate(false)}
          onSubmit={async (payload) => {
            const created = await apiPost("/jobs", payload);
            setShowCreate(false);
            await refresh();
            navigate(`#/jobs/${created.id}`);
          }}
        />
      )}

      {/* EDIT */}
      {showEdit && editJob && (
        <JobModal
          mode="edit"
          initial={editJob}
          onClose={()=>{ setShowEdit(false); setEditJob(null); }}
          onSubmit={async (payload) => {
            await apiPatch(`/jobs/${editJob.id}`, payload);
            setShowEdit(false); setEditJob(null);
            await refresh();
          }}
        />
      )}

      {/* APPLY */}
      {showApply && applyJob && (
        <ApplyModal
          open={showApply}
          job={applyJob}
          onClose={()=>{ setShowApply(false); setApplyJob(null); }}
          onSubmit={async (transport) => {
            try {
              const r = await apiPost(`/jobs/${applyJob.id}/apply`, { transport });
              if (r && r.message === "already_applied") {
                window.alert("You already applied for this job.");
              } else {
                window.alert("Applied!");
              }
              setShowApply(false); setApplyJob(null);
              await refresh();
            } catch (e) {
              window.alert("Apply failed: " + e);
            }
          }}
        />
      )}
    </div>
  );
}
