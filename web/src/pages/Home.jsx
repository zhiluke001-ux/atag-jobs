// web/src/pages/Home.jsx
import React, { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiDelete } from "../api";
import JobList from "../components/JobList";
import JobModal from "../components/JobModal";
import ApplyModal from "../components/ApplyModal";
import { byNewestPosted, byMostRecentlyFinished } from "../utils/sortJobs";

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
    : ["half_day", "full_day", "2d1n", "3d2n", "hourly_by_role", "hourly_flat"].includes(
        kind
      )
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

  // Present / Past view (for admin/pm only)
  const [viewMode, setViewMode] = useState("present"); // "present" | "past"

  // Search + event date-range filter (all users)
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState(""); // "YYYY-MM-DD"
  const [dateTo, setDateTo] = useState("");
  const hasActiveFilter =
    search.trim() !== "" || dateFrom !== "" || dateTo !== "";

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

  // Stats for header (present vs past)
  const jobStats = useMemo(() => {
    const now = Date.now();
    let present = 0;
    let past = 0;

    for (const j of jobs || []) {
      const endMs = j?.endTime ? new Date(j.endTime).getTime() : null;
      const isPast = endMs != null && endMs < now;
      if (isPast) past += 1;
      else present += 1;
    }
    return { present, past };
  }, [jobs]);

  // Filter jobs into Present / Past + search + event date range, then sort:
  //  - Past tab  -> most recently finished first
  //  - Present / marshal sign-up list -> newest posted first
  const filteredJobs = useMemo(() => {
    const now = Date.now();
    const term = search.trim().toLowerCase();
    const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const toTs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;

    const list = (jobs || []).filter((j) => {
      // Safely handle missing endTime: treat as present/ongoing
      const endMs = j?.endTime ? new Date(j.endTime).getTime() : null;
      const isPast = endMs != null && endMs < now;

      // Present / Past gate
      if (canManage) {
        // Admin / PM: respect Present | Past toggle
        if (viewMode === "past" ? !isPast : isPast) return false;
      } else if (isPast) {
        // Non-admin users: always see only ongoing/upcoming jobs
        return false;
      }

      // Text search: title / venue / client / description / status
      if (term) {
        const hay = [j.title, j.venue, j.clientName, j.description, j.status]
          .map((v) => String(v || "").toLowerCase())
          .join(" ");
        if (!hay.includes(term)) return false;
      }

      // Event start-date range (both bounds optional)
      if (fromTs != null || toTs != null) {
        const startMs = j?.startTime ? new Date(j.startTime).getTime() : null;
        if (startMs == null) return false;
        if (fromTs != null && startMs < fromTs) return false;
        if (toTs != null && startMs > toTs) return false;
      }

      return true;
    });

    const showingPast = canManage && viewMode === "past";
    return [...list].sort(showingPast ? byMostRecentlyFinished : byNewestPosted);
  }, [jobs, canManage, viewMode, search, dateFrom, dateTo]);

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
      await apiPost(`/jobs/${applyJob.id}/apply`, {
        transport: tx,
        wantsLU: !!wantsLU,
      });

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

  // ---- Main list content (loading / empty / list) ----
  let mainContent;
  if (loading) {
    mainContent = (
      <div
        style={{
          padding: "40px 0",
          textAlign: "center",
          color: "#6b7280",
          fontSize: 14,
        }}
      >
        Loading jobs…
      </div>
    );
  } else if (!filteredJobs.length) {
    mainContent = (
      <div
        style={{
          padding: "40px 0",
          textAlign: "center",
          color: "#6b7280",
          fontSize: 14,
        }}
      >
        {hasActiveFilter ? (
          <>
            No jobs match your search or date filter.{" "}
            <button
              className="btn"
              style={{ marginLeft: 8 }}
              onClick={() => {
                setSearch("");
                setDateFrom("");
                setDateTo("");
              }}
            >
              Clear filters
            </button>
          </>
        ) : canManage ? (
          <>
            No jobs in this view yet.
            <br />
            Switch between <strong>Present</strong> and <strong>Past</strong>{" "}
            above, or create a new job.
          </>
        ) : (
          <>No upcoming jobs available at the moment. Please check back later.</>
        )}
      </div>
    );
  } else {
    mainContent = (
      <JobList
        jobs={filteredJobs}
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
        // Admin/PM sees full details; part-timer sees compact card
        showFullDetails={canManage}
        viewerUser={user} // role-based display
      />
    );
  }

  return (
    <div className="container" style={{ paddingTop: 16 }}>
      {/* Top bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 16,
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>Jobs Management</div>
          <div
            style={{
              marginTop: 4,
              fontSize: 13,
              color: "#6b7280",
            }}
          >
            {canManage ? (
              <>
                Present: <strong>{jobStats.present}</strong> · Past:{" "}
                <strong>{jobStats.past}</strong>
                {hasActiveFilter && (
                  <> · <strong>{filteredJobs.length}</strong> shown</>
                )}
              </>
            ) : (
              <>
                Showing{" "}
                <strong>{filteredJobs.length}</strong> upcoming job
                {filteredJobs.length === 1 ? "" : "s"} for you.
              </>
            )}
          </div>
        </div>

        {canManage && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Present / Past toggle (admin/pm only) */}
            <div
              style={{
                display: "inline-flex",
                borderRadius: 999,
                border: "1px solid #d1d5db",
                overflow: "hidden",
                background: "#f9fafb",
              }}
            >
              <button
                className={`btn ${viewMode === "present" ? "primary" : ""}`}
                style={{
                  borderRadius: 0,
                  padding: "6px 12px",
                  border: "none",
                  borderRight: "1px solid #d1d5db",
                  fontSize: 13,
                  background:
                    viewMode === "present" ? "#111827" : "transparent",
                  color: viewMode === "present" ? "#ffffff" : "#374151",
                }}
                onClick={() => setViewMode("present")}
              >
                Present
              </button>
              <button
                className={`btn ${viewMode === "past" ? "primary" : ""}`}
                style={{
                  borderRadius: 0,
                  padding: "6px 12px",
                  border: "none",
                  fontSize: 13,
                  background: viewMode === "past" ? "#111827" : "transparent",
                  color: viewMode === "past" ? "#ffffff" : "#374151",
                }}
                onClick={() => setViewMode("past")}
              >
                Past
              </button>
            </div>

            {/* Create Job button */}
            <button
              className="btn primary"
              onClick={() => setShowCreate(true)}
              style={{ paddingInline: 14 }}
            >
              + Create Job
            </button>
          </div>
        )}
      </div>

      {/* Search + event date range (all users) */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <input
          type="search"
          placeholder="Search title, venue, client…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: "1 1 240px", minWidth: 0, maxWidth: 360 }}
        />
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            margin: 0,
            fontSize: 13,
            color: "#6b7280",
            fontWeight: 600,
          }}
        >
          From
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{ width: "auto" }}
          />
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            margin: 0,
            fontSize: 13,
            color: "#6b7280",
            fontWeight: 600,
          }}
        >
          To
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
            style={{ width: "auto" }}
          />
        </label>
        {hasActiveFilter && (
          <button
            className="btn"
            onClick={() => {
              setSearch("");
              setDateFrom("");
              setDateTo("");
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* List / Empty / Loading */}
      {mainContent}

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
