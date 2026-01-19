// server/server.js
import express from "express";
import cors from "cors";
import fs from "fs-extra";
import path from "path";
import morgan from "morgan";
import jwt from "jsonwebtoken";
import dayjs from "dayjs";
import { v4 as uuidv4 } from "uuid";
import { fileURLToPath } from "url";
import { createWriteStream } from "fs";
import { format as csvFormat } from "fast-csv";
import crypto from "crypto";
import webpush from "web-push";
import { google } from "googleapis";
import { loadDB, saveDB } from "./storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "12mb" }));
app.use(morgan("dev"));
;

/* ---- uploads (images) ---- */
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");

const uploadsRoot = path.join(DATA_DIR, "uploads");

const avatarsDir = path.join(uploadsRoot, "avatars");
const verificationsDir = path.join(uploadsRoot, "verifications");
// ✅ NEW: parking receipts
const parkingReceiptsDir = path.join(uploadsRoot, "parking-receipts");

fs.ensureDirSync(avatarsDir);
fs.ensureDirSync(verificationsDir);
fs.ensureDirSync(parkingReceiptsDir);

app.use("/uploads", express.static(uploadsRoot));

/* ---------------- DB + defaults ---------------- */
let db = await loadDB();

/* =========================
   DB-backed blob store
   (Render free-safe)
========================= */
db.blobs = db.blobs || {};              // { [blobId]: { mime, b64, size, createdAt, meta } }
db.blobOrder = Array.isArray(db.blobOrder) ? db.blobOrder : []; // keep insertion order
const BLOB_CAP = Number(process.env.BLOB_CAP || 300); // keep latest 300 images only

db.config = db.config || {};
db.config.jwtSecret = db.config.jwtSecret || "dev-secret";
db.config.scanMaxDistanceMeters = db.config.scanMaxDistanceMeters || 500;

const DEFAULT_RATES = {
  virtualHourly: { junior: 20, senior: 20, lead: 30 },
  physicalSession: {
    halfDay: { junior: 80, senior: 100, lead: 44 },
    fullDay: { junior: 150, senior: 180, lead: 88 },
    twoD1N: { junior: 230, senior: 270, lead: null },
    threeD2n: { junior: 300, senior: 350, lead: null },
  },
  physicalHourly: { junior: 20, senior: 30, lead: 30 },
  loadingUnloading: { amount: 30 },
  // ✅ add thresholdHours default so ensureEarlyCall has a real default
  earlyCall: { defaultAmount: 20, thresholdHours: 3 },
};

db.config.rates = db.config.rates || DEFAULT_RATES;

// ✅ backfill missing earlyCall.thresholdHours if old DB doesn’t have it
db.config.rates.earlyCall = db.config.rates.earlyCall || {};
if (db.config.rates.earlyCall.defaultAmount == null)
  db.config.rates.earlyCall.defaultAmount = DEFAULT_RATES.earlyCall.defaultAmount;
if (db.config.rates.earlyCall.thresholdHours == null)
  db.config.rates.earlyCall.thresholdHours = DEFAULT_RATES.earlyCall.thresholdHours;

// ✅ Ensure roleRatesDefaults exists & has all staff grades, including emcees
db.config.roleRatesDefaults = db.config.roleRatesDefaults || {};
const rrd = db.config.roleRatesDefaults;

rrd.junior = rrd.junior || {
  payMode: "hourly",
  base: Number(db.config.rates?.physicalHourly?.junior ?? 20),
  specificPayment: null,
  otMultiplier: 0,
};
rrd.senior = rrd.senior || {
  payMode: "hourly",
  base: Number(db.config.rates?.physicalHourly?.senior ?? 30),
  specificPayment: null,
  otMultiplier: 0,
};
rrd.lead = rrd.lead || {
  payMode: "hourly",
  base: Number(db.config.rates?.physicalHourly?.lead ?? 30),
  specificPayment: null,
  otMultiplier: 0,
};
// ✅ NEW emcee grades
rrd.junior_emcee = rrd.junior_emcee || {
  payMode: "hourly",
  base: Number(db.config.rates?.physicalHourly?.junior ?? 20),
  specificPayment: null,
  otMultiplier: 0,
};
rrd.senior_emcee = rrd.senior_emcee || {
  payMode: "hourly",
  base: Number(db.config.rates?.physicalHourly?.senior ?? 30),
  specificPayment: null,
  otMultiplier: 0,
};

db.pushSubs = db.pushSubs || {};
db.notifications = db.notifications || {};

await saveDB(db);

/* ------------ globals / helpers ------------- */
const JWT_SECRET = db.config.jwtSecret;
const MAX_DISTANCE_METERS = Number(
  process.env.SCAN_MAX_DISTANCE_METERS || db.config.scanMaxDistanceMeters || 500
);
const ROLES = ["part-timer", "pm", "admin"];

// ✅ extended staff grades to include emcees
const STAFF_ROLES = ["junior", "senior", "lead", "junior_emcee", "senior_emcee"];

const toRad = (deg) => (deg * Math.PI) / 180;
const clampRole = (r) => (ROLES.includes(String(r)) ? String(r) : "part-timer");

// ✅ make grade handling more forgiving
const clampGrade = (g) => {
  const x = String(g || "")
    .toLowerCase()
    .replace(/\s+/g, "_");
  return STAFF_ROLES.includes(x) ? x : "junior";
};

function isValidCoord(lat, lng) {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const signToken = (payload) => jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

function signUserToken(user) {
  return signToken({
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    grade: user.grade || "junior",
  });
}

function authMiddleware(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "no_token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
}
const requireRole =
  (...roles) =>
  (req, res, next) =>
    roles.includes(req.user.role) ? next() : res.status(403).json({ error: "forbidden" });

function addAudit(action, details, req) {
  db.audit = db.audit || [];
  db.audit.unshift({
    id: "a" + Math.random().toString(36).slice(2, 8),
    time: dayjs().toISOString(),
    actor: req?.user?.email || "guest",
    role: req?.user?.role || "guest",
    action,
    details,
  });
  if (db.audit.length > 1000) db.audit.length = 1000;
}

function computeStatus(job) {
  const now = dayjs();
  const start = dayjs(job.startTime);
  const end = dayjs(job.endTime);
  if (job.events?.endedAt) return "ended";
  if (job.events?.startedAt) return "ongoing";
  if (now.isBefore(start)) return "upcoming";
  if (now.isAfter(end)) return "ended";
  return job.status || "upcoming";
}

// password helpers
function hashPassword(password) {
  const iterations = 150000;
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
  return `pbkdf2_sha256$${iterations}$${salt}$${derived}`;
}
function verifyPassword(password, encoded) {
  try {
    const [algo, iterStr, salt, hash] = String(encoded).split("$");
    if (algo !== "pbkdf2_sha256") return false;
    const iterations = parseInt(iterStr, 10);
    const derived = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
    return crypto.timingSafeEqual(Buffer.from(derived, "hex"), Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}
function findUserByIdentifier(id) {
  const x = String(id || "").toLowerCase();
  return (db.users || []).find(
    (u) =>
      String(u.email || "").toLowerCase() === x || String(u.username || "").toLowerCase() === x
  );
}

/* ---- pay helper ---- */
function paySummaryFromRate(rate = {}) {
  const pm = rate.payMode;
  const hr = Number(rate.base ?? rate.hourlyBase);
  const fix = Number(rate.specificPayment ?? rate.specificAmount);
  const otm = Number(rate.otMultiplier || 0);
  const otTag = otm > 0 ? ` (OT x${otm})` : "";

  if (pm === "specific" && Number.isFinite(fix)) return `RM ${Math.round(fix)} / shift`;
  if (pm === "specific_plus_hourly" && Number.isFinite(fix) && Number.isFinite(hr))
    return `RM ${Math.round(fix)} + RM ${Math.round(hr)}/hr${otTag}`;
  if ((pm === "hourly" || pm == null) && Number.isFinite(hr))
    return `RM ${Math.round(hr)}/hr${otTag}`;

  const legacyHr = rate?.physicalHourly?.junior ?? rate?.virtualHourly?.junior;
  if (Number.isFinite(legacyHr)) return `From RM ${Math.round(legacyHr)}/hr`;
  return "See details";
}

/* ===== time helpers ===== */
function hoursBetweenISO(startISO, endISO) {
  if (!startISO || !endISO) return 0;
  const s = dayjs(startISO);
  const e = dayjs(endISO);
  const ms = Math.max(0, e.diff(s, "millisecond"));
  return ms / 3600000;
}
function scheduledHours(job) {
  return Number(hoursBetweenISO(job?.startTime, job?.endTime).toFixed(2));
}

/* ===== Loading/Unloading normalizer (FIXES stale closed + enabled) ===== */
function ensureLoadingUnload(job) {
  const basePrice = Number(db.config?.rates?.loadingUnloading?.amount ?? 0);

  job.loadingUnload = job.loadingUnload || {
    enabled: false,
    quota: 0,
    price: basePrice,
    applicants: [],
    participants: [],
    closed: false,
  };

  const quota = Number(job.loadingUnload.quota || 0);
  const applicants = Array.isArray(job.loadingUnload.applicants)
    ? Array.from(new Set(job.loadingUnload.applicants))
    : [];
  const participants = Array.isArray(job.loadingUnload.participants)
    ? Array.from(new Set(job.loadingUnload.participants))
    : [];

  // ✅ important: treat quota>0 as enabled even if enabled was not set
  const enabled = Boolean(job.loadingUnload.enabled) || quota > 0;
  const price = Number(job.loadingUnload.price ?? basePrice);

  // ✅ critical fix: if quota <= 0 => unlimited => NEVER closed
  const closed = quota > 0 ? participants.length >= quota : false;

  job.loadingUnload.enabled = enabled;
  job.loadingUnload.quota = quota;
  job.loadingUnload.price = price;
  job.loadingUnload.applicants = applicants;
  job.loadingUnload.participants = participants;
  job.loadingUnload.closed = closed;

  // keep applicants tidy when closed (optional)
  if (job.loadingUnload.closed) {
    const keep = new Set(job.loadingUnload.participants);
    job.loadingUnload.applicants = job.loadingUnload.applicants.filter((uid) => keep.has(uid));
  }

  return job.loadingUnload;
}

/* ===== job public view ===== */
function jobPublicView(job) {
  const { id, title, venue, description, startTime, endTime, headcount, transportOptions, roleCounts } =
    job;

  const lu = ensureLoadingUnload(job);

  const appliedCount = Array.isArray(job.applications) ? job.applications.length : 0;
  const approvedCount = Array.isArray(job.approved) ? job.approved.length : 0;
  const fullTimers = Array.isArray(job.fullTimers) ? job.fullTimers : [];

  return {
    id,
    title,
    venue,
    description,
    startTime,
    endTime,
    headcount,
    status: computeStatus(job),
    transportOptions: transportOptions || { bus: true, own: true },
    loadingUnload: {
      enabled: !!lu.enabled,
      quota: Number(lu.quota || 0),
      applicants: lu.applicants?.length || 0,
      closed: !!lu.closed,
      participants: (lu.participants || []).length,
      price: Number(lu.price || db.config.rates.loadingUnloading.amount),
    },
    roleCounts: {
      junior: Number(roleCounts?.junior ?? 0),
      senior: Number(roleCounts?.senior ?? 0),
      lead: Number(roleCounts?.lead ?? 0),
      junior_emcee: Number(roleCounts?.junior_emcee ?? 0),
      senior_emcee: Number(roleCounts?.senior_emcee ?? 0),
    },
    appliedCount,
    approvedCount,
    fullTimersCount: fullTimers.length,
    paySummary: paySummaryFromRate(job.rate || {}),
  };
}

/* ===== full-timer helpers ===== */
function hydrateJobFullTimers(job) {
  if (!job || !Array.isArray(job.fullTimers)) return job;

  const enriched = job.fullTimers.map((ft) => {
    if (!ft || !ft.userId) return ft;
    const u = (db.users || []).find((x) => x.id === ft.userId) || {};
    const role = ft.role || ft.type || ft.grade || "junior";

    return {
      ...ft,
      role,
      name: u.name || ft.name || "",
      email: u.email || ft.email || "",
      phone: u.phone || ft.phone || "",
      grade: u.grade || ft.grade || "junior",
      accountRole: u.role || ft.accountRole || "",
    };
  });

  return { ...job, fullTimers: enriched };
}

/* ---- adjustments normalizer ---- */
function normalizeAdjustments(obj, actor) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [uid, arr] of Object.entries(obj)) {
    const key = String(uid);
    const list = Array.isArray(arr) ? arr : [];
    out[key] = list.map((x) => ({
      amount: Number(x?.amount) || 0,
      reason: String(x?.reason || ""),
      ts: x?.ts ? new Date(x.ts).toISOString() : new Date().toISOString(),
      by:
        x?.by && typeof x.by === "object"
          ? { id: x.by.id ?? actor?.id ?? null, email: x.by.email ?? actor?.email ?? null }
          : actor
          ? { id: actor.id ?? null, email: actor.email ?? null }
          : null,
    }));
  }
  return out;
}

/* ------------ CSV helpers ------------- */
function generateJobCSV(job) {
  const rows = [];

  const schedStart = job.startTime || "";
  const schedEnd = job.endTime || "";
  const schedHrs = scheduledHours(job);
  const evStart = job.events?.startedAt || "";
  const evEnd = job.events?.endedAt || "";

  ensureLoadingUnload(job);

  for (const u of job.applications) {
    const luApplied = !!(job.loadingUnload?.applicants || []).includes(u.userId);
    const luConfirmed = !!(job.loadingUnload?.participants || []).includes(u.userId);
    const present = !!job.attendance?.[u.userId]?.in || !!job.attendance?.[u.userId]?.out;

    rows.push({
      section: "applications",
      userId: u.userId,
      email: u.email,
      transport: u.transport,
      status: job.approved.includes(u.userId)
        ? "approved"
        : job.rejected.includes(u.userId)
        ? "rejected"
        : "applied",
      in: "",
      out: "",
      lateMinutes: "",
      present,
      scheduledStart: schedStart,
      scheduledEnd: schedEnd,
      scheduledHours: schedHrs,
      eventStartedAt: evStart,
      eventEndedAt: evEnd,
      luApplied,
      luConfirmed,
    });
  }

  for (const [userId, rec] of Object.entries(job.attendance || {})) {
    const app = job.applications.find((a) => a.userId === userId);
    const luApplied = !!(job.loadingUnload?.applicants || []).includes(userId);
    const luConfirmed = !!(job.loadingUnload?.participants || []).includes(userId);
    const present = !!rec.in || !!rec.out;

    rows.push({
      section: "attendance",
      userId,
      email: app?.email || "",
      transport: app?.transport || "",
      status: job.approved.includes(userId)
        ? "approved"
        : job.rejected.includes(userId)
        ? "rejected"
        : "applied",
      in: rec.in || "",
      out: rec.out || "",
      lateMinutes: rec.lateMinutes ?? "",
      present,
      scheduledStart: schedStart,
      scheduledEnd: schedEnd,
      scheduledHours: schedHrs,
      eventStartedAt: evStart,
      eventEndedAt: evEnd,
      luApplied,
      luConfirmed,
    });
  }

  const headers = [
    "section",
    "userId",
    "email",
    "transport",
    "status",
    "in",
    "out",
    "lateMinutes",
    "present",
    "scheduledStart",
    "scheduledEnd",
    "scheduledHours",
    "eventStartedAt",
    "eventEndedAt",
    "luApplied",
    "luConfirmed",
  ];
  return { headers, rows };
}

function exportJobCSV(job) {
  const dir = path.join(__dirname, "data");
  fs.ensureDirSync(dir);
  const file = path.join(dir, `job-${job.id}.csv`);
  const ws = createWriteStream(file);
  const csv = csvFormat({ headers: true });
  csv.pipe(ws);
  const { rows } = generateJobCSV(job);
  for (const r of rows) csv.write(r);
  csv.end();
}

/* ---------- boot migrations ---------- */
db.users = db.users || [];
let mutated = false;
for (const u of db.users) {
  if (!u.username) {
    u.username =
      (u.email && u.email.split("@")[0]) || `user_${u.id || Math.random().toString(36).slice(2, 8)}`;
    mutated = true;
  }
  if (!u.passwordHash) {
    u.passwordHash = hashPassword("password");
    mutated = true;
  }

  const normGrade = clampGrade(u.grade || "junior");
  if (u.grade !== normGrade) {
    u.grade = normGrade;
    mutated = true;
  }

  if (u.resetToken && (!u.resetToken.token || !u.resetToken.expiresAt)) {
    delete u.resetToken;
    mutated = true;
  }
  if (u.phone === undefined) {
    u.phone = "";
    mutated = true;
  }
  if (u.discord === undefined) {
    u.discord = "";
    mutated = true;
  }
  if (u.avatarUrl === undefined) {
    u.avatarUrl = "";
    mutated = true;
  }
  if (u.verified === undefined) {
    u.verified = true;
    mutated = true;
  }
  if (u.verificationStatus === undefined) {
    u.verificationStatus = u.verified ? "APPROVED" : "PENDING";
    mutated = true;
  }
  if (u.verificationPhotoUrl === undefined) {
    u.verificationPhotoUrl = "";
    mutated = true;
  }
  if (u.verifiedAt === undefined) {
    u.verifiedAt = null;
    mutated = true;
  }
  if (u.verifiedBy === undefined) {
    u.verifiedBy = null;
    mutated = true;
  }
}
if (mutated) await saveDB(db);

db.jobs = db.jobs || [];
let bootMutated = false;
for (const j of db.jobs) {
  if (!j.adjustments || typeof j.adjustments !== "object") {
    j.adjustments = {};
    bootMutated = true;
  } else {
    const norm = normalizeAdjustments(j.adjustments);
    if (JSON.stringify(j.adjustments) !== JSON.stringify(norm)) {
      j.adjustments = norm;
      bootMutated = true;
    }
  }

  // ✅ normalize L&U hard to prevent stale closed/disabled
  if (!j.loadingUnload || typeof j.loadingUnload !== "object") {
    j.loadingUnload = {
      enabled: false,
      quota: 0,
      price: Number(db.config.rates.loadingUnloading.amount),
      applicants: [],
      participants: [],
      closed: false,
    };
    bootMutated = true;
  }
  const beforeLU = JSON.stringify(j.loadingUnload);
  ensureLoadingUnload(j);
  if (JSON.stringify(j.loadingUnload) !== beforeLU) bootMutated = true;

  if (!Array.isArray(j.fullTimers)) {
    j.fullTimers = [];
    bootMutated = true;
  }

  // ✅ NEW: ensure parkingReceipts container exists (optional)
  if (j.parkingReceipts && !Array.isArray(j.parkingReceipts)) {
    j.parkingReceipts = [];
    bootMutated = true;
  }
}
if (bootMutated) await saveDB(db);

/* ---------------- Notifications (feed + web push) ---------------- */
const NOTIF_CAP = 200;

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:admin@example.com",
  process.env.VAPID_PUBLIC_KEY || "",
  process.env.VAPID_PRIVATE_KEY || ""
);

async function sendPushToSub(sub, payload) {
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload));
    return true;
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) return false;
    return true;
  }
}
async function sendPushToUser(userId, payload) {
  const list = db.pushSubs[userId] || [];
  if (!list.length) return;
  const keep = [];
  for (const sub of list) {
    const ok = await sendPushToSub(sub, payload);
    if (ok) keep.push(sub);
  }
  db.pushSubs[userId] = keep;
  await saveDB(db);
}
function addNotificationFor(userId, item) {
  db.notifications[userId] = db.notifications[userId] || [];
  db.notifications[userId].unshift(item);
  if (db.notifications[userId].length > NOTIF_CAP) {
    db.notifications[userId].length = NOTIF_CAP;
  }
}
async function notifyUsers(userIds, { title, body, link, type = "info" }) {
  const now = new Date().toISOString();
  const id = "n" + Math.random().toString(36).slice(2, 10);
  const item = { id, time: now, title, body, link, read: false, type };
  for (const uid of userIds) {
    addNotificationFor(uid, item);
    sendPushToUser(uid, { title, body, url: link }).catch(() => {});
  }
  await saveDB(db);
}

/* ------------ EMAIL HELPER (Gmail API + Resend fallback) ------------- */
async function sendResetEmail(to, link) {
  const {
    GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET,
    GMAIL_REFRESH_TOKEN,
    GMAIL_SENDER,
    RESEND_API_KEY,
  } = process.env;

  // 1) Gmail API
  if (GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET && GMAIL_REFRESH_TOKEN && GMAIL_SENDER) {
    try {
      const oAuth2Client = new google.auth.OAuth2(
        GMAIL_CLIENT_ID,
        GMAIL_CLIENT_SECRET,
        "urn:ietf:wg:oauth:2.0:oob"
      );
      oAuth2Client.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });

      const gmail = google.gmail({ version: "v1", auth: oAuth2Client });

      const subject = "Reset your ATAG Jobs password";
      const messageText = `Click this link to reset your password:\n${link}\n`;

      const rawLines = [
        `From: ${GMAIL_SENDER}`,
        `To: ${to}`,
        `Subject: ${subject}`,
        'Content-Type: text/plain; charset="UTF-8"',
        "",
        messageText,
      ];
      const raw = Buffer.from(rawLines.join("\r\n"))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

      await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw },
      });
      console.log("[sendResetEmail] sent via Gmail API to", to);
      return;
    } catch (err) {
      console.error("[sendResetEmail] Gmail API error:", err?.response?.data || err);
    }
  }

  // 2) Resend
  if (RESEND_API_KEY) {
    try {
      const from =
        process.env.FROM_EMAIL || process.env.MAIL_FROM || "ATAG Jobs <onboarding@resend.dev>";
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject: "Reset your ATAG Jobs password",
          html: `<p>Click this link to reset your password:</p><p><a href="${link}">${link}</a></p>`,
        }),
      });
      if (!resp.ok) {
        console.error("[sendResetEmail] Resend error:", await resp.text());
      }
      return;
    } catch (err) {
      console.error("[sendResetEmail] Resend throw:", err);
      return;
    }
  }

  console.log("[sendResetEmail] no email provider configured, link:", link);
}

/**
 * ✅ Generic image saver for DataURL -> file in absDir -> returns public url.
 * - publicPrefix example: "/uploads/verifications" or "/uploads/parking-receipts"
 */
function parseImageDataUrl(dataUrl) {
  const s = String(dataUrl || "");
  const m = s.match(/^data:(image\/(png|jpeg|jpg|webp));base64,(.+)$/i);
  if (!m) throw new Error("invalid_image_data");

  const mime = m[1].toLowerCase();
  const extRaw = m[2].toLowerCase();
  const ext = extRaw === "jpeg" ? "jpg" : extRaw;

  const b64 = m[3];
  const buf = Buffer.from(b64, "base64");

  const MAX = 2 * 1024 * 1024; // 2MB binary
  if (buf.length > MAX) throw new Error("image_too_large");

  return { mime, ext, b64, size: buf.length };
}

function pruneBlobsIfNeeded() {
  // keep only latest BLOB_CAP
  while (db.blobOrder.length > BLOB_CAP) {
    const oldest = db.blobOrder.shift();
    if (oldest && db.blobs[oldest]) delete db.blobs[oldest];
  }
}

/** Save image into DB and return public path: /blob/<id>?v=... */
async function saveDataUrlBlob(dataUrl, meta = {}) {
  const { mime, b64, size } = parseImageDataUrl(dataUrl);

  const id = "b" + Math.random().toString(36).slice(2, 12);
  db.blobs[id] = {
    mime,
    b64,
    size,
    createdAt: new Date().toISOString(),
    meta: {
      kind: meta.kind || "",
      ownerUserId: meta.ownerUserId || null,
      jobId: meta.jobId || null,
    },
  };

  db.blobOrder.push(id);
  pruneBlobsIfNeeded();
  await saveDB(db);

  return `/blob/${id}?v=${Date.now()}`;
}

function blobIdFromAnyUrl(u) {
  if (!u) return null;
  const s = String(u);

  // allow absolute
  const noHost = s.replace(/^https?:\/\/[^/]+/i, "");
  const clean = noHost.split("?")[0];

  const m = clean.match(/^\/blob\/([a-z0-9]+)/i);
  return m ? m[1] : null;
}

async function deleteBlobByUrl(u) {
  const id = blobIdFromAnyUrl(u);
  if (!id) return false;
  if (!db.blobs || !db.blobs[id]) return false;

  delete db.blobs[id];
  db.blobOrder = (db.blobOrder || []).filter((x) => x !== id);
  await saveDB(db);
  return true;
}

/** Backward-compatible delete for old /uploads files (best-effort) */
async function deleteStoredImage(u) {
  if (!u) return;

  // new DB blob
  const blobId = blobIdFromAnyUrl(u);
  if (blobId) {
    await deleteBlobByUrl(u);
    return;
  }

  // old local uploads (may not exist on Render free)
  try {
    const s = String(u).replace(/^https?:\/\/[^/]+/i, "");
    const clean = s.split("?")[0];
    if (clean.startsWith("/uploads/")) {
      const rel = clean.replace("/uploads/", "");
      const abs = path.join(uploadsRoot, rel);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    }
  } catch {}
}

/* -------------- auth --------------- */

app.post("/login", async (req, res) => {
  const { identifier, email, username, password } = req.body || {};
  const id = identifier || email || username;
  if (!id || !password) return res.status(400).json({ error: "missing_credentials" });

  const user = findUserByIdentifier(id);
  if (!user) return res.status(401).json({ error: "unknown_user" });

  if (!verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "invalid_password" });
  }

  if (!user.verified) {
    return res.status(403).json({
      error: "pending_verification",
      code: "PENDING_VERIFICATION",
    });
  }

  const token = signUserToken(user);
  addAudit("login", { identifier: id }, { user });
  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      grade: user.grade || "junior",
      username: user.username || "",
      phone: user.phone || "",
      discord: user.discord || "",
      avatarUrl: user.avatarUrl || "",

      // ✅ add these
      verified: !!user.verified,
      verificationStatus: user.verificationStatus || (user.verified ? "APPROVED" : "PENDING"),
      verificationPhotoUrl: user.verificationPhotoUrl || "",
      verificationPhotoUrlAbs: toPublicUrl(req, user.verificationPhotoUrl || ""),
      verifiedAt: user.verifiedAt || null,
      verifiedBy: user.verifiedBy || null,
    },
  });
});

app.post("/register", async (req, res) => {
  const { email, username, name, password, role, phone, discord, verificationDataUrl } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "email_and_password_required" });
  }

  if (!verificationDataUrl || typeof verificationDataUrl !== "string") {
    return res.status(400).json({ error: "verification_photo_required" });
  }

  const pickedRole = clampRole(role || "part-timer");

  const emailLower = String(email).toLowerCase();
  if (db.users.find((u) => String(u.email || "").toLowerCase() === emailLower)) {
    return res.status(409).json({ error: "email_taken" });
  }

  if (username) {
    const userLower = String(username).toLowerCase();
    if (db.users.find((u) => String(u.username || "").toLowerCase() === userLower)) {
      return res.status(409).json({ error: "username_taken" });
    }
  }

  const id = "u" + Math.random().toString(36).slice(2, 10);
  const finalUsername = username || String(email).split("@")[0];
  const passwordHash = hashPassword(password);

  let verificationPhotoUrl = "";
  try {
    verificationPhotoUrl = await saveDataUrlBlob(verificationDataUrl, {
      kind: "verification",
      ownerUserId: id,
    });
  } catch (e) {
    return res.status(400).json({ error: e?.message || "invalid_verification_photo" });
  }

  const newUser = {
    id,
    email,
    username: finalUsername,
    name: name || finalUsername,
    role: pickedRole,
    grade: "junior",
    passwordHash,
    phone: String(phone || ""),
    discord: String(discord || ""),
    avatarUrl: "",
    verified: false,
    verificationStatus: "PENDING",
    verificationPhotoUrl,
    verifiedAt: null,
    verifiedBy: null,
  };

  db.users.push(newUser);
  await saveDB(db);
  addAudit("register_pending_verification", { email, role: pickedRole }, { user: newUser });

  res.json({
    ok: true,
    pending: true,
    user: {
      id,
      email,
      role: newUser.role,
      name: newUser.name,
      grade: newUser.grade,
      username: newUser.username,
      phone: newUser.phone,
      discord: newUser.discord,
      avatarUrl: newUser.avatarUrl,
      verified: newUser.verified,
      verificationStatus: newUser.verificationStatus,
      verificationPhotoUrl: newUser.verificationPhotoUrl,
    },
  });
});

/* ---- forgot + reset password ---- */
app.post("/forgot-password", async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "email_required" });

  const emailLower = String(email).toLowerCase();
  const user = db.users.find((u) => String(u.email || "").toLowerCase() === emailLower);

  if (!user) return res.json({ ok: true });

  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + 60 * 60 * 1000;
  user.resetToken = { token, expiresAt };
  await saveDB(db);

  const base = (
    process.env.PUBLIC_APP_URL ||
    process.env.FRONTEND_URL ||
    process.env.APP_ORIGIN ||
    req.headers?.origin ||
    ""
  ).replace(/\/$/, "");
  const resetLink = `${base}/#/reset?token=${token}`;

  addAudit("forgot_password", { email }, { user });

  try {
    await sendResetEmail(user.email, resetLink);
  } catch (err) {
    console.error("sendResetEmail error (outer):", err);
  }

  res.json({ ok: true, token, resetLink });
});

app.post("/reset-password", async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password) return res.status(400).json({ error: "missing_token_or_password" });

  const user = db.users.find((u) => u.resetToken && u.resetToken.token === token);
  if (!user) return res.status(400).json({ error: "invalid_token" });

  if (Date.now() > Number(user.resetToken.expiresAt)) {
    delete user.resetToken;
    await saveDB(db);
    return res.status(400).json({ error: "token_expired" });
  }

  user.passwordHash = hashPassword(password);
  delete user.resetToken;
  await saveDB(db);
  addAudit("reset_password", { userId: user.id }, { user });
  res.json({ ok: true });
});

/* ---- legacy paths for old frontend ---- */
app.post("/auth/forgot", (req, res, next) => {
  req.url = "/forgot-password";
  app._router.handle(req, res, next);
});
app.post("/auth/reset", (req, res, next) => {
  req.url = "/reset-password";
  app._router.handle(req, res, next);
});

/* ---- ME ---- */
app.get("/me", authMiddleware, (req, res) => {
  const user = db.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "user_not_found" });

  res.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      grade: user.grade || "junior",
      username: user.username || "",
      phone: user.phone || "",
      discord: user.discord || "",
      avatarUrl: user.avatarUrl || "",

      // ✅ add these
      verified: !!user.verified,
      verificationStatus: user.verificationStatus || (user.verified ? "APPROVED" : "PENDING"),
      verificationPhotoUrl: user.verificationPhotoUrl || "",
      verificationPhotoUrlAbs: toPublicUrl(req, user.verificationPhotoUrl || ""),
      verifiedAt: user.verifiedAt || null,
      verifiedBy: user.verifiedBy || null,
    },
  });
});

async function handleUpdateMe(req, res) {
  const user = (db.users || []).find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "user_not_found" });

  const { email, username, name, phone, discord } = req.body || {};

  if (email && String(email).toLowerCase() !== String(user.email).toLowerCase()) {
    const taken = (db.users || []).some(
      (u) => u.id !== user.id && String(u.email || "").toLowerCase() === String(email).toLowerCase()
    );
    if (taken) return res.status(409).json({ error: "email_taken" });
    user.email = String(email);
  }
  if (username && String(username).toLowerCase() !== String(user.username || "").toLowerCase()) {
    const takenU = (db.users || []).some(
      (u) => u.id !== user.id && String(u.username || "").toLowerCase() === String(username).toLowerCase()
    );
    if (takenU) return res.status(409).json({ error: "username_taken" });
    user.username = String(username);
  }
  if (name !== undefined) user.name = String(name);
  if (phone !== undefined) user.phone = String(phone || "");
  if (discord !== undefined) user.discord = String(discord || "");

  await saveDB(db);
  addAudit("me_update_profile", { userId: user.id }, req);

  const token = signUserToken(user);

  return res.json({
    ok: true,
    token,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      role: user.role,
      grade: user.grade || "junior",
      phone: user.phone || "",
      discord: user.discord || "",
      avatarUrl: user.avatarUrl || "",

      // ✅ add these
      verified: !!user.verified,
      verificationStatus: user.verificationStatus || (user.verified ? "APPROVED" : "PENDING"),
      verificationPhotoUrl: user.verificationPhotoUrl || "",
      verificationPhotoUrlAbs: toPublicUrl(req, user.verificationPhotoUrl || ""),
      verifiedAt: user.verifiedAt || null,
      verifiedBy: user.verifiedBy || null,
    },
  });
}
app.patch("/me", authMiddleware, handleUpdateMe);
app.post("/me/update", authMiddleware, handleUpdateMe);
app.post("/me/profile", authMiddleware, handleUpdateMe);
app.patch("/me/profile", authMiddleware, handleUpdateMe);

app.post("/me/password", authMiddleware, async (req, res) => {
  const user = (db.users || []).find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "user_not_found" });
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: "missing_fields" });
  if (!verifyPassword(currentPassword, user.passwordHash))
    return res.status(401).json({ error: "invalid_current_password" });
  if (String(newPassword).length < 6) return res.status(400).json({ error: "weak_password" });
  user.passwordHash = hashPassword(String(newPassword));
  await saveDB(db);
  addAudit("me_change_password", { userId: user.id }, req);
  return res.json({ ok: true });
});

app.post("/me/avatar", authMiddleware, async (req, res) => {
  const user = (db.users || []).find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "user_not_found" });

  const dataUrl = req.body?.dataUrl;
  if (!dataUrl || typeof dataUrl !== "string") return res.status(400).json({ error: "dataUrl_required" });

  // delete old avatar (if any)
  const old = user.avatarUrl || "";

  let avatarUrl = "";
  try {
    avatarUrl = await saveDataUrlBlob(dataUrl, {
      kind: "avatar",
      ownerUserId: user.id,
    });
  } catch (e) {
    return res.status(400).json({ error: e?.message || "invalid_avatar" });
  }

  user.avatarUrl = avatarUrl;
  await saveDB(db);

  // best-effort remove old
  await deleteStoredImage(old);

  addAudit("me_update_avatar", { userId: user.id }, req);
  return res.json({ ok: true, avatarUrl: user.avatarUrl });
});

/* -------- Admin: users -------- */
app.get("/admin/users", authMiddleware, requireRole("admin"), (req, res) => {
  const list = (db.users || []).map((u) => ({
    id: u.id,
    email: u.email,
    username: u.username,
    name: u.name,
    role: u.role,
    grade: u.grade || "junior",
    phone: u.phone || "",
    discord: u.discord || "",

    avatarUrl: u.avatarUrl || "",
    avatarUrlAbs: toPublicUrl(req, u.avatarUrl || ""),

    verified: !!u.verified,
    verificationStatus: u.verificationStatus || (u.verified ? "APPROVED" : "PENDING"),

    verificationPhotoUrl: u.verificationPhotoUrl || "",
    verificationPhotoUrlAbs: toPublicUrl(req, u.verificationPhotoUrl || ""),

    verifiedAt: u.verifiedAt || null,
    verifiedBy: u.verifiedBy || null,
  }));

  res.json(list);
});

app.patch("/admin/users/:id", authMiddleware, requireRole("admin"), async (req, res) => {
  const target = db.users.find((u) => u.id === req.params.id);
  if (!target) return res.status(404).json({ error: "user_not_found" });

  const { role, grade, verified, verificationStatus } = req.body || {};
  const before = { role: target.role, grade: target.grade || "junior" };

  if (role && clampRole(role) !== "admin" && target.role === "admin") {
    const adminCount = (db.users || []).filter((u) => u.role === "admin").length;
    if (adminCount <= 1) return res.status(400).json({ error: "last_admin" });
  }

  if (role !== undefined) target.role = clampRole(role);
  if (grade !== undefined) target.grade = clampGrade(grade);

  if (verified !== undefined) {
    target.verified = !!verified;
    target.verificationStatus = target.verified ? "APPROVED" : target.verificationStatus || "PENDING";
    target.verifiedAt = target.verified ? dayjs().toISOString() : null;
    target.verifiedBy = target.verified ? req.user.id : null;
  }

  if (verificationStatus !== undefined) {
    const s = String(verificationStatus || "").toUpperCase();
    if (!["PENDING", "APPROVED", "REJECTED"].includes(s)) {
      return res.status(400).json({ error: "bad_verificationStatus" });
    }
    target.verificationStatus = s;
    if (s === "APPROVED") {
      target.verified = true;
      target.verifiedAt = dayjs().toISOString();
      target.verifiedBy = req.user.id;
    }
    if (s === "REJECTED" || s === "PENDING") {
      target.verified = false;
      target.verifiedAt = null;
      target.verifiedBy = null;
    }
  }

  // ✅ AUTO-DELETE verification photo after APPROVED / REJECTED
  try {
    const decided =
      target.verificationStatus === "APPROVED" || target.verificationStatus === "REJECTED";

    if (decided && target.verificationPhotoUrl) {
      const old = target.verificationPhotoUrl;
      target.verificationPhotoUrl = "";
      await saveDB(db);              // save first so UI immediately stops showing it
      await deleteStoredImage(old);  // best-effort delete (blob/local)
    } else {
      await saveDB(db);
    }
  } catch {
    // if delete fails, still keep the DB updated
    await saveDB(db);
  }

  addAudit(
    "admin_update_user_role_grade",
    { userId: target.id, before, after: { role: target.role, grade: target.grade } },
    req
  );

  try {
    await notifyUsers([target.id], {
      title: "Your account was updated",
      body: `Role: ${target.role} • Grade: ${target.grade || "junior"} • Verified: ${
        target.verified ? "YES" : "NO"
      }`,
      link: "/#/",
      type: "account_update",
    });
  } catch {}

  res.json({
    ok: true,
    user: {
      id: target.id,
      email: target.email,
      username: target.username,
      name: target.name,
      role: target.role,
      grade: target.grade || "junior",
      phone: target.phone || "",
      discord: target.discord || "",
      avatarUrl: target.avatarUrl || "",
      verified: !!target.verified,
      verificationStatus: target.verificationStatus || (target.verified ? "APPROVED" : "PENDING"),
      verificationPhotoUrl: target.verificationPhotoUrl || "",
      verifiedAt: target.verifiedAt || null,
      verifiedBy: target.verifiedBy || null,
    },
  });
});


app.delete("/admin/users/:id", authMiddleware, requireRole("admin"), async (req, res) => {
  const uid = req.params.id;
  const user = (db.users || []).find((u) => u.id === uid);
  await deleteStoredImage(user.avatarUrl || "");
  await deleteStoredImage(user.verificationPhotoUrl || "");

  if (!user) return res.status(404).json({ error: "user_not_found" });

  if (user.role === "admin") {
    const adminCount = (db.users || []).filter((u) => u.role === "admin").length;
    if (adminCount <= 1) return res.status(400).json({ error: "last_admin" });
  }

  db.users = (db.users || []).filter((u) => u.id !== uid);

  for (const j of db.jobs || []) {
    j.applications = (j.applications || []).filter((a) => a.userId !== uid);
    j.approved = (j.approved || []).filter((x) => x !== uid);
    j.rejected = (j.rejected || []).filter((x) => x !== uid);
    if (j.attendance && j.attendance[uid]) delete j.attendance[uid];

    if (j.loadingUnload) {
      ensureLoadingUnload(j);
      j.loadingUnload.applicants = (j.loadingUnload.applicants || []).filter((x) => x !== uid);
      j.loadingUnload.participants = (j.loadingUnload.participants || []).filter((x) => x !== uid);
      ensureLoadingUnload(j);
    }

    if (Array.isArray(j.fullTimers)) {
      j.fullTimers = j.fullTimers.filter((ft) => ft && ft.userId !== uid);
    }

    // ✅ remove any parking receipts by this user
    if (Array.isArray(j.parkingReceipts)) {
      for (const r of j.parkingReceipts) {
        if (r?.userId === uid) await deleteStoredImage(r.photoUrl);
      }
      j.parkingReceipts = j.parkingReceipts.filter((r) => r?.userId !== uid);
    }
  }

  delete db.notifications?.[uid];
  delete db.pushSubs?.[uid];

  await saveDB(db);
  addAudit("admin_delete_user", { userId: uid, email: user.email }, req);
  res.json({ ok: true, removed: { id: user.id, email: user.email } });
});

app.post(
  "/admin/users/:id/verification-photo/remove",
  authMiddleware,
  requireRole("admin"),
  async (req, res) => {
    const target = db.users.find((u) => u.id === req.params.id);
    if (!target) return res.status(404).json({ error: "user_not_found" });

    const old = target.verificationPhotoUrl || "";
    target.verificationPhotoUrl = "";
    await saveDB(db);

    await deleteStoredImage(old);
    addAudit("admin_remove_verification_photo", { userId: target.id }, req);

    return res.json({ ok: true });
  }
);

/* -------- Config (Admin) -------- */
app.get("/config/rates", authMiddleware, requireRole("admin"), (_req, res) => {
  res.json({
    ...db.config.rates,
    roleRatesDefaults: db.config.roleRatesDefaults,
  });
});
app.post("/config/rates", authMiddleware, requireRole("admin"), async (req, res) => {
  const body = req.body || {};
  db.config.rates = Object.keys(body).length ? { ...db.config.rates, ...body } : db.config.rates;
  if (body.roleRatesDefaults && typeof body.roleRatesDefaults === "object") {
    db.config.roleRatesDefaults = { ...db.config.roleRatesDefaults, ...body.roleRatesDefaults };
  }
  // ensure earlyCall thresholdHours exists after updates
  db.config.rates.earlyCall = db.config.rates.earlyCall || {};
  if (db.config.rates.earlyCall.thresholdHours == null)
    db.config.rates.earlyCall.thresholdHours = DEFAULT_RATES.earlyCall.thresholdHours;

  await saveDB(db);
  addAudit("update_rates_default", { rates: db.config.rates, roleRatesDefaults: db.config.roleRatesDefaults }, req);
  res.json({ ok: true, rates: db.config.rates, roleRatesDefaults: db.config.roleRatesDefaults });
});

/* -------------- jobs --------------- */
app.get("/jobs", (_req, res) => {
  const jobs = db.jobs
    .map((j) => jobPublicView(j))
    .sort((a, b) => dayjs(a.startTime) - dayjs(b.startTime));
  res.json(_req.query.limit ? jobs.slice(0, Number(_req.query.limit)) : jobs);
});

app.get("/jobs/:id", (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });
  ensureLoadingUnload(job);
  const hydrated = hydrateJobFullTimers(job);
  res.json({ ...hydrated, status: computeStatus(hydrated) });
});

app.post("/jobs", authMiddleware, requireRole("pm", "admin"), async (req, res) => {
  const {
    title,
    venue,
    description,
    startTime,
    endTime,
    headcount,
    transportOptions,
    rate,
    earlyCall,
    loadingUnload,
    ldu,
    roleCounts,
    roleRates,
  } = req.body || {};
  if (!title || !venue || !startTime || !endTime) return res.status(400).json({ error: "missing_fields" });

  const id = "j" + Math.random().toString(36).slice(2, 8);
  const lduBody = ldu || loadingUnload || {};

  const counts = {
    junior: Number(roleCounts?.junior ?? 0),
    senior: Number(roleCounts?.senior ?? 0),
    lead: Number(roleCounts?.lead ?? 0),
    junior_emcee: Number(roleCounts?.junior_emcee ?? 0),
    senior_emcee: Number(roleCounts?.senior_emcee ?? 0),
  };
  const countsSum =
    counts.junior + counts.senior + counts.lead + counts.junior_emcee + counts.senior_emcee;

  const rrDef = db.config.roleRatesDefaults || {};
  const roleRatesMerged = {};
  for (const r of STAFF_ROLES) {
    roleRatesMerged[r] = {
      payMode: roleRates?.[r]?.payMode ?? rrDef?.[r]?.payMode ?? "hourly",
      base: Number(roleRates?.[r]?.base ?? rrDef?.[r]?.base ?? 0),
      specificPayment: roleRates?.[r]?.specificPayment ?? rrDef?.[r]?.specificPayment ?? null,
      otMultiplier: Number(roleRates?.[r]?.otMultiplier ?? rrDef?.[r]?.otMultiplier ?? 0),
    };
  }

  const job = {
    id,
    title,
    venue,
    description: description || "",
    startTime,
    endTime,
    status: "upcoming",
    headcount: Number(headcount || countsSum || 5),
    transportOptions: transportOptions || { bus: true, own: true },
    rate: rate ? { ...db.config.rates, ...rate } : JSON.parse(JSON.stringify(db.config.rates)),
    roleCounts: counts,
    roleRates: roleRatesMerged,
    earlyCall: {
      enabled: !!earlyCall?.enabled,
      amount: Number(earlyCall?.amount ?? db.config.rates.earlyCall?.defaultAmount ?? 20),
      thresholdHours: Number(earlyCall?.thresholdHours ?? db.config.rates.earlyCall?.thresholdHours ?? 3),
      participants: Array.isArray(earlyCall?.participants) ? earlyCall.participants : [],
    },
    loadingUnload: {
      enabled: Boolean(lduBody.enabled) || Number(lduBody.quota || 0) > 0,
      quota: Number(lduBody.quota ?? 0),
      price: Number(lduBody.price ?? db.config.rates.loadingUnloading.amount),
      applicants: [],
      participants: [],
      closed: false,
    },
    applications: [],
    approved: [],
    rejected: [],
    attendance: {},
    events: { startedAt: null, endedAt: null, scanner: null },
    adjustments: {},
    fullTimers: [],
    // ✅ NEW: parking receipts container
    parkingReceipts: [],
  };

  ensureLoadingUnload(job);

  db.jobs.push(job);
  await saveDB(db);
  addAudit("create_job", { jobId: id, title }, req);

  // ✅✅✅ FIXED: New job notify only to part-timers + admins (NOT PM) ✅✅✅
  try {
    const recipients = (db.users || [])
      .filter((u) => u && (u.role === "part-timer" || u.role === "admin"))
      .map((u) => u.id);

    if (recipients.length) {
      notifyUsers(recipients, {
        title: `New job: ${title}`,
        body: `${venue} — ${dayjs(startTime).format("DD MMM HH:mm")}`,
        link: `/#/jobs/${id}`,
        type: "job_new",
      }).catch(() => {});
    }
  } catch {}

  res.json(job);
});

app.patch("/jobs/:id", authMiddleware, requireRole("pm", "admin"), async (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });

  const {
    title,
    venue,
    description,
    startTime,
    endTime,
    headcount,
    rate,
    transportOptions,
    earlyCall,
    loadingUnload,
    ldu,
    roleCounts,
    roleRates,
  } = req.body || {};

  if (title !== undefined) job.title = title;
  if (venue !== undefined) job.venue = venue;
  if (description !== undefined) job.description = description;
  if (startTime !== undefined) job.startTime = startTime;
  if (endTime !== undefined) job.endTime = endTime;
  if (headcount !== undefined) job.headcount = Number(headcount);
  if (transportOptions)
    job.transportOptions = { bus: !!transportOptions.bus, own: !!transportOptions.own };

  if (rate && typeof rate === "object") {
    job.rate = { ...job.rate, ...rate };
  }

  // ✅ FIX: do NOT wipe participants when editing earlyCall config
  if (earlyCall) {
    const ec = ensureEarlyCall(job);
    ec.enabled = !!earlyCall.enabled;
    ec.amount = Number(
      earlyCall.amount ?? ec.amount ?? db.config.rates.earlyCall?.defaultAmount ?? 20
    );
    ec.thresholdHours = Number(
      earlyCall.thresholdHours ?? ec.thresholdHours ?? db.config.rates.earlyCall?.thresholdHours ?? 3
    );
    if (Array.isArray(earlyCall.participants)) {
      ec.participants = Array.from(new Set(earlyCall.participants.filter(Boolean)));
    }
    job.earlyCall = ec;
  }

  const lduBody = ldu || loadingUnload;
  if (lduBody) {
    ensureLoadingUnload(job);
    if (lduBody.enabled !== undefined) job.loadingUnload.enabled = !!lduBody.enabled;
    if (lduBody.quota !== undefined) job.loadingUnload.quota = Number(lduBody.quota ?? 0);
    if (lduBody.price !== undefined)
      job.loadingUnload.price = Number(lduBody.price ?? db.config.rates.loadingUnloading.amount);
    if (lduBody.closed === false) job.loadingUnload.closed = false;
    if (lduBody.closed === true) job.loadingUnload.closed = true;

    // ✅ re-normalize after changes (fixes stale closed when quota becomes 0)
    ensureLoadingUnload(job);
  }

  if (roleCounts && typeof roleCounts === "object") {
    job.roleCounts = {
      junior: Number(roleCounts.junior ?? job.roleCounts?.junior ?? 0),
      senior: Number(roleCounts.senior ?? job.roleCounts?.senior ?? 0),
      lead: Number(roleCounts.lead ?? job.roleCounts?.lead ?? 0),
      junior_emcee: Number(roleCounts.junior_emcee ?? job.roleCounts?.junior_emcee ?? 0),
      senior_emcee: Number(roleCounts.senior_emcee ?? job.roleCounts?.senior_emcee ?? 0),
    };
    const sum =
      job.roleCounts.junior +
      job.roleCounts.senior +
      job.roleCounts.lead +
      job.roleCounts.junior_emcee +
      job.roleCounts.senior_emcee;
    if (!headcount) job.headcount = Number(job.headcount || sum || 5);
  }

  if (roleRates && typeof roleRates === "object") {
    job.roleRates = job.roleRates || {};
    for (const r of STAFF_ROLES) {
      job.roleRates[r] = {
        payMode: roleRates?.[r]?.payMode ?? job.roleRates?.[r]?.payMode ?? "hourly",
        base: Number(roleRates?.[r]?.base ?? job.roleRates?.[r]?.base ?? 0),
        specificPayment:
          roleRates?.[r]?.specificPayment ?? job.roleRates?.[r]?.specificPayment ?? null,
        otMultiplier: Number(roleRates?.[r]?.otMultiplier ?? job.roleRates?.[r]?.otMultiplier ?? 0),
      };
    }
  }

  if (req.body && typeof req.body.adjustments === "object") {
    job.adjustments = normalizeAdjustments(req.body.adjustments, req.user);
  }

  await saveDB(db);
  addAudit("edit_job", { jobId: job.id }, req);
  res.json(job);
});

app.post("/jobs/:id/rate", authMiddleware, requireRole("pm", "admin"), async (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });

  const {
    base,
    transportBus,
    ownTransport,
    payMode,
    specificPayment,
    paymentPrice,
    lduPrice,
    lduEnabled,
    earlyCallAmount,
    earlyCallThresholdHours,
    roleRates,
  } = req.body || {};

  job.rate = job.rate || {};
  if (base !== undefined) job.rate.base = Number(base);
  if (transportBus !== undefined) job.rate.transportBus = Number(transportBus);
  if (ownTransport !== undefined) job.rate.ownTransport = Number(ownTransport);
  if (payMode !== undefined) job.rate.payMode = String(payMode);
  if (specificPayment !== undefined) job.rate.specificPayment = Number(specificPayment);
  if (paymentPrice !== undefined) job.rate.specificPayment = Number(paymentPrice);
  if (lduPrice !== undefined) job.rate.lduPrice = Number(lduPrice);

  ensureLoadingUnload(job);
  if (lduEnabled !== undefined) job.loadingUnload.enabled = !!lduEnabled;
  if (lduPrice !== undefined) job.loadingUnload.price = Number(lduPrice);
  ensureLoadingUnload(job);

  job.earlyCall = job.earlyCall || {
    enabled: false,
    amount: Number(db.config.rates.earlyCall?.defaultAmount ?? 20),
    thresholdHours: Number(db.config.rates.earlyCall?.thresholdHours ?? 3),
    participants: [],
  };
  if (earlyCallAmount !== undefined) job.earlyCall.amount = Number(earlyCallAmount);
  if (earlyCallThresholdHours !== undefined) job.earlyCall.thresholdHours = Number(earlyCallThresholdHours);

  if (roleRates && typeof roleRates === "object") {
    job.roleRates = job.roleRates || {};
    for (const r of STAFF_ROLES) {
      job.roleRates[r] = {
        payMode: roleRates?.[r]?.payMode ?? job.roleRates?.[r]?.payMode ?? "hourly",
        base: Number(roleRates?.[r]?.base ?? job.roleRates?.[r]?.base ?? 0),
        specificPayment:
          roleRates?.[r]?.specificPayment ?? job.roleRates?.[r]?.specificPayment ?? null,
        otMultiplier: Number(roleRates?.[r]?.otMultiplier ?? job.roleRates?.[r]?.otMultiplier ?? 0),
      };
    }
  }

  await saveDB(db);
  addAudit("update_job_rate", { jobId: job.id }, req);
  res.json({
    ok: true,
    rate: job.rate,
    earlyCall: job.earlyCall,
    loadingUnload: job.loadingUnload,
    roleRates: job.roleRates,
  });
});

/* ---- adjustments endpoint ---- */
app.post("/jobs/:id/adjustments", authMiddleware, requireRole("pm", "admin"), async (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });

  const incoming = req.body?.adjustments || {};
  job.adjustments = normalizeAdjustments(incoming, req.user);

  await saveDB(db);
  addAudit(
    "update_adjustments",
    {
      jobId: job.id,
      entries: Object.values(job.adjustments).reduce(
        (s, a) => s + (Array.isArray(a) ? a.length : 0),
        0
      ),
    },
    req
  );

  const hydrated = hydrateJobFullTimers(job);
  return res.json({ ok: true, job: { ...hydrated, status: computeStatus(hydrated) } });
});

/* ---- delete job ---- */
app.delete("/jobs/:id", authMiddleware, requireRole("pm", "admin"), async (req, res) => {
  const idx = db.jobs.findIndex((j) => j.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "job_not_found" });
  const removed = db.jobs.splice(idx, 1)[0];
  await saveDB(db);
  addAudit("delete_job", { jobId: removed.id }, req);
  res.json({ ok: true });
});

/* ---- apply ---- */
app.post("/jobs/:id/apply", authMiddleware, requireRole("part-timer"), async (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });

  let { transport, wantsLU } = req.body || {};
  const opts = job.transportOptions || { bus: true, own: true };
  const bothDisabled = !opts.bus && !opts.own;

  if (!transport || !["ATAG Bus", "Own Transport"].includes(transport)) {
    transport = "Own Transport";
  }

  if (!bothDisabled) {
    if (!["ATAG Bus", "Own Transport"].includes(transport)) {
      return res.status(400).json({ error: "invalid_transport" });
    }
    if (
      (transport === "ATAG Bus" && !opts.bus) ||
      (transport === "Own Transport" && !opts.own)
    ) {
      return res.status(400).json({ error: "transport_not_allowed" });
    }
  }

  ensureLoadingUnload(job);
  const luEnabled = !!job.loadingUnload.enabled || Number(job.loadingUnload.quota || 0) > 0;

  let exists = job.applications.find((a) => a.userId === req.user.id);
  if (exists) {
    const wasRejected = job.rejected.includes(req.user.id);
    if (wasRejected) {
      if ((job.approved?.length || 0) >= Number(job.headcount || 0)) {
        return res.status(409).json({ error: "job_full_no_reapply" });
      }
      exists.transport = transport;
      exists.appliedAt = dayjs().toISOString();
      job.rejected = job.rejected.filter((u) => u !== req.user.id);
      job.approved = job.approved.filter((u) => u !== req.user.id);

      if (wantsLU === true) {
        if (luEnabled && !job.loadingUnload.closed) {
          const a = job.loadingUnload.applicants || [];
          if (!a.includes(req.user.id)) a.push(req.user.id);
          job.loadingUnload.applicants = a;
          ensureLoadingUnload(job);
        }
      } else if (wantsLU === false && job.loadingUnload?.applicants) {
        job.loadingUnload.applicants = job.loadingUnload.applicants.filter((u) => u !== req.user.id);
        ensureLoadingUnload(job);
      }

      await saveDB(db);
      exportJobCSV(job);
      addAudit("reapply", { jobId: job.id, userId: req.user.id, transport, wantsLU: !!wantsLU }, req);

      // ✅✅✅ FIXED: notify admins when someone applies (including reapply) ✅✅✅
      try {
        const adminIds = (db.users || []).filter((u) => u && u.role === "admin").map((u) => u.id);
        const me = (db.users || []).find((u) => u.id === req.user.id);
        if (adminIds.length) {
          notifyUsers(adminIds, {
            title: `New application: ${job.title}`,
            body: `${me?.name || req.user.email} applied • ${transport}`,
            link: `/#/admin/jobs/${job.id}`, // adjust if your admin route differs
            type: "app_new",
          }).catch(() => {});
        }
      } catch {}

      return res.json({ ok: true, reapply: true });
    }

    exists.transport = transport;

    if (wantsLU === true) {
      if (luEnabled && !job.loadingUnload.closed) {
        const a = job.loadingUnload.applicants || [];
        if (!a.includes(req.user.id)) a.push(req.user.id);
        job.loadingUnload.applicants = a;
        ensureLoadingUnload(job);
      }
      await saveDB(db);
      exportJobCSV(job);

      // ✅✅✅ FIXED: notify admins when someone applies (existing application updated with LU) ✅✅✅
      try {
        const adminIds = (db.users || []).filter((u) => u && u.role === "admin").map((u) => u.id);
        const me = (db.users || []).find((u) => u.id === req.user.id);
        if (adminIds.length) {
          notifyUsers(adminIds, {
            title: `Application update: ${job.title}`,
            body: `${me?.name || req.user.email} updated application • ${transport}`,
            link: `/#/admin/jobs/${job.id}`,
            type: "app_new",
          }).catch(() => {});
        }
      } catch {}

      return res.json({ ok: true, updated: true });
    }

    if (wantsLU === false && job.loadingUnload?.applicants) {
      job.loadingUnload.applicants = job.loadingUnload.applicants.filter((u) => u !== req.user.id);
      ensureLoadingUnload(job);
      await saveDB(db);
      exportJobCSV(job);

      // ✅✅✅ FIXED: notify admins when someone updates their application ✅✅✅
      try {
        const adminIds = (db.users || []).filter((u) => u && u.role === "admin").map((u) => u.id);
        const me = (db.users || []).find((u) => u.id === req.user.id);
        if (adminIds.length) {
          notifyUsers(adminIds, {
            title: `Application update: ${job.title}`,
            body: `${me?.name || req.user.email} updated application • ${transport}`,
            link: `/#/admin/jobs/${job.id}`,
            type: "app_new",
          }).catch(() => {});
        }
      } catch {}

      return res.json({ ok: true, updated: true });
    }

    return res.json({ message: "already_applied" });
  }

  job.applications.push({
    userId: req.user.id,
    email: req.user.email,
    transport,
    appliedAt: dayjs().toISOString(),
  });

  if (wantsLU === true) {
    if (luEnabled && !job.loadingUnload.closed) {
      const a = job.loadingUnload.applicants || [];
      if (!a.includes(req.user.id)) a.push(req.user.id);
      job.loadingUnload.applicants = a;
      ensureLoadingUnload(job);
    }
  }

  await saveDB(db);
  exportJobCSV(job);
  addAudit("apply", { jobId: job.id, userId: req.user.id, transport, wantsLU: !!wantsLU }, req);

  // ✅✅✅ FIXED: notify admins when someone applies ✅✅✅
  try {
    const adminIds = (db.users || []).filter((u) => u && u.role === "admin").map((u) => u.id);
    const me = (db.users || []).find((u) => u.id === req.user.id);
    if (adminIds.length) {
      notifyUsers(adminIds, {
        title: `New application: ${job.title}`,
        body: `${me?.name || req.user.email} applied • ${transport}`,
        link: `/#/admin/jobs/${job.id}`,
        type: "app_new",
      }).catch(() => {});
    }
  } catch {}

  res.json({ ok: true });
});

/* ✅✅✅ NEW: Parking receipt upload (fixes your 404) ✅✅✅
   POST /jobs/:id/parking-receipt
   Body: { dataUrl, amount?, note? }
*/
/* ✅✅✅ Parking receipt APIs ✅✅✅
   - Submit: POST /jobs/:id/parking-receipt
   - My receipts: GET /jobs/:id/parking-receipt/me
   - PM/Admin all receipts: GET /jobs/:id/parking-receipts
   - Delete (owner or PM/Admin): POST /jobs/:id/parking-receipt/:rid/delete
*/

/** Build public base URL safely (Render / proxies) */
function publicBase(req) {
  const forced = String(process.env.PUBLIC_API_URL || "").replace(/\/$/, "");
  if (forced) return forced;

  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http")
    .split(",")[0]
    .trim();
  const host = String(req.headers["x-forwarded-host"] || req.get("host") || "")
    .split(",")[0]
    .trim();

  return `${proto}://${host}`;
}

/** Convert /uploads/... to absolute URL */
function toPublicUrl(req, p) {
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return p;
  return `${publicBase(req)}${p.startsWith("/") ? "" : "/"}${p}`;
}

app.get("/blob/:id", (req, res) => {
  const id = String(req.params.id || "").trim();
  const item = db.blobs?.[id];
  if (!item) return res.status(404).send("Not Found");

  const buf = Buffer.from(item.b64, "base64");
  res.setHeader("Content-Type", item.mime || "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  return res.end(buf);
});

function absPathFromReceiptUrl(photoUrl) {
  try {
    const clean = String(photoUrl || "").split("?")[0];

    // tolerate typo + correct path
    const prefixes = ["/uploads/parking-receipts/", "/uploads/parking-receceipts/"];

    for (const pfx of prefixes) {
      if (clean.startsWith(pfx)) {
        const filename = clean.slice(pfx.length);
        return path.join(parkingReceiptsDir, filename);
      }
    }
  } catch {}
  return null;
}

function enrichReceipt(req, r) {
  const u = (db.users || []).find((x) => x.id === r.userId);
  return {
    ...r,
    photoUrlAbs: toPublicUrl(req, r.photoUrl),
    name: u?.name || r.name || "",
    phone: u?.phone || "",
    discord: u?.discord || "",
  };
}

/** Submit receipt */
app.post(
  "/jobs/:id/parking-receipt",
  authMiddleware,
  requireRole("part-timer", "pm", "admin"),
  async (req, res) => {
    const job = db.jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: "job_not_found" });

    const uid = req.user.id;
    const isApproved = Array.isArray(job.approved) && job.approved.includes(uid);
    const isPMorAdmin = req.user.role === "pm" || req.user.role === "admin";
    if (!isPMorAdmin && !isApproved) return res.status(403).json({ error: "not_approved" });

    const dataUrl =
      req.body?.dataUrl ||
      req.body?.receiptDataUrl ||
      req.body?.imageDataUrl ||
      req.body?.parkingReceiptDataUrl;

    if (!dataUrl || typeof dataUrl !== "string") {
      return res.status(400).json({ error: "dataUrl_required" });
    }

    const amount = req.body?.amount;
    const note = req.body?.note ?? req.body?.remark ?? "";

    let photoUrl = "";
    try {
      photoUrl = await saveDataUrlBlob(dataUrl, {
        kind: "parking-receipt",
        ownerUserId: uid,
        jobId: job.id,
      });
    } catch (e) {
      return res.status(400).json({ error: e?.message || "invalid_receipt_image" });
    }

    job.parkingReceipts = Array.isArray(job.parkingReceipts) ? job.parkingReceipts : [];

    const receipt = {
      id: "pr" + Math.random().toString(36).slice(2, 10),
      jobId: job.id,
      userId: uid,
      email: req.user.email,
      amount: amount == null || amount === "" ? null : Number(amount),
      note: String(note || ""),
      photoUrl,
      createdAt: dayjs().toISOString(),
      status: "SUBMITTED",
    };

    job.parkingReceipts.unshift(receipt);
    await saveDB(db);

    addAudit("parking_receipt_submit", { jobId: job.id, userId: uid, receiptId: receipt.id }, req);

    const enriched = enrichReceipt(req, receipt);

    // ✅ return both relative and absolute (frontend should use photoUrlAbs)
    return res.json({
      ok: true,
      receipt: enriched,
      photoUrl: receipt.photoUrl,
      photoUrlAbs: enriched.photoUrlAbs,
    });
  }
);

/** PM/Admin list receipts for a job */
app.get(
  "/jobs/:id/parking-receipts",
  authMiddleware,
  requireRole("pm", "admin"),
  async (req, res) => {
    const job = db.jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: "job_not_found" });

    const receipts = Array.isArray(job.parkingReceipts) ? job.parkingReceipts : [];
    const enriched = receipts.map((r) => enrichReceipt(req, r));

    return res.json({ ok: true, receipts: enriched });
  }
);

/** User fetch own receipts for a job */
app.get("/jobs/:id/parking-receipt/me", authMiddleware, requireRole("part-timer", "pm", "admin"), async (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });

  const uid = req.user.id;
  const receipts = Array.isArray(job.parkingReceipts) ? job.parkingReceipts : [];
  const mine = receipts.filter((r) => r.userId === uid).map((r) => enrichReceipt(req, r));

  return res.json({
    ok: true,
    receipt: mine[0] || null,   // ✅ latest
    receipts: mine
  });
});

/** ✅ Remove my latest receipt record (even if file missing) */
app.post(
  "/jobs/:id/parking-receipt/me/remove",
  authMiddleware,
  requireRole("part-timer", "pm", "admin"),
  async (req, res) => {
    const job = db.jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: "job_not_found" });

    const uid = req.user.id;
    job.parkingReceipts = Array.isArray(job.parkingReceipts) ? job.parkingReceipts : [];

    // remove only my receipts (or just latest — but your UI seems "single receipt" style)
    const mineIdxs = [];
    for (let i = 0; i < job.parkingReceipts.length; i++) {
      if (job.parkingReceipts[i]?.userId === uid) mineIdxs.push(i);
    }
    if (!mineIdxs.length) return res.json({ ok: true, removed: 0 });

    // delete files best-effort, then remove records
    let removed = 0;
    const toDelete = mineIdxs.map((i) => job.parkingReceipts[i]).filter(Boolean);

    // remove from array (from back to front)
    for (const i of mineIdxs.slice().reverse()) {
      job.parkingReceipts.splice(i, 1);
      removed++;
    }

    for (const r of toDelete) {
      const abs = absPathFromReceiptUrl(r.photoUrl);
      try {
        // works for missing files too (ignore errors)
        if (abs && fs.existsSync(abs)) fs.unlinkSync(abs);
      } catch {}
    }

    await saveDB(db);
    addAudit("parking_receipt_me_remove", { jobId: job.id, userId: uid, removed }, req);

    return res.json({ ok: true, removed });
  }
);

app.get("/__debug/receipt-file", (req, res) => {
  const p = String(req.query.p || "");
  const abs = absPathFromReceiptUrl(p);
  return res.json({
    ok: true,
    input: p,
    abs,
    exists: abs ? fs.existsSync(abs) : false,
  });
});

/** Delete receipt (owner or PM/Admin) */
app.post(
  "/jobs/:id/parking-receipt/:rid/delete",
  authMiddleware,
  requireRole("part-timer", "pm", "admin"),
  async (req, res) => {
    const job = db.jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: "job_not_found" });

    const rid = req.params.rid;
    job.parkingReceipts = Array.isArray(job.parkingReceipts) ? job.parkingReceipts : [];

    const idx = job.parkingReceipts.findIndex((r) => r && r.id === rid);
    if (idx === -1) return res.status(404).json({ error: "receipt_not_found" });

    const receipt = job.parkingReceipts[idx];
    const isPMorAdmin = req.user.role === "pm" || req.user.role === "admin";
    if (!isPMorAdmin && receipt.userId !== req.user.id) {
      return res.status(403).json({ error: "forbidden" });
    }

    job.parkingReceipts.splice(idx, 1);
    await deleteStoredImage(receipt.photoUrl);

    // best-effort delete file
    const abs = absPathFromReceiptUrl(receipt.photoUrl);
    try {
      if (abs && fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch {}

    await saveDB(db);
    addAudit("parking_receipt_delete", { jobId: job.id, userId: req.user.id, receiptId: rid }, req);

    return res.json({ ok: true });
  }
);

/* ---- part-timer "my jobs" ---- */
app.get("/me/jobs", authMiddleware, requireRole("part-timer"), (req, res) => {
  const result = [];
  for (const j of db.jobs) {
    const applied = j.applications.find((a) => a.userId === req.user.id);
    if (applied) {
      ensureLoadingUnload(j);
      const state = j.approved.includes(req.user.id)
        ? "approved"
        : j.rejected.includes(req.user.id)
        ? "rejected"
        : "applied";
      const luApplied = !!(j.loadingUnload?.applicants || []).includes(req.user.id);
      const luConfirmed = !!(j.loadingUnload?.participants || []).includes(req.user.id);
      result.push({
        id: j.id,
        title: j.title,
        venue: j.venue,
        startTime: j.startTime,
        endTime: j.endTime,
        status: computeStatus(j),
        myStatus: state,
        luApplied,
        luConfirmed,
      });
    }
  }
  result.sort((a, b) => dayjs(a.startTime) - dayjs(b.startTime));
  res.json(result);
});

/* ---- PM: applicants list + approve ---- */
app.get("/jobs/:id/applicants", authMiddleware, requireRole("pm", "admin"), (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });

  ensureLoadingUnload(job);

  const list = job.applications.map((a) => {
    let state = "applied";
    if (job.approved.includes(a.userId)) state = "approved";
    if (job.rejected.includes(a.userId)) state = "rejected";
    const luApplied = !!(job.loadingUnload?.applicants || []).includes(a.userId);
    const luConfirmed = !!(job.loadingUnload?.participants || []).includes(a.userId);
    const u = db.users.find((x) => x.id === a.userId);
    return {
      ...a,
      status: state,
      userId: a.userId,
      luApplied,
      luConfirmed,
      name: u?.name || "",
      phone: u?.phone || "",
      discord: u?.discord || "",
      avatarUrl: u?.avatarUrl || "",
    };
  });
  res.json(list);
});

app.post("/jobs/:id/approve", authMiddleware, requireRole("pm", "admin"), async (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });

  const { userId, approve } = req.body || {};
  if (!userId || typeof approve !== "boolean") return res.status(400).json({ error: "bad_request" });

  if (approve) {
    const otherApprovedCount = job.approved.filter((u) => u !== userId).length;
    if (otherApprovedCount >= Number(job.headcount || 0)) {
      return res.status(409).json({ error: "job_full" });
    }
  }

  const applied = job.applications.find((a) => a.userId === userId);
  if (!applied) return res.status(400).json({ error: "user_not_applied" });

  job.approved = job.approved.filter((u) => u !== userId);
  job.rejected = job.rejected.filter((u) => u !== userId);

  ensureLoadingUnload(job);

  if (approve) {
    job.approved.push(userId);

    const wantsLU = (job.loadingUnload.applicants || []).includes(userId);
    const partsSet = new Set(job.loadingUnload.participants || []);
    const quota = Number(job.loadingUnload.quota || 0);

    // ✅ allow unlimited quota (0) to still add participants
    if (wantsLU && !job.loadingUnload.closed) {
      if (quota <= 0 || partsSet.size < quota) {
        partsSet.add(userId);
        job.loadingUnload.participants = Array.from(partsSet);
      }
      ensureLoadingUnload(job);
    }
  } else {
    job.rejected.push(userId);
  }

  await saveDB(db);
  exportJobCSV(job);
  addAudit(approve ? "approve" : "reject", { jobId: job.id, userId }, req);

  // ✅✅✅ FIXED: approve -> notify applicant; reject -> NO notification ✅✅✅
  try {
    if (approve) {
      notifyUsers([userId], {
        title: "Your application was approved ✅",
        body: job.title,
        link: `/#/jobs/${job.id}`,
        type: "app_approved",
      }).catch(() => {});
    }
  } catch {}

  res.json({ ok: true });
});

/* ---- Early Call (per-person toggles) ---- */
function ensureEarlyCall(job) {
  const defaultAmount = Number(db.config?.rates?.earlyCall?.defaultAmount ?? 0);
  const defaultThreshold = Number(db.config?.rates?.earlyCall?.thresholdHours ?? 0);

  if (!job.earlyCall || typeof job.earlyCall !== "object") {
    job.earlyCall = {
      enabled: false,
      amount: defaultAmount,
      thresholdHours: defaultThreshold,
      participants: [],
    };
  }

  job.earlyCall.enabled = Boolean(job.earlyCall.enabled);
  job.earlyCall.amount = Number.isFinite(Number(job.earlyCall.amount))
    ? Number(job.earlyCall.amount)
    : defaultAmount;
  job.earlyCall.thresholdHours = Number.isFinite(Number(job.earlyCall.thresholdHours))
    ? Number(job.earlyCall.thresholdHours)
    : defaultThreshold;

  if (!Array.isArray(job.earlyCall.participants)) job.earlyCall.participants = [];

  job.earlyCall.participants = Array.from(
    new Set(job.earlyCall.participants.filter((x) => typeof x === "string" && x.trim()))
  );

  return job.earlyCall;
}

app.get("/jobs/:id/earlycall", authMiddleware, requireRole("pm", "admin"), async (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });

  const ec = ensureEarlyCall(job);
  const participantDetails = ec.participants
    .map((uid) => {
      const u = db.users.find((x) => x.id === uid);
      if (!u) return null;
      return { userId: u.id, email: u.email, name: u.name || "", phone: u.phone || "", discord: u.discord || "" };
    })
    .filter(Boolean);

  return res.json({ ...ec, participantDetails });
});

app.post("/jobs/:id/earlycall/mark", authMiddleware, requireRole("pm", "admin"), async (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });

  const { userId } = req.body || {};
  const present =
    typeof req.body?.present === "boolean"
      ? req.body.present
      : typeof req.body?.enabled === "boolean"
      ? req.body.enabled
      : undefined;

  if (!userId || typeof userId !== "string") return res.status(400).json({ error: "userId_required" });
  if (typeof present !== "boolean") return res.status(400).json({ error: "present_boolean_required" });

  const ec = ensureEarlyCall(job);
  const set = new Set(ec.participants);

  if (present) set.add(userId);
  else set.delete(userId);

  ec.participants = Array.from(set);

  await saveDB(db);

  const participantDetails = ec.participants
    .map((uid) => {
      const u = db.users.find((x) => x.id === uid);
      if (!u) return null;
      return { userId: u.id, email: u.email, name: u.name || "", phone: u.phone || "", discord: u.discord || "" };
    })
    .filter(Boolean);

  return res.json({ ok: true, participants: ec.participants, participantDetails });
});

app.post("/jobs/:id/earlycall/config", authMiddleware, requireRole("pm", "admin"), async (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });

  const ec = ensureEarlyCall(job);
  const { enabled, amount, thresholdHours } = req.body || {};

  if (typeof enabled === "boolean") ec.enabled = enabled;
  if (amount !== undefined) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) return res.status(400).json({ error: "amount_must_be_non_negative_number" });
    ec.amount = n;
  }
  if (thresholdHours !== undefined) {
    const n = Number(thresholdHours);
    if (!Number.isFinite(n) || n < 0)
      return res.status(400).json({ error: "thresholdHours_must_be_non_negative_number" });
    ec.thresholdHours = n;
  }

  await saveDB(db);
  return res.json({ ok: true, earlyCall: ec });
});

// aliases
app.get("/jobs/:id/early-call", authMiddleware, requireRole("pm", "admin"), async (req, res) => {
  req.url = `/jobs/${req.params.id}/earlycall`;
  app._router.handle(req, res);
});
app.post("/jobs/:id/early-call/mark", authMiddleware, requireRole("pm", "admin"), async (req, res) => {
  req.url = `/jobs/${req.params.id}/earlycall/mark`;
  app._router.handle(req, res);
});

/* ---- Loading & Unloading (per-person toggles) ---- */
app.get("/jobs/:id/loading", authMiddleware, requireRole("pm", "admin"), (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });

  const l = ensureLoadingUnload(job);

  const details = (ids) =>
    ids.map((uid) => {
      const u = db.users.find((x) => x.id === uid) || { email: "unknown", id: uid };
      return { userId: uid, email: u.email, name: u.name || "" };
    });

  res.json({
    enabled: !!l.enabled,
    price: Number(l.price || 0),
    quota: Number(l.quota || 0),
    closed: !!l.closed,
    applicants: details(l.applicants || []),
    participants: details(l.participants || []),
  });
});

app.post("/jobs/:id/loading/mark", authMiddleware, requireRole("pm", "admin"), async (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });

  const { userId } = req.body || {};
  const present =
    typeof req.body?.present === "boolean"
      ? req.body.present
      : typeof req.body?.enabled === "boolean"
      ? req.body.enabled
      : undefined;

  if (!userId || typeof present !== "boolean") {
    return res.status(400).json({ error: "bad_request" });
  }

  ensureLoadingUnload(job);

  const quota = Number(job.loadingUnload.quota || 0); // 0 = unlimited
  const p = new Set(job.loadingUnload.participants || []);
  const alreadyIn = p.has(userId);

  // ✅ critical: if quota<=0, force not closed (prevents stale 409)
  if (quota <= 0) job.loadingUnload.closed = false;

  if (present) {
    // block only when adding NEW user AND quota>0 AND full
    if (!alreadyIn && quota > 0 && p.size >= quota) {
      return res.status(409).json({ error: "lu_quota_full", quota, count: p.size });
    }
    p.add(userId);
  } else {
    p.delete(userId);
  }

  job.loadingUnload.participants = [...p];
  ensureLoadingUnload(job);

  await saveDB(db);
  exportJobCSV(job);
  addAudit("lu_mark", { jobId: job.id, userId, present }, req);

  return res.json({
    ok: true,
    participants: job.loadingUnload.participants,
    closed: job.loadingUnload.closed,
    quota: job.loadingUnload.quota,
  });
});

/* ---- Manual attendance ---- */
app.post("/jobs/:id/attendance/mark", authMiddleware, requireRole("pm", "admin"), async (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });

  const { userId, inAt, outAt, clear } = req.body || {};
  if (!userId) return res.status(400).json({ error: "userId_required" });

  job.attendance = job.attendance || {};

  if (clear === true) {
    delete job.attendance[userId];
    await saveDB(db);
    exportJobCSV(job);
    addAudit("attendance_clear", { jobId: job.id, userId }, req);
    return res.json({ ok: true, record: null });
  }

  const rec = job.attendance[userId] || { in: null, out: null, lateMinutes: 0 };

  if (inAt !== undefined && inAt !== null) {
    const d = dayjs(inAt);
    if (!d.isValid()) return res.status(400).json({ error: "invalid_inAt" });
    rec.in = d.toISOString();
    rec.lateMinutes = Math.max(0, d.diff(dayjs(job.startTime), "minute"));
  }

  if (outAt !== undefined && outAt !== null) {
    const d2 = dayjs(outAt);
    if (!d2.isValid()) return res.status(400).json({ error: "invalid_outAt" });
    rec.out = d2.toISOString();
  }

  job.attendance[userId] = rec;
  await saveDB(db);
  exportJobCSV(job);
  addAudit("attendance_mark", { jobId: job.id, userId, inAt, outAt }, req);

  return res.json({ ok: true, record: rec, jobId: job.id, status: computeStatus(job) });
});

/* ---- Start / End / Reset ---- */
app.post("/jobs/:id/start", authMiddleware, requireRole("pm", "admin"), async (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });
  job.events = job.events || {};
  if (job.events.startedAt) return res.json({ message: "already_started", startedAt: job.events.startedAt });
  job.events.startedAt = dayjs().toISOString();
  await saveDB(db);
  addAudit("start_event", { jobId: job.id }, req);
  res.json({ ok: true, startedAt: job.events.startedAt });
});

app.post("/jobs/:id/end", authMiddleware, requireRole("pm", "admin"), async (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });
  job.events = job.events || {};
  job.events.endedAt = dayjs().toISOString();
  await saveDB(db);
  exportJobCSV(job);
  addAudit("end_event", { jobId: job.id }, req);
  res.json({ ok: true, endedAt: job.events.endedAt });
});

async function handleReset(req, res) {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });

  const keepAttendance = !!req.body?.keepAttendance;
  job.events = { startedAt: null, endedAt: null, scanner: null };
  if (!keepAttendance) job.attendance = {};

  await saveDB(db);
  exportJobCSV(job);
  addAudit("reset_event", { jobId: job.id, keepAttendance }, req);
  const hydrated = hydrateJobFullTimers(job);
  const status = computeStatus(hydrated);

  res.json({ ok: true, job: { ...hydrated, status } });
}

app.post("/jobs/:id/reset", authMiddleware, requireRole("pm", "admin"), handleReset);
app.patch("/jobs/:id/reset", authMiddleware, requireRole("pm", "admin"), handleReset);

/* ---- QR + scan ---- */
app.post("/jobs/:id/qr", authMiddleware, requireRole("part-timer"), (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });

  const state = job.approved.includes(req.user.id)
    ? "approved"
    : job.rejected.includes(req.user.id)
    ? "rejected"
    : "applied";
  if (state !== "approved") return res.status(400).json({ error: "not_approved" });
  if (!job.events?.startedAt) return res.status(400).json({ error: "event_not_started" });

  const { direction, lat, lng } = req.body || {};
  const latN = Number(lat),
    lngN = Number(lng);
  if (!["in", "out"].includes(direction)) return res.status(400).json({ error: "bad_direction" });
  if (!isValidCoord(latN, lngN)) return res.status(400).json({ error: "location_required" });

  const encLat = Math.round(latN * 1e5) / 1e5;
  const encLng = Math.round(lngN * 1e5) / 1e5;

  const payload = {
    typ: "scan",
    j: job.id,
    u: req.user.id,
    dir: direction,
    lat: encLat,
    lng: encLng,
    iat: Math.floor(Date.now() / 1000),
    nonce: uuidv4(),
  };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "60s" });
  addAudit("gen_qr", { jobId: job.id, dir: direction, userId: req.user.id, lat: encLat, lng: encLng }, req);
  res.json({ token, maxDistanceMeters: MAX_DISTANCE_METERS });
});

app.post("/scan", authMiddleware, requireRole("pm", "admin"), async (req, res) => {
  const { token, scannerLat, scannerLng } = req.body || {};
  if (!token) return res.status(400).json({ error: "missing_token" });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    addAudit("scan_error", { reason: "jwt_error" }, req);
    return res.status(400).json({ error: "jwt_error" });
  }

  if (payload.typ !== "scan") return res.status(400).json({ error: "bad_token_type" });

  const job = db.jobs.find((j) => j.id === payload.j);
  if (!job) return res.status(404).json({ error: "job_not_found" });
  if (!job.events?.startedAt) return res.status(400).json({ error: "event_not_started" });

  const sLat = Number(scannerLat),
    sLng = Number(scannerLng);
  if (!isValidCoord(payload.lat, payload.lng)) return res.status(400).json({ error: "token_missing_location" });
  if (!isValidCoord(sLat, sLng)) return res.status(400).json({ error: "scanner_location_required" });

  const dist = haversineMeters(payload.lat, payload.lng, sLat, sLng);
  if (dist > MAX_DISTANCE_METERS) {
    addAudit("scan_rejected_distance", { jobId: job.id, userId: payload.u, dist }, req);
    return res.status(400).json({
      error: "too_far",
      distanceMeters: Math.round(dist),
      maxDistanceMeters: MAX_DISTANCE_METERS,
    });
  }

  const userAttendance = job.attendance[payload.u];
  if (userAttendance?.in && payload.dir === "in") return res.status(400).json({ error: "already_checked_in" });
  if (userAttendance?.out && payload.dir === "out") return res.status(400).json({ error: "already_checked_out" });

  job.attendance = job.attendance || {};
  const now = dayjs();
  job.attendance[payload.u] = job.attendance[payload.u] || { in: null, out: null, lateMinutes: 0 };

  if (payload.dir === "in") {
    job.attendance[payload.u].in = now.toISOString();
    job.attendance[payload.u].lateMinutes = Math.max(0, now.diff(dayjs(job.startTime), "minute"));
  } else {
    job.attendance[payload.u].out = now.toISOString();
  }

  await saveDB(db);
  exportJobCSV(job);
  addAudit("scan_" + payload.dir, { jobId: job.id, userId: payload.u, distanceMeters: Math.round(dist) }, req);

  res.json({
    ok: true,
    jobId: job.id,
    userId: payload.u,
    direction: payload.dir,
    time: now.toISOString(),
    record: job.attendance[payload.u],
  });
});

/* ---- CSV download ---- */
app.get("/jobs/:id/csv", authMiddleware, requireRole("admin"), (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });
  const { headers, rows } = generateJobCSV(job);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="job-${job.id}.csv"`);
  res.write(headers.join(",") + "\n");
  for (const r of rows) {
    const line = headers.map((h) => (r[h] !== undefined ? String(r[h]).replace(/"/g, '""') : "")).join(",");
    res.write(line + "\n");
  }
  res.end();
});

/* ---- audit & misc ---- */
app.get("/admin/audit", authMiddleware, requireRole("admin"), (req, res) => {
  const limit = Number(req.query.limit || 200);
  res.json((db.audit || []).slice(0, limit));
});

/* ---- Push + Notifications API ---- */
app.get("/push/public-key", (_req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || "" });
});

app.post("/push/subscribe", authMiddleware, async (req, res) => {
  const sub = req.body?.subscription;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: "bad_subscription" });
  const uid = req.user.id;
  const list = db.pushSubs[uid] || [];
  const exists = new Set(list.map((s) => s && s.endpoint));
  if (!exists.has(sub.endpoint)) list.push(sub);
  db.pushSubs[uid] = list;
  await saveDB(db);
  addAudit("push_subscribe", { userId: uid }, req);
  res.json({ ok: true });
});

app.post("/push/unsubscribe", authMiddleware, async (req, res) => {
  const ep = req.body?.endpoint;
  const uid = req.user.id;
  if (!ep) return res.status(400).json({ error: "endpoint_required" });
  db.pushSubs[uid] = (db.pushSubs[uid] || []).filter((s) => (s && s.endpoint) !== ep);
  await saveDB(db);
  addAudit("push_unsubscribe", { userId: uid }, req);
  res.json({ ok: true });
});

app.get("/notifications", authMiddleware, (req, res) => {
  const limit = Number(req.query.limit || 100);
  const onlyUnread = String(req.query.unread || "") === "1";
  let items = (db.notifications[req.user.id] || []).slice(0, limit);
  if (onlyUnread) items = items.filter((n) => !n.read);
  res.json(items);
});

app.post("/notifications/:id/read", authMiddleware, async (req, res) => {
  const uid = req.user.id;
  const list = db.notifications[uid] || [];
  const n = list.find((x) => x.id === req.params.id);
  if (!n) return res.status(404).json({ error: "not_found" });
  n.read = true;
  await saveDB(db);
  res.json({ ok: true });
});

app.get("/me/notifications", authMiddleware, (req, res) => {
  const items = (db.notifications[req.user.id] || []).slice(0, Number(req.query.limit || 50));
  res.json({ items });
});

app.post("/me/notifications/read-all", authMiddleware, async (req, res) => {
  const uid = req.user.id;
  const list = db.notifications[uid] || [];
  for (const it of list) it.read = true;
  await saveDB(db);
  res.json({ ok: true });
});

app.post("/push/test", authMiddleware, requireRole("admin"), async (req, res) => {
  await notifyUsers([req.user.id], { title: "Test notification", body: "Push is working ✅", link: "/#/", type: "test" });
  res.json({ ok: true });
});

/* ---- reset + health ---- */
app.post("/__reset", async (_req, res) => {
  db = await loadDB();
  res.json({ ok: true });
});
app.get("/health", (_req, res) => res.json({ ok: true }));

/* ---- scanner location heartbeat ---- */
function setScannerLocation(job, lat, lng) {
  job.events = job.events || {};
  job.events.scanner = { lat, lng, updatedAt: dayjs().toISOString() };
}
app.post("/jobs/:id/scanner/heartbeat", authMiddleware, requireRole("pm", "admin"), async (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });
  if (!job.events?.startedAt) return res.status(400).json({ error: "event_not_started" });
  const { lat, lng } = req.body || {};
  const latN = Number(lat),
    lngN = Number(lng);
  if (!isValidCoord(latN, lngN)) return res.status(400).json({ error: "scanner_location_required" });
  setScannerLocation(job, latN, lngN);
  await saveDB(db);
  addAudit("scanner_heartbeat", { jobId: job.id, lat: latN, lng: lngN }, req);
  res.json({ ok: true, updatedAt: job.events.scanner.updatedAt });
});
app.get("/jobs/:id/scanner", authMiddleware, (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });
  if (!job.events?.startedAt) return res.status(400).json({ error: "event_not_started" });
  const s = job.events?.scanner;
  if (!s) return res.status(404).json({ error: "scanner_unknown" });
  res.json({ lat: s.lat, lng: s.lng, updatedAt: s.updatedAt });
});

function listRoutes(appInstance) {
  const out = [];
  appInstance._router?.stack?.forEach((m) => {
    if (m.route?.path) {
      const methods = Object.keys(m.route.methods).map((s) => s.toUpperCase());
      out.push(`${methods.join(",")} ${m.route.path}`);
    }
  });
  return out.sort();
}
app.get("/__routes", (_req, res) => {
  res.json({ routes: listRoutes(app) });
});

/* ---- start ---- */
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log("ATAG server running on http://localhost:" + PORT);
  console.log("Booting server from:", new URL(import.meta.url).pathname);
});
setTimeout(() => {
  console.log("Registered routes:\n" + listRoutes(app).join("\n"));
}, 100);
