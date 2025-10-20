import React from "react";

/**
 * Props:
 * - jobs: []
 * - onApply(job), onApplyAgain(job), onView(job)
 * - canApply: boolean
 * - myStatuses?: { [jobId]: 'applied'|'approved'|'rejected' }
 * - canManage?: boolean
 * - onEdit?(job), onDelete?(job)
 */
export default function JobList({
  jobs = [],
  onApply,
  onApplyAgain,
  onView,
  canApply = true,
  myStatuses = {},
  canManage = false,
  onEdit,
  onDelete,
}) {
  return (
    <div className="grid">
      {jobs.map((j) => {
        const my = myStatuses[j.id];

        const start = new Date(j.startTime);
        const end   = new Date(j.endTime);

        const dateLine = start.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });

        const timeLine =
          start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase() +
          " - " +
          end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();

        const payText = j.paySummary || "See details";
        const approved = Number(j.approvedCount || 0);
        const applied  = Number(j.appliedCount  || 0);
        const total    = Number(j.headcount     || 0);

        function ApplyArea() {
          if (!canApply) return null;
          if (my === "approved") return <button className="btn green" disabled>Approved</button>;
          if (my === "applied")  return <button className="btn gray" disabled>Applied</button>;
          if (my === "rejected")
            return (
              <>
                <button className="btn gray" disabled>Rejected</button>
                <button className="btn red" onClick={() => onApplyAgain && onApplyAgain(j)}>Apply Again</button>
              </>
            );
          return <button className="btn red" onClick={() => onApply && onApply(j)}>Apply</button>;
        }

        return (
          <div key={j.id} className="card">
            {/* Title + status */}
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 600 }}>{j.title}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="status">{j.status}</div>
              </div>
            </div>

            {/* Requested format */}
            <div style={{ marginTop: 8, lineHeight: 1.55 }}>
              <div><strong>Date</strong><span style={{ marginLeft: 8 }}>{dateLine}</span></div>
              <div><strong>Time</strong><span style={{ marginLeft: 8 }}>{timeLine}</span></div>
              <div><strong>Location</strong><span style={{ marginLeft: 8 }}>{j.venue}</span></div>
              <div><strong>Pay</strong><span style={{ marginLeft: 8 }}>{payText}</span></div>

              <div style={{ marginTop: 8 }}>
                <strong>Hiring for</strong><span style={{ marginLeft: 8 }}>{total} pax</span>
              </div>
              <div style={{ color: "#667085" }}>
                {/* “x/y approved” under headcount, plus applied info */}
                Approved: {approved}/{total} &nbsp;·&nbsp; Applied: {applied}
              </div>
            </div>

            {/* Actions */}
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {canApply && <ApplyArea />}
              <button className="btn" onClick={() => onView && onView(j)}>View details</button>

              {canManage && (
                <>
                  <button className="btn" onClick={() => onEdit && onEdit(j)}>Edit</button>
                  <button className="btn red" onClick={() => onDelete && onDelete(j)}>Delete</button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
