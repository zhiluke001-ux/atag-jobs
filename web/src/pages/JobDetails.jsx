import React, { useEffect, useState } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "../api";
import JobModal from "../components/JobModal";

export default function JobDetails({ jobId, navigate, user }) {
  const [job, setJob] = useState(null);
  const [myStatus, setMyStatus] = useState(null);
  const [showModal, setShowModal] = useState(null); // null | 'create' | 'edit'

  useEffect(() => {
    apiGet(`/jobs/${jobId}`).then((j) => {
      setJob(j);
      if (user && user.role === "part-timer") {
        const applied = (j.applications || []).find((a) => a.userId === user.id);
        if (applied) {
          if ((j.approved || []).includes(user.id)) setMyStatus("approved");
          else if ((j.rejected || []).includes(user.id)) setMyStatus("rejected");
          else setMyStatus("applied");
        } else setMyStatus(null);
      } else setMyStatus(null);
    });
  }, [jobId, user]);

  if (!job) return <div className="container">Loading...</div>;

  const start = new Date(job.startTime);
  const end = new Date(job.endTime);
  const dateLine = start.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeLine =
    `${start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase()}`
    + " - "
    + `${end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase()}`;

  async function apply() {
    if (!user) return navigate("#/login");
    if (user.role !== "part-timer") return;
    const transport = window.prompt("Select transport: type 'ATAG Bus' or 'Own Transport'", "ATAG Bus");
    if (!transport) return;
    try {
      await apiPost(`/jobs/${job.id}/apply`, { transport });
      alert("Applied!"); navigate("#/my-jobs");
    } catch (e) { alert("Apply failed: " + e); }
  }

  async function onDelete() {
    if (!user || (user.role !== "pm" && user.role !== "admin")) return;
    if (!window.confirm("Delete this job? This cannot be undone.")) return;
    try {
      await apiDelete(`/jobs/${job.id}`);
      alert("Deleted");
      navigate("#/dashboard");
    } catch (e) { alert("Delete failed: " + e); }
  }

  // Action area for part-timer
  let actionEl = null;
  if (!user || user.role === "part-timer") {
    if (myStatus === "approved") actionEl = <button className="btn green" disabled>Approved</button>;
    else if (myStatus === "rejected") actionEl = <button className="btn gray" disabled>Rejected</button>;
    else if (myStatus === "applied") actionEl = <button className="btn gray" disabled>Applied</button>;
    else actionEl = <button className="btn red" onClick={apply}>Apply</button>;
  }

  const canPM = user?.role === "pm";
  const canAdmin = user?.role === "admin";
  const canManage = canPM || canAdmin;

  return (
    <div className="container">
      <div className="card">
        <div style={{display:"flex", justifyContent:"space-between", alignItems:"center"}}>
          <div>
            <div style={{fontWeight:700, fontSize:20}}>{job.title}</div>
            <div className="status" style={{marginTop:6}}>{job.status}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div>{job.venue}</div>
          </div>
        </div>

        <div style={{opacity:.9, marginTop:8}}>
          <div>{dateLine}</div>
          <div>{timeLine}</div>
        </div>

        <div style={{display:"flex", gap:16, flexWrap:"wrap", opacity:.9, marginTop:8}}>
          {job.headcount != null && <div>Headcount: {job.headcount}</div>}
          {job.rate?.base != null && <div>Rate: {job.rate.base}/hr</div>}
        </div>

        <div style={{marginTop:8}}>{job.description}</div>

        <div style={{display:"flex", gap:8, marginTop:12, flexWrap:"wrap"}}>
          {actionEl}
          {canManage && (
            <>
              <button className="btn" onClick={()=>setShowModal("edit")}>Edit</button>
              <button className="btn danger" onClick={onDelete}>Delete</button>
              {canPM && <button className="btn primary" onClick={()=>setShowModal("create")}>Create Job</button>}
            </>
          )}
        </div>
      </div>

      {showModal === "edit" && (
        <JobModal
          mode="edit"
          initial={job}
          onClose={()=>setShowModal(null)}
          onSubmit={async (payload)=>{
            await apiPatch(`/jobs/${job.id}`, payload);
            const fresh = await apiGet(`/jobs/${job.id}`);
            setJob(fresh);
          }}
        />
      )}

      {showModal === "create" && (
        <JobModal
          mode="create"
          initial={null}
          onClose={()=>setShowModal(null)}
          onSubmit={async (payload)=>{
            const created = await apiPost("/jobs", payload);
            alert("Created job " + created.id);
          }}
        />
      )}
    </div>
  );
}
