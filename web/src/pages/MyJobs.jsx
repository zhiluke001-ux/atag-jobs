// web/src/pages/MyJobs.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import { apiGet, apiPost } from "../api";

/* ---------- geo helpers ---------- */
const toRad = (d) => (d * Math.PI) / 180;
function haversineMeters(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
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
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const money = (v) => {
  const n = num(v);
  return Number.isFinite(n) && n > 0 ? `RM${n % 1 === 0 ? n : n.toFixed(2)}` : null;
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
    : ["half_day", "full_day", "2d1n", "3d2n", "hourly_by_role", "hourly_flat"].includes(kind)
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
    if (base || ot) return `${base ? `${base}/hr` : ""}${otSuffix(base, ot)}`;
    return "-";
  }

  if (kind === "virtual" || kind === "hourly_by_role") {
    const base = money(tier.base);
    const ot = money(tier.otRatePerHour);
    if (base || ot) return `${base ? `${base}/hr` : ""}${otSuffix(base, ot)}`;
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
      return `${sessionRM}  +  ${base ? `${base}/hr` : ""}${otSuffix(base, ot)}`;
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
const DISCORD_URL = "https://discord.gg/ZAeR28z3p2";
const BTN_BLACK_STYLE = { background: "#000", color: "#fff", borderColor: "#000" };

// geo options similar to PMJobDetails
const GEO_OPTS = { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 };

// Parking receipt constraints (match backend: decoded max 2MB)
const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;

function isPartTimerUser(user) {
  const r = (user?.role || user?.userRole || "").toString().toLowerCase();
  return r === "part-timer" || r === "parttimer" || r === "pt";
}

function normalizeErr(e) {
  try {
    const j = JSON.parse(String(e));
    return j?.error || j?.message || String(e);
  } catch {
    return String(e);
  }
}

/* ========================== Page ========================== */
export default function MyJobs({ navigate, user }) {
  const [jobs, setJobs] = useState([]);

  // live user location
  const [loc, setLoc] = useState(null); // { lat, lng, acc, ts }
  const [locMsg, setLocMsg] = useState("Getting your location…");

  // last-known scanner info per job
  const [scannerInfo, setScannerInfo] = useState({}); // { [jobId]: {lat,lng,updatedAt,dist} }

  // QR modal state
  const [qrOpen, setQrOpen] = useState(false);
  const [qrToken, setQrToken] = useState("");
  const [qrDir, setQrDir] = useState("in"); // "in" | "out"
  const [qrJob, setQrJob] = useState(null);
  const [qrError, setQrError] = useState("");

  // Parking receipt states (per job)
  const [myReceipts, setMyReceipts] = useState({}); // { [jobId]: receiptObj }
  const [receiptDrafts, setReceiptDrafts] = useState({}); // { [jobId]: {fileName,dataUrl,amount,note,uploading,error,okMsg} }
  const receiptFileRef = useRef({}); // { [jobId]: HTMLInputElement }

  const isPT = isPartTimerUser(user);

  const setDraft = (jobId, patch) => {
    setReceiptDrafts((prev) => ({
      ...prev,
      [jobId]: { ...(prev[jobId] || {}), ...patch },
    }));
  };

  const clearFileInput = (jobId) => {
    const el = receiptFileRef.current?.[jobId];
    if (el) {
      try {
        el.value = "";
      } catch {}
    }
  };

  async function pickReceiptFile(jobId, file) {
    setDraft(jobId, { error: "", okMsg: "" });

    if (!file) {
      setDraft(jobId, { fileName: "", dataUrl: "" });
      clearFileInput(jobId);
      return;
    }

    if (!file.type?.startsWith("image/")) {
      setDraft(jobId, { error: "Please select an image file (JPG/PNG/WebP).", fileName: file.name });
      clearFileInput(jobId);
      return;
    }

    if (file.size > MAX_RECEIPT_BYTES) {
      setDraft(jobId, {
        error: "Image too large (max 2MB). Please compress / take a smaller screenshot.",
        fileName: file.name,
        dataUrl: "",
      });
      clearFileInput(jobId);
      return;
    }

    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.onerror = () => reject(new Error("Failed to read file."));
      fr.readAsDataURL(file);
    }).catch(() => "");

    if (!dataUrl?.startsWith("data:image/")) {
      setDraft(jobId, { error: "Failed to read image. Try another file.", fileName: file.name, dataUrl: "" });
      clearFileInput(jobId);
      return;
    }

    setDraft(jobId, { fileName: file.name, dataUrl });
  }

  async function refreshMyReceipt(jobId) {
    try {
      const r = await apiGet(`/jobs/${jobId}/parking-receipt/me`);
      const receipt = r?.receipt || r;
      if (receipt) setMyReceipts((prev) => ({ ...prev, [jobId]: receipt }));
    } catch {
      // no receipt yet (or endpoint returns 404) — ignore
    }
  }

  async function uploadReceipt(job) {
    const jobId = job.id;
    const d = receiptDrafts[jobId] || {};

    setDraft(jobId, { error: "", okMsg: "" });

    if (!d.dataUrl) {
      setDraft(jobId, { error: "Please choose an image first." });
      return;
    }

    setDraft(jobId, { uploading: true });

    try {
      const payload = { dataUrl: d.dataUrl };
      const amt = d.amount === "" || d.amount == null ? null : Number(d.amount);
      if (Number.isFinite(amt) && amt > 0) payload.amount = amt;
      if (d.note && String(d.note).trim()) payload.note = String(d.note).trim();

      const res = await apiPost(`/jobs/${jobId}/parking-receipt`, payload);

      // server might return {ok:true, receipt:{...}} or just receipt
      const receipt = res?.receipt || res;
      if (receipt) setMyReceipts((prev) => ({ ...prev, [jobId]: receipt }));

      setDraft(jobId, {
        uploading: false,
        okMsg: "Uploaded ✅",
        error: "",
        dataUrl: "",
        fileName: "",
        // keep amount/note in case user wants to upload again
      });
      clearFileInput(jobId);

      // also re-fetch to guarantee latest server shape
      refreshMyReceipt(jobId);
    } catch (e) {
      const msg = normalizeErr(e);

      let nice = "Failed to upload receipt.";
      if (msg.includes("not_approved")) nice = "You are not approved for this job yet. Please contact PM.";
      else if (msg.includes("image_too_large")) nice = "Image too large. Please upload < 2MB.";
      else if (msg.includes("bad_data_url")) nice = "Invalid image format. Please re-select the image.";
      else if (msg) nice = msg;

      setDraft(jobId, { uploading: false, error: nice });
    }
  }

  /* ---------- load "my jobs" ---------- */
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const mine = await apiGet("/me/jobs");
        const onlyApproved = (mine || []).filter((j) => j.myStatus === "approved");
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

  /* ---------- load my parking receipt per job (part timers) ---------- */
  useEffect(() => {
    let active = true;
    if (!isPT || !jobs?.length) return;

    (async () => {
      const map = {};
      await Promise.all(
        jobs.map(async (j) => {
          try {
            const r = await apiGet(`/jobs/${j.id}/parking-receipt/me`);
            const receipt = r?.receipt || r;
            if (receipt) map[j.id] = receipt;
          } catch {
            // ignore: likely no receipt yet
          }
        })
      );
      if (active && Object.keys(map).length) setMyReceipts((prev) => ({ ...prev, ...map }));
    })();

    return () => {
      active = false;
    };
  }, [isPT, jobs]);

  /* ---------- faster geo, like PMJobDetails ---------- */
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setLocMsg("Location not supported by browser.");
      return;
    }

    let active = true;

    // 1) immediate fetch
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (!active) return;
        setLoc({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          acc: p.coords.accuracy ?? null,
          ts: Date.now(),
        });
        setLocMsg("");
      },
      () => {
        if (!active) return;
        setLocMsg("Getting your location… allow location and try again.");
      },
      GEO_OPTS
    );

    // 2) continuous watch
    const id = navigator.geolocation.watchPosition(
      (p) => {
        if (!active) return;
        setLoc({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          acc: p.coords.accuracy ?? null,
          ts: Date.now(),
        });
        setLocMsg("");
      },
      () => {
        if (!active) return;
        setLocMsg("Getting your location…");
      },
      GEO_OPTS
    );

    return () => {
      active = false;
      try {
        navigator.geolocation.clearWatch(id);
      } catch {}
    };
  }, []);

  /* ---------- fetch scanner location for ongoing jobs ---------- */
  useEffect(() => {
    let timer;
    const fetchAll = async () => {
      const map = {};
      for (const j of jobs) {
        if (j.status !== "ongoing") continue;
        try {
          const s = await apiGet(`/jobs/${j.id}/scanner`);
          map[j.id] = {
            ...s,
            dist: s && loc ? haversineMeters(loc, { lat: s.lat, lng: s.lng }) : null,
          };
        } catch {
          /* ignore */
        }
      }
      if (Object.keys(map).length) setScannerInfo((prev) => ({ ...prev, ...map }));
    };
    fetchAll();
    timer = setInterval(fetchAll, 15000);
    return () => clearInterval(timer);
  }, [jobs, loc]);

  /* ---------- when user location changes, recompute distances ---------- */
  useEffect(() => {
    if (!loc) return;
    setScannerInfo((prev) => {
      const next = {};
      for (const [jobId, info] of Object.entries(prev)) {
        if (info && info.lat != null && info.lng != null) {
          next[jobId] = { ...info, dist: haversineMeters(loc, { lat: info.lat, lng: info.lng }) };
        } else {
          next[jobId] = info;
        }
      }
      return next;
    });
  }, [loc]);

  /* ---------- QR generation ---------- */
  async function openQR(job, direction) {
    setQrError("");
    setQrToken("");
    setQrJob(job);
    setQrDir(direction);

    const { isVirtual } = deriveKind(job);
    if (isVirtual) {
      setQrError("Virtual job — no scan required. PM/Admin will mark attendance.");
      setQrOpen(true);
      return;
    }

    // ensure location
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
            GEO_OPTS
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
              ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}${
                  loc.acc ? ` (±${Math.round(loc.acc)} m)` : ""
                } · ${dayjs(loc.ts).format("HH:mm:ss")}`
              : locMsg || "Getting your location…";

            const pa = parkingRM(j);
            const lu = j.loadingUnload || {};
            const ec = j.earlyCall || {};
            const payForViewer = buildPayForViewer(j, user);

            const receipt = myReceipts[j.id];
            const draft = receiptDrafts[j.id] || {};

            const receiptImg =
              receipt?.photoUrlAbs ||
              receipt?.photoUrl ||
              receipt?.url ||
              receipt?.imageUrl ||
              "";

            const receiptUpdatedAt =
              receipt?.updatedAt || receipt?.createdAt || receipt?.uploadedAt || null;

            return (
              <div key={j.id} className="card" style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{j.title}</div>
                    <div className="status" style={{ marginTop: 6 }}>
                      {j.myStatus} · {j.status}
                    </div>
                    <div style={{ color: "#374151", marginTop: 4 }}>
                      {fmtRange(j.startTime, j.endTime)}
                    </div>

                    <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                      <div>
                        <strong>Session</strong> <span style={{ marginLeft: 8 }}>{label}</span>
                      </div>
                      <div>
                        <strong>Venue</strong> <span style={{ marginLeft: 8 }}>{j.venue || "-"}</span>
                      </div>
                      <div>
                        <strong>Description</strong>
                        <div style={{ marginTop: 4, color: "#374151" }}>
                          {j.description || "-"}
                        </div>
                      </div>
                      <div>
                        <strong>Transport</strong>
                        <div style={{ marginTop: 6 }}>
                          <TransportBadges job={j} />
                        </div>
                        {pa != null && (
                          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
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
                            ? `Yes (RM${Number(ec.amount || 0)}, ≥ ${Number(ec.thresholdHours || 0)}h)`
                            : "No"}
                        </div>
                        <div style={{ fontSize: 14, color: "#374151" }}>
                          Loading & Unloading:{" "}
                          {lu?.enabled
                            ? `Yes (RM${Number(lu.price || 0)} / helper, quota ${Number(lu.quota || 0)})`
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
                          title={s?.updatedAt ? `updated ${dayjs(s.updatedAt).format("HH:mm:ss")}` : ""}
                        >
                          Scanner distance: {dist == null ? "—" : `${dist} m`}
                        </span>
                      )}
                      {isVirtual && (
                        <span className="status" style={{ background: "#eef2ff", color: "#3730a3" }}>
                          Virtual · PM will mark
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, alignItems: "start" }}>
                    <button className="btn" onClick={() => navigate(`#/jobs/${j.id}`)}>
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
                  <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                    <button className="btn primary" onClick={() => openQR(j, "in")}>
                      Get Check-in QR
                    </button>
                    <button className="btn" onClick={() => openQR(j, "out")}>
                      Get Check-out QR
                    </button>
                  </div>
                )}
                {isVirtual && (
                  <div style={{ marginTop: 10, fontSize: 13, color: "#6b7280" }}>
                    This is a virtual job — no scanning needed. The PM/Admin will tick your attendance.
                  </div>
                )}

                {/* ================= Parking Receipt Uploader (Part-timer) ================= */}
                {isPT && (
                  <div
                    style={{
                      marginTop: 12,
                      paddingTop: 12,
                      borderTop: "1px solid var(--border)",
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>Parking Receipt</div>

                    {/* Existing receipt */}
                    {receiptImg ? (
                      <div
                        style={{
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          padding: 10,
                          display: "grid",
                          gap: 8,
                          background: "#fafafa",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                          <div style={{ fontSize: 13, color: "#374151" }}>
                            <strong>Status:</strong> Uploaded
                            {receiptUpdatedAt ? (
                              <span style={{ color: "#6b7280" }}>
                                {" "}
                                · {dayjs(receiptUpdatedAt).format("YYYY/MM/DD HH:mm")}
                              </span>
                            ) : null}
                          </div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button className="btn" onClick={() => refreshMyReceipt(j.id)}>
                              Refresh
                            </button>
                            <a
                              className="btn"
                              href={receiptImg}
                              target="_blank"
                              rel="noreferrer"
                              title="Open receipt"
                            >
                              Open
                            </a>
                          </div>
                        </div>

                        {(receipt?.amount != null || receipt?.note) && (
                          <div style={{ fontSize: 13, color: "#374151" }}>
                            {receipt?.amount != null ? (
                              <span>
                                <strong>Amount:</strong> RM{Number(receipt.amount).toFixed(2)}
                              </span>
                            ) : null}
                            {receipt?.note ? (
                              <span style={{ marginLeft: 10 }}>
                                <strong>Note:</strong> {receipt.note}
                              </span>
                            ) : null}
                          </div>
                        )}

                        <img
                          src={receiptImg}
                          alt="Parking receipt"
                          style={{
                            width: "min(520px, 100%)",
                            maxHeight: 360,
                            objectFit: "contain",
                            borderRadius: 8,
                            border: "1px solid var(--border)",
                            background: "#fff",
                          }}
                        />

                        <div style={{ fontSize: 12, color: "#6b7280" }}>
                          You can upload again to replace/update your receipt.
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 13, color: "#6b7280" }}>
                        No receipt uploaded yet.
                      </div>
                    )}

                    {/* Draft upload */}
                    <div
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: 10,
                        display: "grid",
                        gap: 10,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ fontSize: 13, color: "#374151" }}>
                          <strong>Upload / Replace</strong>{" "}
                          <span style={{ color: "#6b7280" }}>(max 2MB)</span>
                        </div>

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            className="btn"
                            onClick={() => {
                              setDraft(j.id, { fileName: "", dataUrl: "", error: "", okMsg: "" });
                              clearFileInput(j.id);
                            }}
                            disabled={!!draft.uploading}
                          >
                            Clear
                          </button>
                          <button
                            className="btn primary"
                            onClick={() => uploadReceipt(j)}
                            disabled={!!draft.uploading || !draft.dataUrl}
                            title={!draft.dataUrl ? "Choose an image first" : ""}
                          >
                            {draft.uploading ? "Uploading…" : "Upload"}
                          </button>
                        </div>
                      </div>

                      <div style={{ display: "grid", gap: 8 }}>
                        <input
                          ref={(el) => {
                            if (el) receiptFileRef.current[j.id] = el;
                          }}
                          type="file"
                          accept="image/*"
                          onChange={(e) => pickReceiptFile(j.id, e.target.files?.[0] || null)}
                        />

                        {draft.fileName ? (
                          <div style={{ fontSize: 12, color: "#6b7280" }}>
                            Selected: <strong>{draft.fileName}</strong>
                          </div>
                        ) : null}

                        <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 10 }}>
                          <div>
                            <label style={{ fontWeight: 700, fontSize: 12 }}>Amount (RM)</label>
                            <input
                              type="number"
                              step="0.01"
                              placeholder="e.g. 6.50"
                              value={draft.amount ?? ""}
                              onChange={(e) => setDraft(j.id, { amount: e.target.value, okMsg: "", error: "" })}
                            />
                          </div>
                          <div>
                            <label style={{ fontWeight: 700, fontSize: 12 }}>Note (optional)</label>
                            <input
                              placeholder="e.g. Parking at venue"
                              value={draft.note ?? ""}
                              onChange={(e) => setDraft(j.id, { note: e.target.value, okMsg: "", error: "" })}
                            />
                          </div>
                        </div>

                        {draft.dataUrl ? (
                          <img
                            src={draft.dataUrl}
                            alt="Receipt preview"
                            style={{
                              width: "min(520px, 100%)",
                              maxHeight: 360,
                              objectFit: "contain",
                              borderRadius: 8,
                              border: "1px solid var(--border)",
                              background: "#fff",
                            }}
                          />
                        ) : null}

                        {draft.error ? (
                          <div
                            style={{
                              padding: 10,
                              border: "1px solid var(--red)",
                              borderRadius: 8,
                              color: "var(--red)",
                            }}
                          >
                            {draft.error}
                          </div>
                        ) : null}

                        {draft.okMsg ? (
                          <div
                            style={{
                              padding: 10,
                              border: "1px solid #22c55e",
                              borderRadius: 8,
                              color: "#166534",
                              background: "#f0fdf4",
                            }}
                          >
                            {draft.okMsg}
                          </div>
                        ) : null}

                        <div style={{ fontSize: 12, color: "#6b7280" }}>
                          Tip: If your photo is huge, screenshot/crop it first so it stays under 2MB.
                        </div>
                      </div>
                    </div>
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
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>
              {qrJob ? `${qrDir === "in" ? "Check-in" : "Check-out"} QR — ${qrJob.title}` : "QR"}
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
                <div style={{ display: "flex", justifyContent: "center", margin: "6px 0 10px" }}>
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

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
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
