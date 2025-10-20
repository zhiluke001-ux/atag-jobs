import React from "react";

export default function JobCard({
  job,
  onApply,
  onApplyAgain,
  onView,
  canApply,
  myStatus,
  onEdit,
  onDelete,
  canManage,
}) {
  const startD = new Date(job.startTime);
  const endD   = new Date(job.endTime);

  const dateStr = startD.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const timeStr =
    startD.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) +
    " - " +
    endD.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  const payText =
    job.paySummary ||
    "See details"; // server now supplies paySummary; this is a safe fallback

  const approved = Number(job.approvedCount || 0);
  const total    = Number(job.headcount || 0);

  function ApplyButtons() {
    if (!canApply) return null;
    if (myStatus === "approved") return <button className="btn green" disabled>Approved</button>;
    if (myStatus === "applied")  return <button className="btn gray" disabled>Applied</button>;
    if (myStatus === "rejected") {
      return (
        <>
          <button className="btn gray" disabled>Rejected</button>
          <button className="btn red" onClick={onApplyAgain}>Apply Again</button>
        </>
      );
    }
    return <button className="btn red" onClick={onApply}>Apply</button>;
  }

  return (
    <div className="card">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 16 }}>{job.title}</div>
          <div className="status" style={{ marginTop: 6 }}>{job.status}</div>
        </div>
      </div>

      {/* Body – requested format */}
      <div style={{ marginTop: 8, lineHeight: 1.5 }}>
        <div><strong>Date</strong><span style={{ marginLeft: 8 }}>{dateStr}</span></div>
        <div><strong>Time</strong><span style={{ marginLeft: 8 }}>{timeStr}</span></div>
        <div><strong>Location</strong><span style={{ marginLeft: 8 }}>{job.venue}</span></div>
        <div><strong>Pay</strong><span style={{ marginLeft: 8 }}>{payText}</span></div>

        <div style={{ marginTop: 8 }}>
          <strong>Hiring for</strong>
          <span style={{ marginLeft: 8 }}>{total} pax</span>
        </div>
        <div style={{ color: "#667085" }}>
          Approved: {approved}/{total}
        </div>
      </div>

      {/* Actions */}
      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <ApplyButtons />
        <button className="btn" onClick={onView}>View details</button>
        {canManage && (
          <>
            <button className="btn" onClick={onEdit}>Edit</button>
            <button className="btn red" onClick={onDelete}>Delete</button>
          </>
        )}
      </div>
    </div>
  );
}
