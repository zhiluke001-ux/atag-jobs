// web/src/pages/MyJobs.jsx
import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { apiGet, apiPost } from "../api";

/* ---------- helpers ---------- */
const toRad = (d) => (d * Math.PI) / 180;
function haversineMeters(a, b) {
  if (!a || !b) return null;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const aa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(aa)));
}
function fmtRange(s, e) {
  try {
    const S = dayjs(s), E = dayjs(e);
    const sameDay = S.isSame(E, "day");
    const d = S.format("YYYY/MM/DD");
    const t1 = S.format("h:mm a"), t2 = E.format("h:mm a");
    return sameDay
      ? `${d}  ${t1} — ${t2}`
      : `${S.format("YYYY/MM/DD h:mm a")} — ${E.format("YYYY/MM/DD h:mm a")}`;
  } catch {
    return "";
  }
}

/* ===========================================================
   Part-timer: My Jobs (distance + centered QR modal)
   =========================================================== */
export default function MyJobs({ navigate, user }) {
  const [jobs, setJobs] = useState([]);
  const [loc, setLoc] = useState(null);
  const [scannerInfo, setScannerInfo] = useState({}); // { [jobId]: {lat,lng,updatedAt,dist} }

  // QR modal state
  const [qrOpen, setQrOpen] = useState(false);
  const [qrToken, setQrToken] = useState("");
  const [qrDir, setQrDir] = useState("in"); // "in" | "out"
  const [qrJob, setQrJob] = useState(null);
  const [qrError, setQrError] = useState("");

  // load my jobs
  useEffect(() => {
    apiGet("/me/jobs").then(setJobs).catch(() => setJobs([]));
  }, []);

  // request & watch user location (this prompts for permission)
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setLoc({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
    return () => {
      try {
        navigator.geolocation.clearWatch(id);
      } catch {}
    };
  }, []);

  // fetch scanner location for ongoing jobs; refresh every 20s
  useEffect(() => {
    let timer;
    const fetchAll = async () => {
      const map = {};
      for (const j of jobs) {
        if (j.status !== "ongoing") continue;
        try {
          const s = await apiGet(`/jobs/${j.id}/scanner`);
          const dist = loc ? haversineMeters(loc, { lat: s.lat, lng: s.lng }) : null;
          map[j.id] = { ...s, dist };
        } catch {
          /* ignore if not started/unknown */
        }
      }
      if (Object.keys(map).length) setScannerInfo((prev) => ({ ...prev, ...map }));
    };
    fetchAll();
    timer = setInterval(fetchAll, 20000);
    return () => clearInterval(timer);
  }, [jobs, loc]);

  /* ---------- QR generation ---------- */
  async function openQR(job, direction) {
    setQrError("");
    setQrToken("");
    setQrJob(job);
    setQrDir(direction);

    // ensure we have a location (QR is bound to location)
    let here = loc;
    if (!here && "geolocation" in navigator) {
      try {
        const p = await new Promise((res, rej) =>
          navigator.geolocation.getCurrentPosition(
            (pos) => res({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            rej,
            { enableHighAccuracy: true, timeout: 10000 }
          )
        );
        here = p;
        setLoc(p);
      } catch {
        setQrError("Location permission is required to generate QR.");
        setQrOpen(true);
        return;
      }
    }
    try {
      const r = await apiPost(`/jobs/${job.id}/qr`, {
        direction,
        lat: here.lat,
        lng: here.lng,
      });
      setQrToken(r.token);
      setQrOpen(true);
    } catch (e) {
      let msg = "Failed to generate QR.";
      try {
        msg = JSON.parse(String(e)).error || msg;
      } catch {}
      setQrError(msg);
      setQrOpen(true);
    }
  }

  function closeQR() {
    setQrOpen(false);
    setQrToken("");
    setQrError("");
    setQrJob(null);
  }

  const qrImgSrc = useMemo(() => {
    if (!qrToken) return "";
    // lightweight QR render (no extra deps)
    return `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(
      qrToken
    )}`;
  }, [qrToken]);

  return (
    <div className="container" style={{ paddingTop: 16 }}>
      <div className="card">
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>My Jobs</div>

        {jobs.length === 0 ? (
          <div style={{ color: "#6b7280" }}>No jobs yet.</div>
        ) : (
          jobs.map((j) => {
            const s = scannerInfo[j.id];
            const dist = s?.dist;
            return (
              <div key={j.id} className="card" style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{j.title}</div>
                    <div style={{ color: "#374151", marginTop: 4 }}>
                      {fmtRange(j.startTime, j.endTime)}
                    </div>
                    <div
                      style={{
                        marginTop: 6,
                        display: "flex",
                        gap: 10,
                        alignItems: "center",
                        color: "#374151",
                        flexWrap: "wrap",
                      }}
                    >
                      <span className="status">
                        {j.myStatus} · {j.status}
                      </span>
                      {j.status === "ongoing" && (
                        <span
                          className="status"
                          title={
                            s?.updatedAt
                              ? `updated ${dayjs(s.updatedAt).format("HH:mm:ss")}`
                              : ""
                          }
                        >
                          Scanner distance: {dist == null ? "—" : `${dist} m`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "start" }}>
                    <button
                      className="btn"
                      onClick={() => navigate(`#/jobs/${j.id}`)}
                    >
                      View details
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    marginTop: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <button className="btn primary" onClick={() => openQR(j, "in")}>
                    Get Check-in QR
                  </button>
                  <button className="btn" onClick={() => openQR(j, "out")}>
                    Get Check-out QR
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ---------- Centered QR MODAL ---------- */}
      {qrOpen && (
        <div
          className="modal-overlay"
          onClick={closeQR}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            background: "rgba(0,0,0,.55)",
          }}
        >
          <div
            className="modal-card modal-sm"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(560px, 92vw)",
              background: "#fff",
              borderRadius: 12,
              padding: 16,
              boxShadow: "0 10px 30px rgba(0,0,0,.25)",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>
              {qrJob
                ? `${qrDir === "in" ? "Check-in" : "Check-out"} QR — ${qrJob.title}`
                : "QR"}
            </div>

            {qrError ? (
              <div
                style={{
                  padding: 10,
                  border: "1px solid var(--red)",
                  borderRadius: 8,
                  color: "var(--red)",
                }}
              >
                {qrError}
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    margin: "6px 0 10px",
                  }}
                >
                  {qrToken ? (
                    <img
                      src={qrImgSrc}
                      alt="QR code"
                      style={{
                        width: 260,
                        height: 260,
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                      }}
                    />
                  ) : (
                    <div style={{ color: "#6b7280" }}>Generating QR…</div>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                  Show this QR to the PM scanner. Token is valid for about 60 seconds.
                </div>
                <div style={{ marginTop: 10 }}>
                  <label style={{ fontWeight: 700 }}>Token (fallback)</label>
                  <input readOnly value={qrToken} />
                </div>
              </>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 14,
              }}
            >
              <button className="btn" onClick={closeQR}>
                Close
              </button>
              {!qrError && qrJob && (
                <button className="btn primary" onClick={() => openQR(qrJob, qrDir)}>
                  Regenerate
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
