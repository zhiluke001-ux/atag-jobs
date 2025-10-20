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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

/* ---------------- DB + defaults ---------------- */
const DB_FILE = path.join(__dirname, "db.json");
let db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));

function saveDB() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

// Seed config & defaults if missing
db.config = db.config || {};
db.config.jwtSecret = db.config.jwtSecret || "dev-secret";
db.config.scanMaxDistanceMeters = db.config.scanMaxDistanceMeters || 500;

// Default ATAG compensation structure (editable in Admin page)
const DEFAULT_RATES = {
  // Virtual (RM/hour)
  virtualHourly: { junior: 20, senior: 20, lead: 30 },
  // Physical session (per session)
  physicalSession: {
    halfDay:  { junior: 80,  senior: 100, lead: 44 },
    fullDay:  { junior: 150, senior: 180, lead: 88 },
    twoD1N:   { junior: 230, senior: 270, lead: null },
    threeD2N: { junior: 300, senior: 350, lead: null },
  },
  // Physical optional hourly (RM/hour)
  physicalHourly: { junior: 20, senior: 30, lead: 30 },
  // Allowances
  loadingUnloading: { amount: 30 },      // per helper
  earlyCall: { defaultAmount: 20 },      // mostly for >3h travel/very early calls
};
db.config.rates = db.config.rates || DEFAULT_RATES;
saveDB();

/* ------------ auth / helpers ------------- */
const JWT_SECRET = db.config.jwtSecret;
const MAX_DISTANCE_METERS =
  Number(process.env.SCAN_MAX_DISTANCE_METERS || db.config.scanMaxDistanceMeters || 500);

const toRad = (deg) => (deg * Math.PI) / 180;
function isValidCoord(lat, lng) {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 &&
    lng >= -180 && lng <= 180
  );
}
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}

const signToken = (payload) => jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

function authMiddleware(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "no_token" });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: "invalid_token" }); }
}
const requireRole = (...roles) => (req,res,next)=>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error:"forbidden" });

function addAudit(action, details, req) {
  db.audit = db.audit || [];
  db.audit.unshift({
    id: "a" + Math.random().toString(36).slice(2,8),
    time: dayjs().toISOString(),
    actor: req?.user?.email || "guest",
    role: req?.user?.role || "guest",
    action, details,
  });
  if (db.audit.length > 1000) db.audit.length = 1000;
  saveDB();
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

// Public job view now includes transport options + L&U snapshot
// --- server.js ---

function paySummaryFromRate(rate = {}) {
  const pm  = rate.payMode;
  const hr  = Number(rate.base ?? rate.hourlyBase);
  const fix = Number(rate.specificPayment ?? rate.specificAmount);
  const otm = Number(rate.otMultiplier || 0);
  const otTag = otm > 0 ? ` (OT x${otm})` : "";

  if (pm === "specific" && Number.isFinite(fix)) return `RM ${Math.round(fix)} / shift`;
  if (pm === "specific_plus_hourly" && Number.isFinite(fix) && Number.isFinite(hr))
    return `RM ${Math.round(fix)} + RM ${Math.round(hr)}/hr${otTag}`;
  if ((pm === "hourly" || pm == null) && Number.isFinite(hr))
    return `RM ${Math.round(hr)}/hr${otTag}`;

  // fallbacks for legacy rate blocks
  const legacyHr = rate?.physicalHourly?.junior ?? rate?.virtualHourly?.junior;
  if (Number.isFinite(legacyHr)) return `From RM ${Math.round(legacyHr)}/hr`;
  return "See details";
}

// Public job view now includes applied/approved counts AND a concise pay string
function jobPublicView(job) {
  const { id, title, venue, description, startTime, endTime, headcount, transportOptions } = job;
  const lu = job.loadingUnload || { quota: 0, applicants: [], participants: [] };

  const appliedCount  = Array.isArray(job.applications) ? job.applications.length : 0;
  const approvedCount = Array.isArray(job.approved)     ? job.approved.length     : 0;

  return {
    id, title, venue, description, startTime, endTime, headcount,
    status: computeStatus(job),
    transportOptions: transportOptions || { bus: true, own: true },
    loadingUnload: { quota: lu.quota || 0, applicants: lu.applicants?.length || 0 },

    // used by the cards
    appliedCount,
    approvedCount,
    paySummary: paySummaryFromRate(job.rate || {}),
  };
}



/* ------------ CSV helpers ------------- */
function generateJobCSV(job) {
  const rows = [];

  for (const u of job.applications) {
    const luApplied = !!(job.loadingUnload?.applicants || []).includes(u.userId);
    const luConfirmed = !!(job.loadingUnload?.participants || []).includes(u.userId);
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
      luApplied,
      luConfirmed,
    });
  }

  for (const [userId, rec] of Object.entries(job.attendance || {})) {
    const app = job.applications.find((a) => a.userId === userId);
    const luApplied = !!(job.loadingUnload?.applicants || []).includes(userId);
    const luConfirmed = !!(job.loadingUnload?.participants || []).includes(userId);
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
      luApplied,
      luConfirmed,
    });
  }

  const headers = [
    "section","userId","email","transport","status","in","out","lateMinutes","luApplied","luConfirmed",
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

/* -------------- auth --------------- */
app.post("/login", (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email_required" });
  const user = db.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user)
    return res.status(401).json({
      error: "unknown_user",
      hint: "Use alice@example.com, pm@example.com, or admin@example.com",
    });
  const token = signToken({ id:user.id, email:user.email, role:user.role, name:user.name });
  addAudit("login", { email:user.email }, { user });
  res.json({ token, user:{ id:user.id, email:user.email, role:user.role, name:user.name } });
});

app.get("/me", authMiddleware, (req,res)=>{
  const user = db.users.find((u)=>u.id===req.user.id);
  res.json({ user:{ id:user.id, email:user.email, role:user.role, name:user.name } });
});

/* -------- Rates defaults (Admin) -------- */
app.get("/config/rates", authMiddleware, requireRole("admin"), (req,res)=>{
  res.json(db.config.rates || DEFAULT_RATES);
});
app.post("/config/rates", authMiddleware, requireRole("admin"), (req,res)=>{
  const body = req.body || {};
  db.config.rates = Object.keys(body).length ? body : db.config.rates;
  saveDB();
  addAudit("update_rates_default", { rates: db.config.rates }, req);
  res.json({ ok:true, rates: db.config.rates });
});

/* -------------- jobs --------------- */
app.get("/jobs", (req,res)=>{
  const jobs = db.jobs
    .map((j)=>jobPublicView(j))
    .sort((a,b)=>dayjs(a.startTime) - dayjs(b.startTime));
  res.json(req.query.limit ? jobs.slice(0, Number(req.query.limit)) : jobs);
});

app.get("/jobs/:id", (req,res)=>{
  const job = db.jobs.find((j)=>j.id===req.params.id);
  if (!job) return res.status(404).json({ error:"job_not_found" });
  res.json({ ...job, status: computeStatus(job) });
});

/* ---- create job (with Early-Call + optional L&U) ---- */
app.post("/jobs", authMiddleware, requireRole("pm","admin"), (req,res)=>{
  const {
    title, venue, description, startTime, endTime, headcount,
    transportOptions, rate, earlyCall, loadingUnload, ldu
  } = req.body || {};
  if (!title || !venue || !startTime || !endTime)
    return res.status(400).json({ error:"missing_fields" });

  const id = "j" + Math.random().toString(36).slice(2,8);

  // prefer "ldu" if present, else "loadingUnload"
  const lduBody = ldu || loadingUnload || {};

  const job = {
    id, title, venue,
    description: description || "",
    startTime, endTime,
    status: "upcoming",
    headcount: Number(headcount || 5),
    transportOptions: transportOptions || { bus:true, own:true },

    // Seed job with current defaults; allow per-job partial override
    rate: rate ? { ...db.config.rates, ...rate } : JSON.parse(JSON.stringify(db.config.rates)),

    // Early Call (toggle + amount + threshold)
    earlyCall: {
      enabled: !!(earlyCall?.enabled),
      amount: Number(earlyCall?.amount ?? db.config.rates.earlyCall.defaultAmount ?? 20),
      thresholdHours: Number(earlyCall?.thresholdHours ?? 3),
    },

    // Loading & Unloading (optional)
    loadingUnload: {
      enabled: !!lduBody.enabled,                                   // <— NEW toggle
      quota: Number(lduBody.quota ?? 0),
      price: Number(lduBody.price ?? db.config.rates.loadingUnloading.amount),
      applicants: [],
      participants: []
    },

    applications: [],
    approved: [],
    rejected: [],
    attendance: {},
    events: { startedAt:null, endedAt:null, scanner:null },
  };

  db.jobs.push(job);
  saveDB();
  addAudit("create_job", { jobId:id, title }, req);
  res.json(job);
});

/* ---- edit job ---- */
app.patch("/jobs/:id", authMiddleware, requireRole("pm","admin"), (req,res)=>{
  const job = db.jobs.find((j)=>j.id===req.params.id);
  if (!job) return res.status(404).json({ error:"job_not_found" });

  const {
    title, venue, description, startTime, endTime, headcount,
    rate, transportOptions, earlyCall, loadingUnload, ldu
  } = req.body || {};

  if (title !== undefined) job.title = title;
  if (venue !== undefined) job.venue = venue;
  if (description !== undefined) job.description = description;
  if (startTime !== undefined) job.startTime = startTime;
  if (endTime !== undefined) job.endTime = endTime;
  if (headcount !== undefined) job.headcount = Number(headcount);
  if (transportOptions) job.transportOptions = { bus: !!transportOptions.bus, own: !!transportOptions.own };

  if (rate && typeof rate === "object") {
    job.rate = { ...job.rate, ...rate };
  }

  if (earlyCall) {
    job.earlyCall = {
      enabled: !!earlyCall.enabled,
      amount: Number(earlyCall.amount ?? job.earlyCall?.amount ?? db.config.rates.earlyCall.defaultAmount ?? 20),
      thresholdHours: Number(earlyCall.thresholdHours ?? job.earlyCall?.thresholdHours ?? 3),
    };
  }

  // accept either { ldu: {...} } or { loadingUnload: {...} }
  const lduBody = ldu || loadingUnload;
  if (lduBody) {
    job.loadingUnload = {
      enabled: lduBody.enabled !== undefined ? !!lduBody.enabled : !!job.loadingUnload?.enabled,
      quota: Number(lduBody.quota ?? job.loadingUnload?.quota ?? 0),
      price: Number(lduBody.price ?? job.loadingUnload?.price ?? db.config.rates.loadingUnloading.amount),
      applicants: Array.isArray(job.loadingUnload?.applicants) ? job.loadingUnload.applicants : [],
      participants: Array.isArray(job.loadingUnload?.participants) ? job.loadingUnload.participants : []
    };
  }

  saveDB();
  addAudit("edit_job", { jobId: job.id }, req);
  res.json(job);
});

/* ---- NEW: persist per-job rate knobs from Admin Wages ---- */
app.post("/jobs/:id/rate", authMiddleware, requireRole("pm","admin"), (req,res)=>{
  const job = db.jobs.find((j)=>j.id===req.params.id);
  if (!job) return res.status(404).json({ error:"job_not_found" });

  const {
    base, transportBus, ownTransport, // legacy/compat
    payMode, specificPayment, paymentPrice,
    lduPrice, lduEnabled,
    earlyCallAmount, earlyCallThresholdHours
  } = req.body || {};

  job.rate = job.rate || {};
  if (base !== undefined) job.rate.base = Number(base);
  if (transportBus !== undefined) job.rate.transportBus = Number(transportBus);
  if (ownTransport !== undefined) job.rate.ownTransport = Number(ownTransport);
  if (payMode !== undefined) job.rate.payMode = String(payMode);
  if (specificPayment !== undefined) job.rate.specificPayment = Number(specificPayment);
  if (paymentPrice !== undefined) job.rate.specificPayment = Number(paymentPrice); // alias
  if (lduPrice !== undefined) job.rate.lduPrice = Number(lduPrice);

  // mirror toggles to job blocks
  job.loadingUnload = job.loadingUnload || { enabled:false, quota:0, price: Number(db.config.rates.loadingUnloading.amount), applicants:[], participants:[] };
  if (lduEnabled !== undefined) job.loadingUnload.enabled = !!lduEnabled;
  if (lduPrice !== undefined) job.loadingUnload.price = Number(lduPrice);

  job.earlyCall = job.earlyCall || { enabled:false, amount: Number(db.config.rates.earlyCall.defaultAmount), thresholdHours: 3 };
  if (earlyCallAmount !== undefined) job.earlyCall.amount = Number(earlyCallAmount);
  if (earlyCallThresholdHours !== undefined) job.earlyCall.thresholdHours = Number(earlyCallThresholdHours);

  saveDB();
  addAudit("update_job_rate", { jobId: job.id }, req);
  res.json({ ok:true, rate: job.rate, earlyCall: job.earlyCall, loadingUnload: job.loadingUnload });
});

/* ---- delete job ---- */
app.delete("/jobs/:id", authMiddleware, requireRole("pm","admin"), (req,res)=>{
  const idx = db.jobs.findIndex((j)=>j.id===req.params.id);
  if (idx === -1) return res.status(404).json({ error:"job_not_found" });
  const removed = db.jobs.splice(idx,1)[0];
  saveDB();
  addAudit("delete_job", { jobId: removed.id }, req);
  res.json({ ok:true });
});

/* ---- apply (transport + optional L&U) ---- */
app.post("/jobs/:id/apply", authMiddleware, requireRole("part-timer"), (req,res)=>{
  const job = db.jobs.find((j)=>j.id===req.params.id);
  if (!job) return res.status(404).json({ error:"job_not_found" });

  const { transport, wantsLU } = req.body || {};
  if (!["ATAG Bus","Own Transport"].includes(transport))
    return res.status(400).json({ error:"invalid_transport" });

  const opts = job.transportOptions || { bus:true, own:true };
  if ((transport==="ATAG Bus" && !opts.bus) || (transport==="Own Transport" && !opts.own))
    return res.status(400).json({ error:"transport_not_allowed" });

  // L&U may be disabled entirely
  const lu = job.loadingUnload || { enabled:false, quota:0, applicants:[], participants:[] };
  const luEnabled = lu.enabled ?? (lu.quota > 0);

  let exists = job.applications.find((a)=>a.userId===req.user.id);
  if (exists) {
    const wasRejected = job.rejected.includes(req.user.id);
    if (wasRejected) {
      exists.transport = transport;
      exists.appliedAt = dayjs().toISOString();
      job.rejected = job.rejected.filter((u)=>u!==req.user.id);
      job.approved = job.approved.filter((u)=>u!==req.user.id);
      if (wantsLU === true) {
        if (!luEnabled) return res.status(400).json({ error:"lu_disabled" });
        job.loadingUnload = lu;
        const a = job.loadingUnload.applicants;
        if (job.loadingUnload.quota > 0) {
          if (a.length >= job.loadingUnload.quota) return res.status(400).json({ error:"lu_quota_full" });
          if (!a.includes(req.user.id)) a.push(req.user.id);
        }
      } else if (wantsLU === false && job.loadingUnload?.applicants) {
        job.loadingUnload.applicants = job.loadingUnload.applicants.filter((u)=>u!==req.user.id);
      }
      saveDB(); exportJobCSV(job);
      addAudit("reapply", { jobId: job.id, userId: req.user.id, transport, wantsLU: !!wantsLU }, req);
      return res.json({ ok:true, reapply:true });
    }
    // already applied; allow toggling L&U if provided
    if (wantsLU === true) {
      if (!luEnabled) return res.status(400).json({ error:"lu_disabled" });
      job.loadingUnload = lu;
      const a = job.loadingUnload.applicants;
      if (job.loadingUnload.quota > 0) {
        if (a.length >= job.loadingUnload.quota && !a.includes(req.user.id)) return res.status(400).json({ error:"lu_quota_full" });
        if (!a.includes(req.user.id)) a.push(req.user.id);
      }
      saveDB(); exportJobCSV(job);
      return res.json({ ok:true, updated:true });
    }
    if (wantsLU === false && job.loadingUnload?.applicants) {
      job.loadingUnload.applicants = job.loadingUnload.applicants.filter((u)=>u!==req.user.id);
      saveDB(); exportJobCSV(job);
      return res.json({ ok:true, updated:true });
    }
    return res.json({ message:"already_applied" });
  }

  job.applications.push({
    userId: req.user.id,
    email: req.user.email,
    transport,
    appliedAt: dayjs().toISOString(),
  });

  // L&U opt-in on first apply
  if (wantsLU === true) {
    if (!luEnabled) return res.status(400).json({ error:"lu_disabled" });
    job.loadingUnload = lu;
    const a = job.loadingUnload.applicants;
    if (job.loadingUnload.quota > 0) {
      if (a.length >= job.loadingUnload.quota) return res.status(400).json({ error:"lu_quota_full" });
      if (!a.includes(req.user.id)) a.push(req.user.id);
    }
  }

  saveDB(); exportJobCSV(job);
  addAudit("apply", { jobId: job.id, userId: req.user.id, transport, wantsLU: !!wantsLU }, req);
  res.json({ ok:true });
});

/* ---- part-timer "my jobs" ---- */
app.get("/me/jobs", authMiddleware, requireRole("part-timer"), (req,res)=>{
  const result = [];
  for (const j of db.jobs) {
    const applied = j.applications.find((a)=>a.userId===req.user.id);
    if (applied) {
      const state = j.approved.includes(req.user.id) ? "approved"
                  : j.rejected.includes(req.user.id) ? "rejected" : "applied";
      result.push({
        id: j.id, title: j.title, venue: j.venue,
        startTime: j.startTime, endTime: j.endTime,
        status: computeStatus(j), myStatus: state
      });
    }
  }
  result.sort((a,b)=>dayjs(a.startTime)-dayjs(b.startTime));
  res.json(result);
});

/* ---- PM: applicants list + approve ---- */
app.get("/jobs/:id/applicants", authMiddleware, requireRole("pm","admin"), (req,res)=>{
  const job = db.jobs.find((j)=>j.id===req.params.id);
  if (!job) return res.status(404).json({ error:"job_not_found" });
  const list = job.applications.map(a=>{
    let state = "applied";
    if (job.approved.includes(a.userId)) state = "approved";
    if (job.rejected.includes(a.userId)) state = "rejected";
    const luApplied = !!(job.loadingUnload?.applicants || []).includes(a.userId);
    const luConfirmed = !!(job.loadingUnload?.participants || []).includes(a.userId);
    return { ...a, status: state, userId: a.userId, luApplied, luConfirmed };
  });
  res.json(list);
});
app.post("/jobs/:id/approve", authMiddleware, requireRole("pm","admin"), (req,res)=>{
  const job = db.jobs.find((j)=>j.id===req.params.id);
  if (!job) return res.status(404).json({ error:"job_not_found" });
  const { userId, approve } = req.body || {};
  if (!userId || typeof approve !== "boolean") return res.status(400).json({ error:"bad_request" });
  const applied = job.applications.find((a)=>a.userId===userId);
  if (!applied) return res.status(400).json({ error:"user_not_applied" });
  job.approved = job.approved.filter((u)=>u!==userId);
  job.rejected = job.rejected.filter((u)=>u!==userId);
  if (approve) job.approved.push(userId); else job.rejected.push(userId);
  saveDB(); exportJobCSV(job);
  addAudit(approve?"approve":"reject", { jobId: job.id, userId }, req);
  res.json({ ok:true });
});

/* ---- PM: L&U manage ---- */
app.get("/jobs/:id/loading", authMiddleware, requireRole("pm","admin"), (req,res)=>{
  const job = db.jobs.find((j)=>j.id===req.params.id);
  if (!job) return res.status(404).json({ error:"job_not_found" });
  const l = job.loadingUnload || { enabled:false, price: db.config.rates.loadingUnloading.amount, quota:0, applicants:[], participants:[] };
  const details = (ids)=>ids.map(uid=>{
    const u = db.users.find(x=>x.id===uid) || { email:"unknown", id:uid };
    return { userId:uid, email:u.email };
  });
  res.json({
    enabled: !!l.enabled,
    price: Number(l.price || 0),
    quota: l.quota||0,
    applicants:details(l.applicants||[]),
    participants:details(l.participants||[])
  });
});
app.post("/jobs/:id/loading/mark", authMiddleware, requireRole("pm","admin"), (req,res)=>{
  const job = db.jobs.find((j)=>j.id===req.params.id);
  if (!job) return res.status(404).json({ error:"job_not_found" });
  const { userId, present } = req.body || {};
  if (!userId || typeof present !== "boolean") return res.status(400).json({ error:"bad_request" });
  job.loadingUnload = job.loadingUnload || { enabled:false, quota:0, price: db.config.rates.loadingUnloading.amount, applicants:[], participants:[] };
  const p = new Set(job.loadingUnload.participants || []);
  if (present) p.add(userId); else p.delete(userId);
  job.loadingUnload.participants = [...p];
  saveDB(); exportJobCSV(job);
  addAudit("lu_mark",{ jobId: job.id, userId, present }, req);
  res.json({ ok:true, participants: job.loadingUnload.participants });
});

/* ---- Start / End / Reset ---- */
app.post("/jobs/:id/start", authMiddleware, requireRole("pm","admin"), (req,res)=>{
  const job = db.jobs.find((j)=>j.id===req.params.id);
  if (!job) return res.status(404).json({ error:"job_not_found" });
  job.events = job.events || {};
  if (job.events.startedAt) return res.json({ message:"already_started", startedAt: job.events.startedAt });
  job.events.startedAt = dayjs().toISOString();
  saveDB();
  addAudit("start_event", { jobId: job.id }, req);
  res.json({ ok:true, startedAt: job.events.startedAt });
});

app.post("/jobs/:id/end", authMiddleware, requireRole("pm","admin"), (req,res)=>{
  const job = db.jobs.find((j)=>j.id===req.params.id);
  if (!job) return res.status(404).json({ error:"job_not_found" });
  job.events = job.events || {};
  job.events.endedAt = dayjs().toISOString();
  saveDB(); exportJobCSV(job);
  addAudit("end_event", { jobId: job.id }, req);
  res.json({ ok:true, endedAt: job.events.endedAt });
});

function handleReset(req,res){
  const job = db.jobs.find((j)=>j.id===req.params.id);
  if (!job) return res.status(404).json({ error:"job_not_found" });
  const keepAttendance = !!req.body?.keepAttendance;
  job.events = { startedAt:null, endedAt:null, scanner:null };
  if (!keepAttendance) job.attendance = {}; else job.attendance = job.attendance || {};
  saveDB(); exportJobCSV(job);
  addAudit("reset_event", { jobId: job.id, keepAttendance }, req);
  const status = computeStatus(job);
  res.json({ ok:true, job: { ...job, status } });
}
app.post("/jobs/:id/reset", authMiddleware, requireRole("pm","admin"), handleReset);
app.patch("/jobs/:id/reset", authMiddleware, requireRole("pm","admin"), handleReset);

/* ---- QR + scan (location bound) ---- */
app.post("/jobs/:id/qr", authMiddleware, requireRole("part-timer"), (req,res)=>{
  const job = db.jobs.find((j)=>j.id===req.params.id);
  if (!job) return res.status(404).json({ error:"job_not_found" });

  const state = job.approved.includes(req.user.id) ? "approved"
               : job.rejected.includes(req.user.id) ? "rejected" : "applied";
  if (state !== "approved") return res.status(400).json({ error:"not_approved" });
  if (!job.events?.startedAt) return res.status(400).json({ error:"event_not_started" });

  const { direction, lat, lng } = req.body || {};
  const latN = Number(lat), lngN = Number(lng);
  if (!["in","out"].includes(direction)) return res.status(400).json({ error:"bad_direction" });
  if (!isValidCoord(latN, lngN)) return res.status(400).json({ error:"location_required" });

  const encLat = Math.round(latN*1e5)/1e5;
  const encLng = Math.round(lngN*1e5)/1e5;

  const payload = {
    typ:"scan", j:job.id, u:req.user.id, dir:direction,
    lat: encLat, lng: encLng, iat: Math.floor(Date.now()/1000), nonce: uuidv4()
  };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn:"60s" });
  addAudit("gen_qr", { jobId: job.id, dir: direction, userId: req.user.id, lat: encLat, lng: encLng }, req);
  res.json({ token, maxDistanceMeters: MAX_DISTANCE_METERS });
});

app.post("/scan", authMiddleware, requireRole("pm","admin"), (req,res)=>{
  const { token, scannerLat, scannerLng } = req.body || {};
  if (!token) return res.status(400).json({ error:"missing_token" });

  let payload;
  try { payload = jwt.verify(token, JWT_SECRET); }
  catch { addAudit("scan_error",{ reason:"jwt_error" }, req); return res.status(400).json({ error:"jwt_error" }); }
  if (payload.typ !== "scan") return res.status(400).json({ error:"bad_token_type" });

  const job = db.jobs.find((j)=>j.id===payload.j);
  if (!job) return res.status(404).json({ error:"job_not_found" });
  if (!job.events?.startedAt) return res.status(400).json({ error:"event_not_started" });

  const sLat = Number(scannerLat), sLng = Number(scannerLng);
  if (!isValidCoord(payload.lat, payload.lng)) return res.status(400).json({ error:"token_missing_location" });
  if (!isValidCoord(sLat, sLng)) return res.status(400).json({ error:"scanner_location_required" });

  const dist = haversineMeters(payload.lat, payload.lng, sLat, sLng);
  if (dist > MAX_DISTANCE_METERS) {
    addAudit("scan_rejected_distance",{ jobId: job.id, userId: payload.u, dist }, req);
    return res.status(400).json({ error:"too_far", distanceMeters: Math.round(dist), maxDistanceMeters: MAX_DISTANCE_METERS });
  }

  job.attendance = job.attendance || {};
  const now = dayjs();
  job.attendance[payload.u] = job.attendance[payload.u] || { in:null, out:null, lateMinutes:0 };
  if (payload.dir === "in") {
    job.attendance[payload.u].in = now.toISOString();
    job.attendance[payload.u].lateMinutes = Math.max(0, now.diff(dayjs(job.startTime), "minute"));
  } else {
    job.attendance[payload.u].out = now.toISOString();
  }
  saveDB(); exportJobCSV(job);
  addAudit("scan_"+payload.dir, { jobId: job.id, userId: payload.u, distanceMeters: Math.round(dist) }, req);
  res.json({ ok:true, jobId: job.id, userId: payload.u, direction: payload.dir, time: now.toISOString(), record: job.attendance[payload.u] });
});

/* ---- CSV download ---- */
app.get("/jobs/:id/csv", authMiddleware, requireRole("admin"), (req,res)=>{
  const job = db.jobs.find((j)=>j.id===req.params.id);
  if (!job) return res.status(404).json({ error:"job_not_found" });
  const { headers, rows } = generateJobCSV(job);
  res.setHeader("Content-Type","text/csv");
  res.setHeader("Content-Disposition",`attachment; filename="job-${job.id}.csv"`);
  res.write(headers.join(",")+"\n");
  for (const r of rows) {
    const line = headers.map(h => (r[h] !== undefined ? String(r[h]).replace(/"/g,'""') : "")).join(",");
    res.write(line + "\n");
  }
  res.end();
});

/* ---- audit & misc ---- */
app.get("/admin/audit", authMiddleware, requireRole("admin"), (req,res)=>{
  const limit = Number(req.query.limit || 200);
  res.json((db.audit || []).slice(0, limit));
});

app.post("/__reset", (req,res)=>{ db = JSON.parse(fs.readFileSync(DB_FILE, "utf-8")); res.json({ ok:true }); });
app.get("/health", (_req,res)=>res.json({ ok:true }));

/* ---- scanner location heartbeat/endpoints ---- */
function setScannerLocation(job, lat, lng) {
  job.events = job.events || {};
  job.events.scanner = { lat, lng, updatedAt: dayjs().toISOString() };
}
app.post("/jobs/:id/scanner/heartbeat", authMiddleware, requireRole("pm","admin"), (req,res)=>{
  const job = db.jobs.find(j=>j.id===req.params.id);
  if (!job) return res.status(404).json({ error:"job_not_found" });
  if (!job.events?.startedAt) return res.status(400).json({ error:"event_not_started" });
  const { lat, lng } = req.body || {};
  const latN = Number(lat), lngN = Number(lng);
  if (!isValidCoord(latN, lngN)) return res.status(400).json({ error:"scanner_location_required" });
  setScannerLocation(job, latN, lngN);
  saveDB(); addAudit("scanner_heartbeat",{ jobId:job.id, lat:latN, lng:lngN }, req);
  res.json({ ok:true, updatedAt: job.events.scanner.updatedAt });
});
app.get("/jobs/:id/scanner", authMiddleware, (req,res)=>{
  const job = db.jobs.find(j=>j.id===req.params.id);
  if (!job) return res.status(404).json({ error:"job_not_found" });
  if (!job.events?.startedAt) return res.status(400).json({ error:"event_not_started" });
  const s = job.events?.scanner;
  if (!s) return res.status(404).json({ error:"scanner_unknown" });
  res.json({ lat:s.lat, lng:s.lng, updatedAt:s.updatedAt });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log("ATAG server running on http://localhost:" + PORT));
