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
import { loadDB, saveDB } from "./storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

/* ---------------- DB + defaults ---------------- */
// Load DB (Postgres if DATABASE_URL, else file)
let db = await loadDB();

// Seed config & defaults if missing
db.config = db.config || {};
db.config.jwtSecret = db.config.jwtSecret || "dev-secret";
db.config.scanMaxDistanceMeters = db.config.scanMaxDistanceMeters || 500;

// Legacy rates (kept for compatibility)
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
  earlyCall: { defaultAmount: 20 },
};
db.config.rates = db.config.rates || DEFAULT_RATES;

// Admin default role pay tables (never blank)
db.config.roleRatesDefaults = db.config.roleRatesDefaults || {
  junior: { payMode: "hourly", base: Number(db.config.rates?.physicalHourly?.junior ?? 20), specificPayment: null, otMultiplier: 0 },
  senior: { payMode: "hourly", base: Number(db.config.rates?.physicalHourly?.senior ?? 30), specificPayment: null, otMultiplier: 0 },
  lead:   { payMode: "hourly", base: Number(db.config.rates?.physicalHourly?.lead   ?? 30), specificPayment: null, otMultiplier: 0 },
};
await saveDB(db);

/* ------------ auth / helpers ------------- */
const JWT_SECRET = db.config.jwtSecret;
const MAX_DISTANCE_METERS = Number(
  process.env.SCAN_MAX_DISTANCE_METERS ||
    db.config.scanMaxDistanceMeters ||
    500
);

const toRad = (deg) => (deg * Math.PI) / 180;
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
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const signToken = (payload) =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

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
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role)
    ? next()
    : res.status(403).json({ error: "forbidden" });

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
  // No await saveDB here; handlers that mutate data already persist.
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

// Password helpers
function hashPassword(password) {
  const iterations = 150000;
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto
    .pbkdf2Sync(password, salt, iterations, 32, "sha256")
    .toString("hex");
  return `pbkdf2_sha256$${iterations}$${salt}$${derived}`;
}
function verifyPassword(password, encoded) {
  try {
    const [algo, iterStr, salt, hash] = String(encoded).split("$");
    if (algo !== "pbkdf2_sha256") return false;
    const iterations = parseInt(iterStr, 10);
    const derived = crypto
      .pbkdf2Sync(password, salt, iterations, 32, "sha256")
      .toString("hex");
    return crypto.timingSafeEqual(
      Buffer.from(derived, "hex"),
      Buffer.from(hash, "hex")
    );
  } catch {
    return false;
  }
}
function findUserByIdentifier(id) {
  const x = String(id || "").toLowerCase();
  return (db.users || []).find(
    (u) =>
      String(u.email || "").toLowerCase() === x ||
      String(u.username || "").toLowerCase() === x
  );
}

// Helpers
const ROLES = ["part-timer", "pm", "admin"];
const STAFF_ROLES = ["junior", "senior", "lead"];
const clampRole  = (r) => (ROLES.includes(String(r)) ? String(r) : "part-timer");
// NEW: grade clamp
const clampGrade = (g) => (STAFF_ROLES.includes(String(g)) ? String(g) : "junior");

function paySummaryFromRate(rate = {}) {
  const pm = rate.payMode;
  const hr = Number(rate.base ?? rate.hourlyBase);
  const fix = Number(rate.specificPayment ?? rate.specificAmount);
  const otm = Number(rate.otMultiplier || 0);
  const otTag = otm > 0 ? ` (OT x${otm})` : "";

  if (pm === "specific" && Number.isFinite(fix))
    return `RM ${Math.round(fix)} / shift`;
  if (
    pm === "specific_plus_hourly" &&
    Number.isFinite(fix) &&
    Number.isFinite(hr)
  )
    return `RM ${Math.round(fix)} + RM ${Math.round(hr)}/hr${otTag}`;
  if ((pm === "hourly" || pm == null) && Number.isFinite(hr))
    return `RM ${Math.round(hr)}/hr${otTag}`;

  const legacyHr =
    rate?.physicalHourly?.junior ?? rate?.virtualHourly?.junior;
  if (Number.isFinite(legacyHr)) return `From RM ${Math.round(legacyHr)}/hr`;
  return "See details";
}

// ===== Scheduled hours helpers (to drive hourly pay from job window) =====
function hoursBetweenISO(startISO, endISO) {
  if (!startISO || !endISO) return 0;
  const s = dayjs(startISO);
  const e = dayjs(endISO);
  const ms = Math.max(0, e.diff(s, "millisecond"));
  return ms / 3600000; // hours float
}
function scheduledHours(job) {
  return Number(hoursBetweenISO(job?.startTime, job?.endTime).toFixed(2));
}

function jobPublicView(job) {
  const {
    id,
    title,
    venue,
    description,
    startTime,
    endTime,
    headcount,
    transportOptions,
    roleCounts,
  } = job;
  const lu = job.loadingUnload || {
    quota: 0,
    applicants: [],
    participants: [],
  };

  const appliedCount = Array.isArray(job.applications)
    ? job.applications.length
    : 0;
  const approvedCount = Array.isArray(job.approved)
    ? job.approved.length
    : 0;

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
      quota: lu.quota || 0,
      applicants: lu.applicants?.length || 0,
    },
    roleCounts: roleCounts || { junior: 0, senior: 0, lead: 0 },
    appliedCount,
    approvedCount,
    paySummary: paySummaryFromRate(job.rate || {}),
  };
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

  for (const u of job.applications) {
    const luApplied = !!(job.loadingUnload?.applicants || []).includes(
      u.userId
    );
    const luConfirmed = !!(job.loadingUnload?.participants || []).includes(
      u.userId
    );
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

/* ---------- One-time user upgrade/seed for password auth ---------- */
db.users = db.users || [];
let mutated = false;
for (const u of db.users) {
  if (!u.username) {
    u.username =
      (u.email && u.email.split("@")[0]) ||
      `user_${u.id || Math.random().toString(36).slice(2, 8)}`;
    mutated = true;
  }
  if (!u.passwordHash) {
    u.passwordHash = hashPassword("password");
    mutated = true;
  }
  // Ensure staff grade exists
  if (!u.grade || !STAFF_ROLES.includes(u.grade)) {
    u.grade = "junior";
    mutated = true;
  }
  if (u.resetToken && (!u.resetToken.token || !u.resetToken.expiresAt)) {
    delete u.resetToken;
    mutated = true;
  }
}
if (mutated) await saveDB(db);

/* ---------- Ensure adjustments exists on all jobs (boot migration) ---------- */
db.jobs = db.jobs || [];
let adjMutated = false;
for (const j of db.jobs) {
  if (!j.adjustments || typeof j.adjustments !== "object") {
    j.adjustments = {};
    adjMutated = true;
  } else {
    const norm = normalizeAdjustments(j.adjustments);
    const before = JSON.stringify(j.adjustments);
    const after = JSON.stringify(norm);
    if (before !== after) {
      j.adjustments = norm;
      adjMutated = true;
    }
  }
}
if (adjMutated) await saveDB(db);

/* -------------- auth --------------- */

app.post("/login", async (req, res) => {
  const { identifier, email, username, password } = req.body || {};
  const id = identifier || email || username;
  if (!id || !password)
    return res.status(400).json({ error: "missing_credentials" });

  const user = findUserByIdentifier(id);
  if (!user) return res.status(401).json({ error: "unknown_user" });

  if (!verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "invalid_password" });
  }

  const token = signToken({
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    grade: user.grade || "junior",
  });
  addAudit("login", { identifier: id }, { user });
  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      grade: user.grade || "junior",
    },
  });
});

app.post("/register", async (req, res) => {
  const { email, username, name, password, role } = req.body || {};
  if (!email || !password)
    return res
      .status(400)
      .json({ error: "email_and_password_required" });

  const pickedRole = clampRole(role || "part-timer");

  const emailLower = String(email).toLowerCase();
  if (
    db.users.find(
      (u) => String(u.email || "").toLowerCase() === emailLower
    )
  ) {
    return res.status(409).json({ error: "email_taken" });
  }
  if (username) {
    const userLower = String(username).toLowerCase();
    if (
      db.users.find(
        (u) => String(u.username || "").toLowerCase() === userLower
      )
    ) {
      return res.status(409).json({ error: "username_taken" });
    }
  }

  const id = "u" + Math.random().toString(36).slice(2, 10);
  const finalUsername = username || email.split("@")[0];
  const passwordHash = hashPassword(password);

  const newUser = {
    id,
    email,
    username: finalUsername,
    name: name || finalUsername,
    role: pickedRole,   // part-timer by default
    grade: "junior",    // NEW default staff grade
    passwordHash,
  };
  db.users.push(newUser);
  await saveDB(db);
  addAudit("register", { email, role: pickedRole }, { user: newUser });

  const token = signToken({
    id,
    email,
    role: newUser.role,
    name: newUser.name,
    grade: newUser.grade,
  });
  res.json({
    token,
    user: { id, email, role: newUser.role, name: newUser.name, grade: newUser.grade },
  });
});

app.post("/forgot-password", async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "email_required" });
  const emailLower = String(email).toLowerCase();
  const user = db.users.find(
    (u) => String(u.email || "").toLowerCase() === emailLower
  );
  if (!user) return res.json({ ok: true });

  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = Date.now() + 60 * 60 * 1000;
  user.resetToken = { token, expiresAt };
  await saveDB(db);

  const origin = req.headers?.origin || "";
  const resetLink = `${origin}#\/reset?token=${token}`;
  addAudit("forgot_password", { email }, { user });
  res.json({ ok: true, token, resetLink });
});

app.post("/reset-password", async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password)
    return res
      .status(400)
      .json({ error: "missing_token_or_password" });

  const user = db.users.find(
    (u) => u.resetToken && u.resetToken.token === token
  );
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

app.get("/me", authMiddleware, (req, res) => {
  const user = db.users.find((u) => u.id === req.user.id);
  res.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      grade: user.grade || "junior",
    },
  });
});

/* -------- Admin: users (list & update role/grade) -------- */
app.get("/admin/users", authMiddleware, requireRole("admin"), (_req, res) => {
  const list = (db.users || []).map(u => ({
    id: u.id,
    email: u.email,
    username: u.username,
    name: u.name,
    role: u.role,
    grade: u.grade || "junior",
  }));
  res.json(list);
});

app.patch("/admin/users/:id", authMiddleware, requireRole("admin"), async (req, res) => {
  const target = db.users.find(u => u.id === req.params.id);
  if (!target) return res.status(404).json({ error: "user_not_found" });

  const { role, grade } = req.body || {};
  const before = { role: target.role, grade: target.grade || "junior" };

  // Prevent removing the last admin
  if (role && clampRole(role) !== "admin" && target.role === "admin") {
    const adminCount = (db.users || []).filter(u => u.role === "admin").length;
    if (adminCount <= 1) return res.status(400).json({ error: "last_admin" });
  }

  if (role !== undefined)  target.role  = clampRole(role);
  if (grade !== undefined) target.grade = clampGrade(grade);

  await saveDB(db);
  addAudit("admin_update_user_role_grade",
    { userId: target.id, before, after: { role: target.role, grade: target.grade } },
    req
  );

  res.json({
    ok: true,
    user: {
      id: target.id,
      email: target.email,
      username: target.username,
      name: target.name,
      role: target.role,
      grade: target.grade || "junior",
    },
  });
});

/* -------- Config (Admin) -------- */
app.get(
  "/config/rates",
  authMiddleware,
  requireRole("admin"),
  (req, res) => {
    res.json({
      ...db.config.rates,
      roleRatesDefaults: db.config.roleRatesDefaults,
    });
  }
);
app.post(
  "/config/rates",
  authMiddleware,
  requireRole("admin"),
  async (req, res) => {
    const body = req.body || {};
    db.config.rates = Object.keys(body).length
      ? { ...db.config.rates, ...body }
      : db.config.rates;
    if (body.roleRatesDefaults && typeof body.roleRatesDefaults === "object") {
      db.config.roleRatesDefaults = {
        ...db.config.roleRatesDefaults,
        ...body.roleRatesDefaults,
      };
    }
    await saveDB(db);
    addAudit("update_rates_default", { rates: db.config.rates, roleRatesDefaults: db.config.roleRatesDefaults }, req);
    res.json({ ok: true, rates: db.config.rates, roleRatesDefaults: db.config.roleRatesDefaults });
  }
);

/* -------------- jobs --------------- */
app.get("/jobs", (req, res) => {
  const jobs = db.jobs
    .map((j) => jobPublicView(j))
    .sort((a, b) => dayjs(a.startTime) - dayjs(b.startTime));
  res.json(req.query.limit ? jobs.slice(0, Number(req.query.limit)) : jobs);
});

app.get("/jobs/:id", (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });
  res.json({ ...job, status: computeStatus(job) });
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
  if (!title || !venue || !startTime || !endTime)
    return res.status(400).json({ error: "missing_fields" });

  const id = "j" + Math.random().toString(36).slice(2, 8);
  const lduBody = ldu || loadingUnload || {};

  const counts = {
    junior: Number(roleCounts?.junior ?? 0),
    senior: Number(roleCounts?.senior ?? 0),
    lead:   Number(roleCounts?.lead   ?? 0),
  };
  const countsSum = counts.junior + counts.senior + counts.lead;

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
      thresholdHours: Number(earlyCall?.thresholdHours ?? 3),
    },
    loadingUnload: {
      enabled: !!lduBody.enabled,
      quota: Number(lduBody.quota ?? 0),
      price: Number(lduBody.price ?? db.config.rates.loadingUnloading.amount),
      applicants: [],
      participants: [],
    },
    applications: [],
    approved: [],
    rejected: [],
    attendance: {},
    events: { startedAt: null, endedAt: null, scanner: null },
    adjustments: {},
  };

  db.jobs.push(job);
  await saveDB(db);
  addAudit("create_job", { jobId: id, title }, req);
  res.json(job);
});

app.patch(
  "/jobs/:id",
  authMiddleware,
  requireRole("pm", "admin"),
  async (req, res) => {
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
      job.transportOptions = {
        bus: !!transportOptions.bus,
        own: !!transportOptions.own,
      };

    if (rate && typeof rate === "object") {
      job.rate = { ...job.rate, ...rate };
    }

    if (earlyCall) {
      job.earlyCall = {
        enabled: !!earlyCall.enabled,
        amount: Number(
          earlyCall.amount ??
            job.earlyCall?.amount ??
            db.config.rates.earlyCall?.defaultAmount ??
            20
        ),
        thresholdHours: Number(
          earlyCall.thresholdHours ?? job.earlyCall?.thresholdHours ?? 3
        ),
      };
    }

    const lduBody = ldu || loadingUnload;
    if (lduBody) {
      job.loadingUnload = {
        enabled:
          lduBody.enabled !== undefined
            ? !!lduBody.enabled
            : !!job.loadingUnload?.enabled,
        quota: Number(lduBody.quota ?? job.loadingUnload?.quota ?? 0),
        price: Number(
          lduBody.price ??
            job.loadingUnload?.price ??
            db.config.rates.loadingUnloading.amount
        ),
        applicants: Array.isArray(job.loadingUnload?.applicants)
          ? job.loadingUnload.applicants
          : [],
        participants: Array.isArray(job.loadingUnload?.participants)
          ? job.loadingUnload.participants
          : [],
      };
    }

    if (roleCounts && typeof roleCounts === "object") {
      job.roleCounts = {
        junior: Number(roleCounts.junior ?? job.roleCounts?.junior ?? 0),
        senior: Number(roleCounts.senior ?? job.roleCounts?.senior ?? 0),
        lead:   Number(roleCounts.lead   ?? job.roleCounts?.lead   ?? 0),
      };
      const sum = job.roleCounts.junior + job.roleCounts.senior + job.roleCounts.lead;
      if (!headcount) job.headcount = Number(job.headcount || sum || 5);
    }
    if (roleRates && typeof roleRates === "object") {
      job.roleRates = job.roleRates || {};
      for (const r of STAFF_ROLES) {
        job.roleRates[r] = {
          payMode: roleRates?.[r]?.payMode ?? job.roleRates?.[r]?.payMode ?? "hourly",
          base: Number(roleRates?.[r]?.base ?? job.roleRates?.[r]?.base ?? 0),
          specificPayment: roleRates?.[r]?.specificPayment ?? job.roleRates?.[r]?.specificPayment ?? null,
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
  }
);

app.post(
  "/jobs/:id/rate",
  authMiddleware,
  requireRole("pm", "admin"),
  async (req, res) => {
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
    if (transportBus !== undefined)
      job.rate.transportBus = Number(transportBus);
    if (ownTransport !== undefined)
      job.rate.ownTransport = Number(ownTransport);
    if (payMode !== undefined) job.rate.payMode = String(payMode);
    if (specificPayment !== undefined)
      job.rate.specificPayment = Number(specificPayment);
    if (paymentPrice !== undefined)
      job.rate.specificPayment = Number(paymentPrice);
    if (lduPrice !== undefined) job.rate.lduPrice = Number(lduPrice);

    job.loadingUnload = job.loadingUnload || {
      enabled: false,
      quota: 0,
      price: Number(db.config.rates.loadingUnloading.amount),
      applicants: [],
      participants: [],
    };
    if (lduEnabled !== undefined) job.loadingUnload.enabled = !!lduEnabled;
    if (lduPrice !== undefined) job.loadingUnload.price = Number(lduPrice);

    job.earlyCall = job.earlyCall || {
      enabled: false,
      amount: Number(db.config.rates.earlyCall?.defaultAmount ?? 20),
      thresholdHours: 3,
    };
    if (earlyCallAmount !== undefined)
      job.earlyCall.amount = Number(earlyCallAmount);
    if (earlyCallThresholdHours !== undefined)
      job.earlyCall.thresholdHours = Number(earlyCallThresholdHours);

    if (roleRates && typeof roleRates === "object") {
      job.roleRates = job.roleRates || {};
      for (const r of STAFF_ROLES) {
        job.roleRates[r] = {
          payMode: roleRates?.[r]?.payMode ?? job.roleRates?.[r]?.payMode ?? "hourly",
          base: Number(roleRates?.[r]?.base ?? job.roleRates?.[r]?.base ?? 0),
          specificPayment: roleRates?.[r]?.specificPayment ?? job.roleRates?.[r]?.specificPayment ?? null,
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
  }
);

/* ---- persist adjustments via dedicated endpoint ---- */
app.post(
  "/jobs/:id/adjustments",
  authMiddleware,
  requireRole("pm", "admin"),
  async (req, res) => {
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

    return res.json({ ok: true, job: { ...job, status: computeStatus(job) } });
  }
);

/* ---- delete job ---- */
app.delete(
  "/jobs/:id",
  authMiddleware,
  requireRole("pm", "admin"),
  async (req, res) => {
    const idx = db.jobs.findIndex((j) => j.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "job_not_found" });
    const removed = db.jobs.splice(idx, 1)[0];
    await saveDB(db);
    addAudit("delete_job", { jobId: removed.id }, req);
    res.json({ ok: true });
  }
);

/* ---- apply (transport + optional L&U) ---- */
app.post(
  "/jobs/:id/apply",
  authMiddleware,
  requireRole("part-timer"),
  async (req, res) => {
    const job = db.jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: "job_not_found" });

    const { transport, wantsLU } = req.body || {};
    if (!["ATAG Bus", "Own Transport"].includes(transport))
      return res.status(400).json({ error: "invalid_transport" });

    const opts = job.transportOptions || { bus: true, own: true };
    if (
      (transport === "ATAG Bus" && !opts.bus) ||
      (transport === "Own Transport" && !opts.own)
    )
      return res.status(400).json({ error: "transport_not_allowed" });

    const lu =
      job.loadingUnload || {
        enabled: false,
        quota: 0,
        applicants: [],
        participants: [],
      };
    const luEnabled = lu.enabled ?? lu.quota > 0;

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
          if (!luEnabled) return res.status(400).json({ error: "lu_disabled" });
          job.loadingUnload = lu;
          const a = job.loadingUnload.applicants;
          if (job.loadingUnload.quota > 0) {
            if (a.length >= job.loadingUnload.quota)
              return res.status(400).json({ error: "lu_quota_full" });
            if (!a.includes(req.user.id)) a.push(req.user.id);
          }
        } else if (wantsLU === false && job.loadingUnload?.applicants) {
          job.loadingUnload.applicants = job.loadingUnload.applicants.filter(
            (u) => u !== req.user.id
          );
        }
        await saveDB(db);
        exportJobCSV(job);
        addAudit(
          "reapply",
          {
            jobId: job.id,
            userId: req.user.id,
            transport,
            wantsLU: !!wantsLU,
          },
          req
        );
        return res.json({ ok: true, reapply: true });
      }
      if (wantsLU === true) {
        if (!luEnabled) return res.status(400).json({ error: "lu_disabled" });
        job.loadingUnload = lu;
        const a = job.loadingUnload.applicants;
        if (job.loadingUnload.quota > 0) {
          if (a.length >= job.loadingUnload.quota && !a.includes(req.user.id))
            return res.status(400).json({ error: "lu_quota_full" });
          if (!a.includes(req.user.id)) a.push(req.user.id);
        }
        await saveDB(db);
        exportJobCSV(job);
        return res.json({ ok: true, updated: true });
      }
      if (wantsLU === false && job.loadingUnload?.applicants) {
        job.loadingUnload.applicants = job.loadingUnload.applicants.filter(
          (u) => u !== req.user.id
        );
        await saveDB(db);
        exportJobCSV(job);
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
      if (!luEnabled) return res.status(400).json({ error: "lu_disabled" });
      job.loadingUnload = lu;
      const a = job.loadingUnload.applicants;
      if (job.loadingUnload.quota > 0) {
        if (a.length >= job.loadingUnload.quota)
          return res.status(400).json({ error: "lu_quota_full" });
        if (!a.includes(req.user.id)) a.push(req.user.id);
      }
    }

    await saveDB(db);
    exportJobCSV(job);
    addAudit(
      "apply",
      {
        jobId: job.id,
        userId: req.user.id,
        transport,
        wantsLU: !!wantsLU,
      },
      req
    );
    res.json({ ok: true });
  }
);

/* ---- part-timer "my jobs" ---- */
app.get(
  "/me/jobs",
  authMiddleware,
  requireRole("part-timer"),
  (req, res) => {
    const result = [];
    for (const j of db.jobs) {
      const applied = j.applications.find((a) => a.userId === req.user.id);
      if (applied) {
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
  }
);

/* ---- PM: applicants list + approve ---- */
app.get(
  "/jobs/:id/applicants",
  authMiddleware,
  requireRole("pm", "admin"),
  (req, res) => {
    const job = db.jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: "job_not_found" });
    const list = job.applications.map((a) => {
      let state = "applied";
      if (job.approved.includes(a.userId)) state = "approved";
      if (job.rejected.includes(a.userId)) state = "rejected";
      const luApplied = !!(job.loadingUnload?.applicants || []).includes(
        a.userId
      );
      const luConfirmed = !!(job.loadingUnload?.participants || []).includes(
        a.userId
      );
      return {
        ...a,
        status: state,
        userId: a.userId,
        luApplied,
        luConfirmed,
      };
    });
    res.json(list);
  }
);
app.post(
  "/jobs/:id/approve",
  authMiddleware,
  requireRole("pm", "admin"),
  async (req, res) => {
    const job = db.jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: "job_not_found" });
    const { userId, approve } = req.body || {};
    if (!userId || typeof approve !== "boolean")
      return res.status(400).json({ error: "bad_request" });

    if (approve && (job.approved?.length || 0) >= Number(job.headcount || 0)) {
      return res.status(409).json({ error: "job_full" });
    }

    const applied = job.applications.find((a) => a.userId === userId);
    if (!applied) return res.status(400).json({ error: "user_not_applied" });
    job.approved = job.approved.filter((u) => u !== userId);
    job.rejected = job.rejected.filter((u) => u !== userId);
    if (approve) job.approved.push(userId);
    else job.rejected.push(userId);
    await saveDB(db);
    exportJobCSV(job);
    addAudit(approve ? "approve" : "reject", { jobId: job.id, userId }, req);
    res.json({ ok: true });
  }
);

/* ---- PM: L&U manage ---- */
app.get(
  "/jobs/:id/loading",
  authMiddleware,
  requireRole("pm", "admin"),
  (req, res) => {
    const job = db.jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: "job_not_found" });
    const l =
      job.loadingUnload || {
        enabled: false,
        price: db.config.rates.loadingUnloading.amount,
        quota: 0,
        applicants: [],
        participants: [],
      };
    const details = (ids) =>
      ids.map((uid) => {
        const u = db.users.find((x) => x.id === uid) || {
          email: "unknown",
          id: uid,
        };
        return { userId: uid, email: u.email };
      });
    res.json({
      enabled: !!l.enabled,
      price: Number(l.price || 0),
      quota: l.quota || 0,
      applicants: details(l.applicants || []),
      participants: details(l.participants || []),
    });
  }
);
app.post(
  "/jobs/:id/loading/mark",
  authMiddleware,
  requireRole("pm", "admin"),
  async (req, res) => {
    const job = db.jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: "job_not_found" });
    const { userId, present } = req.body || {};
    if (!userId || typeof present !== "boolean")
      return res.status(400).json({ error: "bad_request" });
    job.loadingUnload = job.loadingUnload || {
      enabled: false,
      quota: 0,
      price: db.config.rates.loadingUnloading.amount,
      applicants: [],
      participants: [],
    };
    const p = new Set(job.loadingUnload.participants || []);
    if (present) {
      if (!p.has(userId)) {
        if ((p.size || 0) >= Number(job.loadingUnload.quota || 0)) {
          return res.status(409).json({ error: "lu_quota_full" });
        }
        p.add(userId);
      }
    } else {
      p.delete(userId);
    }
    job.loadingUnload.participants = [...p];
    await saveDB(db);
    exportJobCSV(job);
    addAudit("lu_mark", { jobId: job.id, userId, present }, req);
    res.json({ ok: true, participants: job.loadingUnload.participants });
  }
);

/* ---- NEW: Virtual / Manual attendance mark (for PM/Admin) ---- */
app.post(
  "/jobs/:id/attendance/mark",
  authMiddleware,
  requireRole("pm", "admin"),
  async (req, res) => {
    const job = db.jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: "job_not_found" });

    const { userId, inAt, outAt, clear } = req.body || {};
    if (!userId) return res.status(400).json({ error: "userId_required" });

    // Ensure container exists
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

    return res.json({
      ok: true,
      record: rec,
      jobId: job.id,
      status: computeStatus(job),
    });
  }
);

/* ---- Start / End / Reset ---- */
app.post(
  "/jobs/:id/start",
  authMiddleware,
  requireRole("pm", "admin"),
  async (req, res) => {
    const job = db.jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: "job_not_found" });
    job.events = job.events || {};
    if (job.events.startedAt)
      return res.json({
        message: "already_started",
        startedAt: job.events.startedAt,
      });
    job.events.startedAt = dayjs().toISOString();
    await saveDB(db);
    addAudit("start_event", { jobId: job.id }, req);
    res.json({ ok: true, startedAt: job.events.startedAt });
  }
);

app.post(
  "/jobs/:id/end",
  authMiddleware,
  requireRole("pm", "admin"),
  async (req, res) => {
    const job = db.jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: "job_not_found" });
    job.events = job.events || {};
    job.events.endedAt = dayjs().toISOString();
    await saveDB(db);
    exportJobCSV(job);
    addAudit("end_event", { jobId: job.id }, req);
    res.json({ ok: true, endedAt: job.events.endedAt });
  }
);

async function handleReset(req, res) {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });
  const keepAttendance = !!req.body?.keepAttendance;
  job.events = { startedAt: null, endedAt: null, scanner: null };
  if (!keepAttendance) job.attendance = {};
  else job.attendance = job.attendance || {};
  await saveDB(db);
  exportJobCSV(job);
  addAudit("reset_event", { jobId: job.id, keepAttendance }, req);
  const status = computeStatus(job);
  res.json({ ok: true, job: { ...job, status } });
}
app.post("/jobs/:id/reset", authMiddleware, requireRole("pm", "admin"), handleReset);
app.patch("/jobs/:id/reset", authMiddleware, requireRole("pm", "admin"), handleReset);

/* ---- QR + scan (location bound) ---- */
app.post(
  "/jobs/:id/qr",
  authMiddleware,
  requireRole("part-timer"),
  (req, res) => {
    const job = db.jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: "job_not_found" });

    const state = job.approved.includes(req.user.id)
      ? "approved"
      : job.rejected.includes(req.user.id)
      ? "rejected"
      : "applied";
    if (state !== "approved") return res.status(400).json({ error: "not_approved" });
    if (!job.events?.startedAt)
      return res.status(400).json({ error: "event_not_started" });

    const { direction, lat, lng } = req.body || {};
    const latN = Number(lat),
      lngN = Number(lng);
    if (!["in", "out"].includes(direction))
      return res.status(400).json({ error: "bad_direction" });
    if (!isValidCoord(latN, lngN))
      return res.status(400).json({ error: "location_required" });

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
    addAudit(
      "gen_qr",
      {
        jobId: job.id,
        dir: direction,
        userId: req.user.id,
        lat: encLat,
        lng: encLng,
      },
      req
    );
    res.json({ token, maxDistanceMeters: MAX_DISTANCE_METERS });
  }
);

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
  if (payload.typ !== "scan")
    return res.status(400).json({ error: "bad_token_type" });

  const job = db.jobs.find((j) => j.id === payload.j);
  if (!job) return res.status(404).json({ error: "job_not_found" });
  if (!job.events?.startedAt)
    return res.status(400).json({ error: "event_not_started" });

  const sLat = Number(scannerLat),
    sLng = Number(scannerLng);
  if (!isValidCoord(payload.lat, payload.lng))
    return res.status(400).json({ error: "token_missing_location" });
  if (!isValidCoord(sLat, sLng))
    return res.status(400).json({ error: "scanner_location_required" });

  const dist = haversineMeters(payload.lat, payload.lng, sLat, sLng);
  if (dist > MAX_DISTANCE_METERS) {
    addAudit(
      "scan_rejected_distance",
      { jobId: job.id, userId: payload.u, dist },
      req
    );
    return res.status(400).json({
      error: "too_far",
      distanceMeters: Math.round(dist),
      maxDistanceMeters: MAX_DISTANCE_METERS,
    });
  }

  job.attendance = job.attendance || {};
  const now = dayjs();
  job.attendance[payload.u] = job.attendance[payload.u] || {
    in: null,
    out: null,
    lateMinutes: 0,
  };
  if (payload.dir === "in") {
    job.attendance[payload.u].in = now.toISOString();
    job.attendance[payload.u].lateMinutes = Math.max(
      0,
      now.diff(dayjs(job.startTime), "minute")
    );
  } else {
    job.attendance[payload.u].out = now.toISOString();
  }
  await saveDB(db);
  exportJobCSV(job);
  addAudit(
    "scan_" + payload.dir,
    {
      jobId: job.id,
      userId: payload.u,
      distanceMeters: Math.round(dist),
    },
    req
  );
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
app.get(
  "/jobs/:id/csv",
  authMiddleware,
  requireRole("admin"),
  (req, res) => {
    const job = db.jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: "job_not_found" });
    const { headers, rows } = generateJobCSV(job);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="job-${job.id}.csv"`
    );
    res.write(headers.join(",") + "\n");
    for (const r of rows) {
      const line = headers
        .map((h) =>
          r[h] !== undefined ? String(r[h]).replace(/"/g, '""') : ""
        )
        .join(",");
      res.write(line + "\n");
    }
    res.end();
  }
);

/* ---- audit & misc ---- */
app.get(
  "/admin/audit",
  authMiddleware,
  requireRole("admin"),
  (req, res) => {
    const limit = Number(req.query.limit || 200);
    res.json((db.audit || []).slice(0, limit));
  }
);

app.post("/__reset", async (req, res) => {
  // Reload from storage (PG/file) — does not clear PG content
  db = await loadDB();
  res.json({ ok: true });
});
app.get("/health", (_req, res) => res.json({ ok: true }));

/* ---- scanner location heartbeat/endpoints ---- */
function setScannerLocation(job, lat, lng) {
  job.events = job.events || {};
  job.events.scanner = { lat, lng, updatedAt: dayjs().toISOString() };
}
app.post(
  "/jobs/:id/scanner/heartbeat",
  authMiddleware,
  requireRole("pm", "admin"),
  async (req, res) => {
    const job = db.jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: "job_not_found" });
    if (!job.events?.startedAt)
      return res.status(400).json({ error: "event_not_started" });
    const { lat, lng } = req.body || {};
    const latN = Number(lat),
      lngN = Number(lng);
    if (!isValidCoord(latN, lngN))
      return res.status(400).json({ error: "scanner_location_required" });
    setScannerLocation(job, latN, lngN);
    await saveDB(db);
    addAudit(
      "scanner_heartbeat",
      { jobId: job.id, lat: latN, lng: lngN },
      req
    );
    res.json({ ok: true, updatedAt: job.events.scanner.updatedAt });
  }
);
app.get("/jobs/:id/scanner", authMiddleware, (req, res) => {
  const job = db.jobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "job_not_found" });
  if (!job.events?.startedAt)
    return res.status(400).json({ error: "event_not_started" });
  const s = job.events?.scanner;
  if (!s) return res.status(404).json({ error: "scanner_unknown" });
  res.json({ lat: s.lat, lng: s.lng, updatedAt: s.updatedAt });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log("ATAG server running on http://localhost:" + PORT)
);

console.log("Booting server from:", new URL(import.meta.url).pathname);

function listRoutes(app) {
  const out = [];
  app._router?.stack?.forEach((m) => {
    if (m.route?.path) {
      const methods = Object.keys(m.route.methods).map(s=>s.toUpperCase());
      out.push(`${methods.join(",")} ${m.route.path}`);
    }
  });
  return out.sort();
}

app.get("/__routes", (_req, res) => {
  res.json({ routes: listRoutes(app) });
});

setTimeout(() => {
  console.log("Registered routes:\n" + listRoutes(app).join("\n"));
}, 100);
