// web/src/pages/MyJobs.jsx
import React, { useEffect, useMemo, useState } from "react";
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
    return <span style={{ fontSize: 12, color: "#6b7280" }}>No transport option</span>;
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

/* ---- Parking receipt upload helpers ---- */
const MAX_RECEIPT_BYTES = 3 * 1024 * 1024;

// backend only supports png/jpeg/jpg/webp (your saveDataUrlImage regex)
function isSupportedReceiptFile(file) {
  const mime = String(file?.type || "").toLowerCase();
  const name = String(file?.name || "").toLowerCase();
  const okMime = ["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(mime);
  const okExt =
    name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".webp");
  return okMime || okExt;
}

async function fileToDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Failed to read image."));
    r.readAsDataURL(file);
  });
}

function toNiceErr(e) {
  const raw = String(e?.payload?.error || e?.message || e || "");
  if (raw.includes("Cannot POST") && raw.includes("/parking-receipt")) {
    return "Backend route missing: POST /jobs/:id/parking-receipt (server needs update).";
  }
  try {
    const j = JSON.parse(raw);
    if (j?.error) return j.error;
    if (j?.message) return j.message;
  } catch {}
  return raw || "Upload failed. Please try again.";
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

  // Parking receipt draft (per job)
  // draft[jobId] = { fileName, mime, dataUrl, uploading, error, okMsg }
  const [receiptDraft, setReceiptDraft] = useState({});
  const [imgOpen, setImgOpen] = useState(null);

  // force-remount file input when user clicks Clear (so selecting the SAME file again works)
  const [receiptInputKey, setReceiptInputKey] = useState({});
  function bumpInputKey(jobId) {
    setReceiptInputKey((prev) => ({ ...prev, [jobId]: (prev[jobId] || 0) + 1 }));
  }

  function setReceipt(jobId, patch) {
    setReceiptDraft((prev) => ({
      ...prev,
      [jobId]: { ...(prev[jobId] || {}), ...patch },
    }));
  }

  function clearReceipt(jobId) {
    setReceiptDraft((prev) => {
      const next = { ...prev };
      delete next[jobId];
      return next;
    });
    bumpInputKey(jobId);
  }

  async function refreshMyReceipts(jobId) {
    try {
      const r = await apiGet(`/jobs/${jobId}/parking-receipt/me`);
      const list = Array.isArray(r?.receipts) ? r.receipts : [];
      setJobs((old) => old.map((x) => (x.id === jobId ? { ...x, myParkingReceipts: list } : x)));
    } catch {
      // ignore
    }
  }

  // load "my jobs" + full job + my receipts
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const mine = await apiGet("/me/jobs");
        const onlyApproved = (mine || []).filter((j) => j.myStatus === "approved");

        const full = await Promise.all(
          onlyApproved.map(async (j) => {
            let fj = j;
            try {
              fj = { ...j, ...(await apiGet(`/jobs/${j.id}`)) };
            } catch {}

            try {
              const meR = await apiGet(`/jobs/${j.id}/parking-receipt/me`);
              const myList = Array.isArray(meR?.receipts) ? meR.receipts : [];
              fj = { ...fj, myParkingReceipts: myList };
            } catch {
              fj = { ...fj, myParkingReceipts: [] };
            }

            return fj;
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

  /* ---------- geo ---------- */
  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setLocMsg("Location not supported by browser.");
      return;
    }

    let active = true;

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
        } catch {}
      }
      if (Object.keys(map).length) setScannerInfo((prev) => ({ ...prev, ...map }));
    };
    fetchAll();
    timer = setInterval(fetchAll, 15000);
    return () => clearInterval(timer);
  }, [jobs, loc]);

  /* ---------- recompute distances ---------- */
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
        if (j.error === "not_approved") msg = "You are not approved for this job yet. Please contact the PM.";
        else if (j.error === "too_far") msg = "You are too far from the event scanner location.";
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
    return `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(qrToken)}`;
  }, [qrToken]);

  /* ---------- Parking receipt ---------- */
  async function onPickReceipt(jobId, file) {
    if (!file) return;

    if (!isSupportedReceiptFile(file)) {
      setReceipt(jobId, {
        error: "Please select a PNG/JPG/WEBP image (HEIC is not supported by the backend).",
        okMsg: null,
      });
      return;
    }

    if (file.size > MAX_RECEIPT_BYTES) {
      setReceipt(jobId, {
        error: `Image is too large. Max ${(MAX_RECEIPT_BYTES / 1024 / 1024).toFixed(0)}MB.`,
        okMsg: null,
      });
      return;
    }

    try {
      setReceipt(jobId, { uploading: true, error: null, okMsg: null });
      const dataUrl = await fileToDataUrl(file);

      setReceipt(jobId, {
        uploading: false,
        fileName: file.name || "receipt.jpg",
        mime: file.type || "image/jpeg",
        dataUrl,
        error: null,
        okMsg: null,
      });
    } catch {
      setReceipt(jobId, { uploading: false, error: "Failed to load image preview." });
    }
  }

  async function uploadReceipt(job) {
    const jobId = job.id;
    const d = receiptDraft[jobId];

    if (!d?.dataUrl) {
      setReceipt(jobId, { error: "Please choose a receipt image first." });
      return;
    }

    try {
      setReceipt(jobId, { uploading: true, error: null, okMsg: null });

      const res = await apiPost(`/jobs/${jobId}/parking-receipt`, {
        imageDataUrl: d.dataUrl,
        fileName: d.fileName,
        mime: d.mime,
      });

      const receipt = res?.receipt || null;
      const photoUrl = receipt?.photoUrl || res?.photoUrl || null;
      if (!photoUrl) throw new Error("Upload succeeded but missing receipt URL.");

      // ✅ persist in UI list (so it "stays there")
      setJobs((old) =>
        old.map((x) =>
          x.id === jobId
            ? {
                ...x,
                myParkingReceipts: [receipt, ...(Array.isArray(x.myParkingReceipts) ? x.myParkingReceipts : [])],
              }
            : x
        )
      );

      // ✅ IMPORTANT: do NOT clear draft automatically (so your selected file “stays”)
      setReceipt(jobId, { uploading: false, error: null, okMsg: "Uploaded ✅ (You can upload more or clear)" });
      // If you WANT to auto-clear after upload, uncomment:
      // clearReceipt(jobId);
    } catch (e) {
      setReceipt(jobId, { uploading: false, error: toNiceErr(e), okMsg: null });
    }
  }

  async function deleteUploadedReceipt(jobId, receiptId) {
    try {
      await apiPost(`/jobs/${jobId}/parking-receipt/${receiptId}/delete`, {});
      setJobs((old) =>
        old.map((x) =>
          x.id === jobId
            ? { ...x, myParkingReceipts: (x.myParkingReceipts || []).filter((r) => r?.id !== receiptId) }
            : x
        )
      );
    } catch (e) {
      setReceipt(jobId, { error: toNiceErr(e) });
    }
  }

  return (
    <div className="container" style={{ paddingTop: 16 }}>
      <div className="card">
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 8 }}>My Jobs</div>

        {jobs.length === 0 ? (
          <div style={{ color: "#6b7280" }}>No approved jobs yet.</div>
        ) : (
          jobs.map((j) => {
            const s = scannerInfo[j.id];
            const dist = s?.dist;
            const { isVirtual, label } = deriveKind(j);

            const yourLocLine = loc
              ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}${loc.acc ? ` (±${Math.round(loc.acc)} m)` : ""} · ${dayjs(
                  loc.ts
                ).format("HH:mm:ss")}`
              : locMsg || "Getting your location…";

            const pa = parkingRM(j);
            const lu = j.loadingUnload || {};
            const ec = j.earlyCall || {};
            const payForViewer = buildPayForViewer(j, user);

            const myReceipts = Array.isArray(j.myParkingReceipts) ? j.myParkingReceipts : [];
            const draft = receiptDraft[j.id] || {};

            const canShowReceiptUI = !!j?.transportOptions?.own || pa != null;

            return (
              <div key={j.id} className="card" style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{j.title}</div>
                    <div className="status" style={{ marginTop: 6 }}>
                      {j.myStatus} · {j.status}
                    </div>
                    <div style={{ color: "#374151", marginTop: 4 }}>{fmtRange(j.startTime, j.endTime)}</div>

                    <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                      <div>
                        <strong>Session</strong> <span style={{ marginLeft: 8 }}>{label}</span>
                      </div>
                      <div>
                        <strong>Venue</strong> <span style={{ marginLeft: 8 }}>{j.venue || "-"}</span>
                      </div>
                      <div>
                        <strong>Description</strong>
                        <div style={{ marginTop: 4, color: "#374151" }}>{j.description || "-"}</div>
                      </div>

                      <div>
                        <strong>Transport</strong>
                        <div style={{ marginTop: 6 }}>
                          <TransportBadges job={j} />
                        </div>
                        {pa != null && (
                          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                            Transport / parking allowance: RM{pa} (if applicable)
                          </div>
                        )}
                      </div>

                      <div style={{ display: "grid", gap: 4 }}>
                        <div>
                          <strong>Allowances</strong>
                        </div>
                        <div style={{ fontSize: 14, color: "#374151" }}>
                          Early Call:{" "}
                          {ec?.enabled ? `Yes (RM${Number(ec.amount || 0)}, ≥ ${Number(ec.thresholdHours || 0)}h)` : "No"}
                        </div>
                        <div style={{ fontSize: 14, color: "#374151" }}>
                          Loading & Unloading:{" "}
                          {lu?.enabled
                            ? `Yes (RM${Number(lu.price || 0)} / helper, quota ${Number(lu.quota || 0)})`
                            : "No"}
                        </div>
                      </div>

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

                      {/* ✅ Parking receipt upload + list */}
                      {canShowReceiptUI && (
                        <div style={{ marginTop: 4 }}>
                          <strong>Parking Receipt</strong>

                          <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
                            {/* uploaded list (persists after upload) */}
                            <div style={{ display: "grid", gap: 8 }}>
                              {myReceipts.length === 0 ? (
                                <div style={{ fontSize: 13, color: "#6b7280" }}>No receipt uploaded yet.</div>
                              ) : (
                                myReceipts.map((r) => (
                                  <div
                                    key={r.id}
                                    style={{
                                      display: "flex",
                                      gap: 10,
                                      alignItems: "center",
                                      flexWrap: "wrap",
                                      border: "1px solid #eee",
                                      borderRadius: 10,
                                      padding: 10,
                                    }}
                                  >
                                    <span
                                      className="status"
                                      style={{
                                        background: "#ecfdf5",
                                        color: "#065f46",
                                        border: "1px solid #6ee7b7",
                                      }}
                                    >
                                      Uploaded ✅
                                    </span>
                                    <span style={{ fontSize: 13, color: "#374151" }}>
                                      {dayjs(r.createdAt).format("DD MMM HH:mm")}
                                    </span>

                                    <button className="btn" onClick={() => setImgOpen(r.photoUrl)}>
                                      View
                                    </button>

                                    <button className="btn" onClick={() => deleteUploadedReceipt(j.id, r.id)}>
                                      Remove
                                    </button>
                                  </div>
                                ))
                              )}

                              {/* optional refresh */}
                              <div>
                                <button className="btn" onClick={() => refreshMyReceipts(j.id)}>
                                  Refresh receipts
                                </button>
                              </div>
                            </div>

                            {/* chooser + preview + upload */}
                            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                              <input
                                key={`${j.id}-${receiptInputKey[j.id] || 0}`}
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                capture="environment"
                                onChange={(e) => onPickReceipt(j.id, e.target.files?.[0])}
                              />

                              {/* show chosen filename even if browser shows "No file chosen" */}
                              {draft?.fileName && (
                                <span style={{ fontSize: 13, color: "#374151" }}>
                                  Selected: <strong>{draft.fileName}</strong>
                                </span>
                              )}

                              {draft?.dataUrl && (
                                <>
                                  <button className="btn" onClick={() => setImgOpen(draft.dataUrl)}>
                                    Preview
                                  </button>
                                  <button className="btn" onClick={() => clearReceipt(j.id)}>
                                    Clear
                                  </button>
                                </>
                              )}

                              <button
                                className="btn primary"
                                disabled={!!draft.uploading || !draft?.dataUrl}
                                onClick={() => uploadReceipt(j)}
                              >
                                {draft.uploading ? "Uploading..." : "Upload receipt"}
                              </button>
                            </div>

                            <div style={{ fontSize: 12, color: "#6b7280" }}>
                              Tip: snap a clear photo of the receipt. Max {(MAX_RECEIPT_BYTES / 1024 / 1024).toFixed(0)}MB.
                            </div>

                            {draft?.error && <div style={{ color: "crimson", fontSize: 13 }}>{draft.error}</div>}
                            {draft?.okMsg && <div style={{ color: "#065f46", fontSize: 13, fontWeight: 700 }}>{draft.okMsg}</div>}
                          </div>
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: 10, fontSize: 14 }}>
                      <strong>Your location:</strong>{" "}
                      <span style={{ color: loc ? "#374151" : "#b91c1c" }}>{yourLocLine}</span>
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
              <div style={{ padding: 10, border: "1px solid var(--red)", borderRadius: 8, color: "var(--red)" }}>
                {qrError}
              </div>
            ) : (
              <>
                <div style={{ display: "flex", justifyContent: "center", margin: "6px 0 10px" }}>
                  {qrToken ? (
                    <img
                      src={qrImgSrc}
                      alt="QR code"
                      style={{ width: 260, height: 260, borderRadius: 8, border: "1px solid var(--border)" }}
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

      {/* ---------- Image preview MODAL ---------- */}
      {imgOpen && (
        <div
          onClick={() => setImgOpen(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 70,
            background: "rgba(0,0,0,.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: "min(860px, 96vw)", padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 800 }}>Image Preview</div>
              <button className="btn" onClick={() => setImgOpen(null)}>
                Close
              </button>
            </div>
            <div style={{ marginTop: 10 }}>
              <img
                src={imgOpen}
                alt="preview"
                style={{
                  width: "100%",
                  maxHeight: "75vh",
                  objectFit: "contain",
                  borderRadius: 12,
                  border: "1px solid #eee",
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
