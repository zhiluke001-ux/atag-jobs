// web/src/pages/MyJobs.jsx
import React, { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { apiGet, apiPost } from "../api";

/* ---------- geo helpers ---------- */
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
function fmtRange(start, end) {
  try {
    const S = dayjs(start),
      E = dayjs(end);
    const sameDay = S.isSame(E, "day");
    const d = S.format("YYYY/MM/DD");
    const t1 = S.format("hA");
    const t2 = E.format("hA");
    return sameDay
      ? `${d}  ${t1} — ${t2}`
      : `${S.format("YYYY/MM/DD hA")} — ${E.format("YYYY/MM/DD hA")}`;
  } catch {
    return "";
  }
}

/* ------- shared pay/session helpers ------- */
const num = (v) =>
  v === null || v === undefined || v === "" ? null : Number(v);
const money = (v) => {
  const n = num(v);
  return Number.isFinite(n) && n > 0
    ? `RM${n % 1 === 0 ? n : n.toFixed(2)}`
    : null;
};
function deriveViewerRank(user) {
  const raw = (
    user?.ptRole ||
    user?.jobRole ||
    user?.rank ||
    user?.tier ||
    user?.level ||
    user?.roleRank ||
    ""
  )
    .toString()
    .toLowerCase();
  if (["lead", "leader", "supervisor", "captain"].includes(raw)) return "lead";
  if (["senior", "sr"].includes(raw)) return "senior";
  return "junior";
}
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
    : [
        "half_day",
        "full_day",
        "2d1n",
        "3d2n",
        "hourly_by_role",
        "hourly_flat",
      ].includes(kind)
    ? kind
    : "half_day";

  const label =
    resolvedKind === "virtual"
      ? "Virtual"
      : resolvedKind === "half_day"
      ? "Physical — Half Day"
      : resolvedKind === "full_day"
      ? "Physical — Full Day"
      : resolvedKind === "2d1n"
      ? "Physical — 2D1N"
      : resolvedKind === "3d2n"
      ? "Physical — 3D2N"
      : resolvedKind === "hourly_by_role"
      ? "Physical — Hourly (by role)"
      : "Physical — Backend (flat hourly)";

  return { isVirtual, kind: resolvedKind, label };
}
function parkingRM(job) {
  const r = job?.rate || {};
  const v = Number.isFinite(r.parkingAllowance)
    ? r.parkingAllowance
    : Number.isFinite(r.transportAllowance)
    ? r.transportAllowance
    : Number.isFinite(r.transportBus)
    ? r.transportBus
    : null;
  return v == null ? null : Math.round(Number(v));
}
function otSuffix(hourlyRM, otRM) {
  if (otRM && otRM !== hourlyRM) return ` (OT ${otRM}/hr after end)`;
  if (hourlyRM) return ` (OT billed hourly after end)`;
  return "";
}
function buildPayForViewer(job, user) {
  const { kind } = deriveKind(job);
  const rank = deriveViewerRank(user);
  const tr = job?.rate?.tierRates || job?.roleRates || {};
  const tier = tr?.[rank] || {};
  const flat = job?.rate?.flatHourly || null;

  if (kind === "hourly_flat") {
    const base = money(flat?.base ?? tier.base);
    const ot = money(flat?.otRatePerHour);
    if (base || ot)
      return `${base ? `${base}/hr` : ""}${otSuffix(base, ot)}`;
    return "-";
  }

  if (kind === "virtual" || kind === "hourly_by_role") {
    const base = money(tier.base);
    const ot = money(tier.otRatePerHour);
    if (base || ot)
      return `${base ? `${base}/hr` : ""}${otSuffix(base, ot)}`;
    return "-";
  }

  const pick = (k) => {
    if (k === "half_day") return tier?.halfDay ?? tier?.specificPayment ?? null;
    if (k === "full_day") return tier?.fullDay ?? tier?.specificPayment ?? null;
    if (k === "2d1n") return tier?.twoD1N ?? tier?.specificPayment ?? null;
    if (k === "3d2n") return tier?.threeD2N ?? tier?.specificPayment ?? null;
    return null;
  };
  const sessionRM = money(pick(kind));
  const hasAddon =
    job?.session?.hourlyEnabled ||
    job?.physicalHourlyEnabled ||
    tier?.payMode === "specific_plus_hourly";
  const base = money(tier.base);
  const ot = money(tier.otRatePerHour);

  if (sessionRM) {
    if (hasAddon && (base || ot))
      return `${sessionRM}  +  ${base ? `${base}/hr` : ""}${otSuffix(
        base,
        ot
      )}`;
    return sessionRM;
  }

  if (base || ot) return `${base ? `${base}/hr` : ""}${otSuffix(base, ot)}`;
  return "-";
}

/* ------- UI helpers ------- */
function TransportBadges({ job }) {
  const t = job?.transportOptions || {};
  const items = [
    ...(t.bus ? [{ text: "ATAG Bus", bg: "#eef2ff", color: "#3730a3" }] : []),
    ...(t.own ? [{ text: "Own Transport", bg: "#ecfeff", color: "#155e75" }] : []),
  ];
  if (!items.length)
    return (
      <span style={{ fontSize: 12, color: "#6b7280" }}>
        No transport option
      </span>
    );
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {items.map((it, i) => (
        <span
          key={i}
          style={{
            background: it.bg,
            color: it.color,
            padding: "2px 8px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {it.text}
        </span>
      ))}
    </div>
  );
}

// ---- Discord constants ----
const DISCORD_URL = "https://discord.gg/AwGaCG3W";
const BTN_BLACK_STYLE = { background: "#000", color: "#fff", borderColor: "#000" };

/* ========================== Page ========================== */
export default function MyJobs({ navigate, user }) {
  const [jobs, setJobs] = useState([]);

  // live user location
  const [loc, setLoc] = useState(null); // { lat, lng, acc, ts }
  const [locMsg, setLocMsg] = useState("");

  // last-known scanner info per job
  const [scannerInfo, setScannerInfo] = useState({}); // { [jobId]: {lat,lng,updatedAt,dist} }

  // QR modal state
  const [qrOpen, setQrOpen] = useState(false);
  const [qrToken, setQrToken] = useState("");
  const [qrDir, setQrDir] = useState("in"); // "in" | "out"
  const [qrJob, setQrJob] = useState(null);
  const [qrError, setQrError] = useState("");

  // load "my jobs" and hydrate with full /jobs/:id so pay fields are complete
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const mine = await apiGet("/me/jobs");
        // 🔴 only approved
        const onlyApproved = (mine || []).filter(
          (j) => j.myStatus === "approved"
        );

        const full = await Promise.all(
          onlyApproved.map(async (j) => {
            try {
              const fj = await apiGet(`/jobs/${j.id}`);
              return { ...j, ...fj };
            } catch {
              return j;
            }
          })
        );
        if (mounted) setJobs(full || []);
      } catch {
        if (mounted) setJobs([]);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // watch user location
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setLocMsg("Location not supported by browser.");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) =>
        setLoc({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          acc: p.coords.accuracy ?? null,
          ts: Date.now(),
        }),
      () =>
        setLocMsg("Please allow location to generate QR and show distance."),
      { enableHighAccuracy: true, maximumAge: 2_000, timeout: 10_000 }
    );
    return () => {
      try {
        navigator.geolocation.clearWatch(id);
      } catch {}
    };
  }, []);

  // fetch scanner location for ongoing jobs; refresh every 15s
  useEffect(() => {
    let timer;
    const fetchAll = async () => {
      const map = {};
      for (const j of jobs) {
        if (j.status !== "ongoing") continue;
        try {
          const s = await apiGet(`/jobs/${j.id}/scanner`);
          const dist =
            s && loc ? haversineMeters(loc, { lat: s.lat, lng: s.lng }) : null;
          map[j.id] = { ...s, dist };
        } catch {
          /* ignore */
        }
      }
      if (Object.keys(map).length)
        setScannerInfo((prev) => ({ ...prev, ...map }));
    };
    fetchAll();
    timer = setInterval(fetchAll, 15000);
    return () => clearInterval(timer);
  }, [jobs, loc]);

  /* ---------- QR generation ---------- */
  async function openQR(job, direction) {
    setQrError("");
    setQrToken("");
    setQrJob(job);
    setQrDir(direction);

    // skip QR entirely for virtual mode
    const { isVirtual } = deriveKind(job);
    if (isVirtual) {
      setQrError(
        "Virtual job — no scan required. PM/Admin will mark attendance."
      );
      setQrOpen(true);
      return;
    }

    // need a reasonably-fresh location
    let here = loc;
    if (!here && "geolocation" in navigator) {
      try {
        const p = await new Promise((res, rej) =>
          navigator.geolocation.getCurrentPosition(
            (pos) =>
              res({
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                acc: pos.coords.accuracy ?? null,
                ts: Date.now(),
              }),
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
        const j = JSON.parse(String(e));
        if (j.error === "not_approved")
          msg = "You are not approved for this job yet. Please contact the PM.";
        else if (j.error === "not_ongoing")
          msg = "Scanning only opens when the job is ongoing.";
        else if (j.error === "too_far")
          msg = "You are too far from the event scanner location.";
        else msg = j.error || msg;
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
    return `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(
      qrToken
    )}`;
  }, [qrToken]);

  return (
    <div className="container" style={{ paddingTop: 16 }}>
      <div className="card">
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>
          My Jobs
        </div>

        {jobs.length === 0 ? (
          <div style={{ color: "#6b7280" }}>No approved jobs yet.</div>
        ) : (
          jobs.map((j) => {
            const s = scannerInfo[j.id];
            const dist = s?.dist;
            const { isVirtual, label } = deriveKind(j);

            const yourLocLine = loc
              ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(
                  5
                )}${loc.acc ? ` (±${Math.round(loc.acc)} m)` : ""} · ${dayjs(
                  loc.ts
                ).format("HH:mm:ss")}`
              : locMsg || "—";

            const pa = parkingRM(j);
            const lu = j.loadingUnload || {};
            const ec = j.earlyCall || {};
            const payForViewer = buildPayForViewer(j, user);

            return (
              <div
                key={j.id}
                className="card"
                style={{ marginBottom: 10 }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>
                      {j.title}
                    </div>
                    <div className="status" style={{ marginTop: 6 }}>
                      {j.myStatus} · {j.status}
                    </div>
                    <div style={{ color: "#374151", marginTop: 4 }}>
                      {fmtRange(j.startTime, j.endTime)}
                    </div>

                    <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                      <div>
                        <strong>Session</strong>{" "}
                        <span style={{ marginLeft: 8 }}>{label}</span>
                      </div>
                      <div>
                        <strong>Venue</strong>{" "}
                        <span style={{ marginLeft: 8 }}>
                          {j.venue || "-"}
                        </span>
                      </div>
                      <div>
                        <strong>Description</strong>
                        <div
                          style={{
                            marginTop: 4,
                            color: "#374151",
                          }}
                        >
                          {j.description || "-"}
                        </div>
                      </div>
                      <div>
                        <strong>Transport</strong>
                        <div style={{ marginTop: 6 }}>
                          <TransportBadges job={j} />
                        </div>
                        {pa != null && (
                          <div
                            style={{
                              fontSize: 12,
                              color: "#6b7280",
                              marginTop: 4,
                            }}
                          >
                            ATAG Bus allowance: RM{pa} per person (if selected)
                          </div>
                        )}
                      </div>

                      {/* Allowances */}
                      <div style={{ display: "grid", gap: 4 }}>
                        <div>
                          <strong>Allowances</strong>
                        </div>
                        <div style={{ fontSize: 14, color: "#374151" }}>
                          Early Call:{" "}
                          {ec?.enabled
                            ? `Yes (RM${Number(
                                ec.amount || 0
                              )}, ≥ ${Number(ec.thresholdHours || 0)}h)`
                            : "No"}
                        </div>
                        <div style={{ fontSize: 14, color: "#374151" }}>
                          Loading & Unloading:{" "}
                          {lu?.enabled
                            ? `Yes (RM${Number(
                                lu.price || 0
                              )} / helper, quota ${Number(lu.quota || 0)})`
                            : "No"}
                        </div>
                      </div>

                      {/* Pay — viewer specific */}
                      <div>
                        <strong>Pay</strong>
                        <div
                          style={{
                            marginTop: 6,
                            fontFamily:
                              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                            fontSize: 13,
                            lineHeight: 1.5,
                          }}
                        >
                          {payForViewer}
                        </div>
                      </div>
                    </div>

                    <div style={{ marginTop: 10, fontSize: 14 }}>
                      <strong>Your location:</strong>{" "}
                      <span style={{ color: loc ? "#374151" : "#b91c1c" }}>
                        {yourLocLine}
                      </span>
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
                      {j.status === "ongoing" && !isVirtual && (
                        <span
                          className="status"
                          title={
                            s?.updatedAt
                              ? `updated ${dayjs(s.updatedAt).format(
                                  "HH:mm:ss"
                                )}`
                              : ""
                          }
                        >
                          Scanner distance:{" "}
                          {dist == null ? "—" : `${dist} m`}
                        </span>
                      )}
                      {isVirtual && (
                        <span
                          className="status"
                          style={{
                            background: "#eef2ff",
                            color: "#3730a3",
                          }}
                        >
                          Virtual · PM will mark
                        </span>
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "start",
                    }}
                  >
                    <button
                      className="btn"
                      onClick={() => navigate(`#/jobs/${j.id}`)}
                    >
                      View details
                    </button>
                    {j.myStatus === "approved" && (
                      <a
                        href={DISCORD_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="btn"
                        style={BTN_BLACK_STYLE}
                      >
                        Join Discord Channel
                      </a>
                    )}
                  </div>
                </div>

                {/* Actions */}
                {!isVirtual && (
                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      marginTop: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      className="btn primary"
                      onClick={() => openQR(j, "in")}
                    >
                      Get Check-in QR
                    </button>
                    <button className="btn" onClick={() => openQR(j, "out")}>
                      Get Check-out QR
                    </button>
                  </div>
                )}
                {isVirtual && (
                  <div
                    style={{ marginTop: 10, fontSize: 13, color: "#6b7280" }}
                  >
                    This is a virtual job — no scanning needed. The PM/Admin
                    will tick your attendance.
                  </div>
                )}
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
            <div
              style={{
                fontWeight: 800,
                fontSize: 16,
                marginBottom: 8,
              }}
            >
              {qrJob
                ? `${qrDir === "in" ? "Check-in" : "Check-out"} QR — ${
                    qrJob.title
                  }`
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
                <div
                  style={{
                    fontSize: 12,
                    color: "#6b7280",
                    marginTop: 4,
                  }}
                >
                  Show this QR to the PM scanner. Token is valid for about 60
                  seconds.
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
                <button
                  className="btn primary"
                  onClick={() => openQR(qrJob, qrDir)}
                >
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
