// web/src/pages/Status.jsx
import React, { useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import { apiGet, apiPatch, apiPost } from "../api";

/* ---------- URL helper (relative -> absolute) ---------- */
const API_BASE_CLEAN = (() => {
  try {
    const v = import.meta?.env?.VITE_API_BASE || import.meta?.env?.VITE_API_URL || "";
    return String(v || "").replace(/\/$/, "");
  } catch {
    return "";
  }
})();

function toAbsUrl(u) {
  if (!u) return "";
  const s = String(u);
  if (/^data:/i.test(s) || /^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return window.location.protocol + s;
  if (API_BASE_CLEAN) return API_BASE_CLEAN + (s.startsWith("/") ? s : `/${s}`);
  return s;
}

function pickFirstString(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function getVerifyPicUrl(u) {
  const raw = pickFirstString(u, [
    "verifyImageUrl",
    "verify_image_url",
    "verificationImageUrl",
    "verification_image_url",
    "verifyPhotoUrl",
    "verify_photo_url",
    "verificationPhotoUrl",
    "verification_photo_url",
    "verifyImageDataUrl",
    "verify_image_data_url",
    "verificationDataUrl",
    "verification_data_url",
  ]);
  return toAbsUrl(raw);
}

const MAX = 2 * 1024 * 1024;

export default function Status({ user, setUser, navigate }) {
  const [draftUrl, setDraftUrl] = useState("");
  const [draftName, setDraftName] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState("");
  const [err, setErr] = useState("");
  const [imgOpen, setImgOpen] = useState(null);
  const fileRef = useRef(null);

  const picUrl = getVerifyPicUrl(user);

  const submittedAt =
    user?.verificationSubmittedAt ||
    user?.verifySubmittedAt ||
    user?.submittedAt ||
    user?.createdAt ||
    user?.created_at ||
    null;

  const submittedText = useMemo(() => {
    if (!submittedAt) return "—";
    try {
      return dayjs(submittedAt).format("YYYY/MM/DD HH:mm");
    } catch {
      return "—";
    }
  }, [submittedAt]);

  function clearFileInput() {
    if (fileRef.current) {
      try {
        fileRef.current.value = "";
      } catch {}
    }
  }

  async function refreshMe() {
    setOk("");
    setErr("");
    setBusy(true);
    try {
      // backend should return updated verified / verificationStatus + verifyImageUrl fields
      const me = await apiGet("/me");
      const updated = me?.user || me;
      if (updated && setUser) setUser(updated);

      // If now verified, let them continue normally
      if (updated?.verified === true) {
        if (navigate) navigate("#/");
      } else {
        const s = String(updated?.verificationStatus || updated?.verifyStatus || "").toLowerCase();
        if (["verified", "approved", "approve"].includes(s)) {
          if (navigate) navigate("#/");
        } else {
          setOk("Refreshed.");
        }
      }
    } catch (e) {
      setErr(e?.message || "Failed to refresh status.");
    } finally {
      setBusy(false);
    }
  }

  async function onPick(e) {
    setOk("");
    setErr("");

    const f = e.target.files?.[0];
    if (!f) return;

    const okTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (!okTypes.includes(f.type)) {
      setErr("Only PNG/JPG/WEBP images are allowed.");
      clearFileInput();
      return;
    }

    if (f.size > MAX) {
      setErr("Image too large (max 2MB). Please screenshot/crop smaller.");
      clearFileInput();
      return;
    }

    const dataUrl = await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.onerror = () => resolve("");
      fr.readAsDataURL(f);
    });

    if (!String(dataUrl || "").startsWith("data:image/")) {
      setErr("Failed to read image. Try another file.");
      clearFileInput();
      return;
    }

    setDraftUrl(String(dataUrl));
    setDraftName(f.name);
  }

  async function upload() {
    setOk("");
    setErr("");

    if (!draftUrl) {
      setErr("Please choose an image first.");
      return;
    }

    setBusy(true);
    try {
      // Send multiple keys to survive backend field name mismatch
      const payload = {
        dataUrl: draftUrl,
        verificationDataUrl: draftUrl,
        verifyImageDataUrl: draftUrl,
        verifyImageUrl: draftUrl,

        // keep them unverified until admin approves
        verificationStatus: "pending",
        verified: false,
      };

      let res;
      try {
        // preferred endpoint (if you have it)
        res = await apiPost("/me/verification-photo", payload);
      } catch {
        // fallback if you don't
        res = await apiPatch("/me", payload);
      }

      const updated = res?.user || res;
      if (updated && setUser) setUser(updated);

      await refreshMe();

      setOk("Uploaded ✅ (sent for verification)");
      setDraftUrl("");
      setDraftName("");
      clearFileInput();
    } catch (e) {
      setErr(e?.message || "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setOk("");
    setErr("");

    if (!window.confirm("Remove your verification photo?")) return;

    setBusy(true);
    try {
      let res;
      try {
        res = await apiPost("/me/verification-photo/remove", {});
      } catch {
        res = await apiPatch("/me", {
          verificationDataUrl: null,
          verifyImageDataUrl: null,
          verifyImageUrl: null,
          verificationStatus: "pending",
          verified: false,
        });
      }

      const updated = res?.user || res;
      if (updated && setUser) setUser(updated);

      await refreshMe();

      setOk("Removed ✅");
      setDraftUrl("");
      setDraftName("");
      clearFileInput();
    } catch (e) {
      setErr(e?.message || "Remove failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ paddingTop: 16 }}>
      <div className="card">
        <div style={{ fontSize: 22, fontWeight: 900 }}>Account Verification</div>

        <div style={{ marginTop: 6, color: "#6b7280" }}>
          Your account is under verification. You can replace your verification photo below.
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              borderRadius: 999,
              background: "#fff7ed",
              border: "1px solid #fdba74",
              color: "#9a3412",
              fontWeight: 900,
            }}
          >
            ⏳ Pending verification
          </span>

          <span style={{ fontSize: 12, color: "#6b7280" }}>
            Submitted: {submittedText}
          </span>

          <button className="btn" onClick={refreshMe} disabled={busy}>
            {busy ? "Refreshing..." : "Refresh status"}
          </button>
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Uploaded Photo</div>

          {picUrl ? (
            <div style={{ display: "grid", gap: 10 }}>
              <img
                src={picUrl}
                alt="verification"
                style={{
                  width: "min(520px, 100%)",
                  maxHeight: 360,
                  objectFit: "contain",
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  background: "#fff",
                  cursor: "pointer",
                }}
                onClick={() => setImgOpen(picUrl)}
              />

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn" onClick={() => setImgOpen(picUrl)} disabled={busy}>
                  View
                </button>
                <button className="btn" onClick={remove} disabled={busy}>
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "#6b7280" }}>No photo found. Please upload one.</div>
          )}
        </div>

        <div style={{ marginTop: 18, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <div style={{ fontWeight: 900 }}>Upload / Replace</div>
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>Max 2MB · JPG/PNG/WebP</div>

          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            <input ref={fileRef} type="file" accept="image/*" onChange={onPick} />

            {draftName ? (
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                Selected: <strong>{draftName}</strong>
              </div>
            ) : null}

            {draftUrl ? (
              <img
                src={draftUrl}
                alt="preview"
                style={{
                  width: "min(520px, 100%)",
                  maxHeight: 360,
                  objectFit: "contain",
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  background: "#fff",
                }}
              />
            ) : null}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn"
                onClick={() => {
                  setDraftUrl("");
                  setDraftName("");
                  clearFileInput();
                }}
                disabled={busy}
              >
                Clear
              </button>
              <button className="btn primary" onClick={upload} disabled={busy || !draftUrl}>
                {busy ? "Uploading..." : "Upload"}
              </button>
            </div>

            {err ? (
              <div style={{ padding: 10, border: "1px solid var(--red)", borderRadius: 10, color: "var(--red)" }}>
                {err}
              </div>
            ) : null}

            {ok ? (
              <div style={{ padding: 10, border: "1px solid #22c55e", borderRadius: 10, color: "#166534", background: "#f0fdf4" }}>
                {ok}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* modal */}
      {imgOpen && (
        <div
          onClick={() => setImgOpen(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 9999,
          }}
        >
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 820, width: "100%", padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontWeight: 900 }}>Verification Photo</div>
              <button className="btn" onClick={() => setImgOpen(null)}>
                Close
              </button>
            </div>
            <div style={{ marginTop: 10 }}>
              <img
                src={imgOpen}
                alt="verification-large"
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
