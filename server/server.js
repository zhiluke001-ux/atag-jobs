import express from "express";
import cors from "cors";
import morgan from "morgan";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import webpush from "web-push";
import { google } from "googleapis";
import { pool, withTransaction, healthCheck } from "./db.js";
import { asyncHandler, HttpError, postgresErrorResponse } from "./lib/errors.js";
import { hashPassword, verifyPassword, sha256, randomId, stableRequestHash } from "./lib/security.js";
import { BUSINESS_TIME_ZONE, parseDeadlineInput, isApplicationClosed } from "./lib/time.js";
import { DEFAULT_RATES, defaultRoleRates, getAppConfig, setConfigValue } from "./lib/config.js";
import {
  ROLES, STAFF_ROLES, clampRole, clampGrade, findUserByIdentifier, getUserById, listUsers,
  listJobsPublic, getJobFull, computeStatus, addAudit, insertNotifications, getPushSubscriptions,
  listAdminIds, replaceAdjustments,
} from "./repository.js";
import {
  uploadImageDataUrl, removeStoredFile, createSignedUrl, downloadStoredFile, fileApiPath, makeStorageRef,
} from "./storage.js";

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === "dev-secret") {
  if (process.env.NODE_ENV === "production") throw new Error("JWT_SECRET must be set to a strong non-default value in production.");
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET || "development-only-change-me";

const CORS_ORIGINS = String(process.env.CORS_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin || !CORS_ORIGINS.length || CORS_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error("Origin not allowed by CORS"));
  },
  exposedHeaders: ["Idempotency-Replayed"],
}));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "12mb" }));
app.use(morgan("dev"));

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.warn("[push] VAPID keys not configured; web push delivery is disabled.");
}

function signUserToken(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name, grade: user.grade || "junior" }, EFFECTIVE_JWT_SECRET, { expiresIn: "7d" });
}

function readBearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

function authMiddleware(req, res, next) {
  const token = readBearer(req);
  if (!token) return res.status(401).json({ error: "no_token" });
  try { req.user = jwt.verify(token, EFFECTIVE_JWT_SECRET); return next(); }
  catch { return res.status(401).json({ error: "invalid_token" }); }
}

function optionalAuthMiddleware(req, _res, next) {
  const token = readBearer(req);
  if (token) {
    try { req.user = jwt.verify(token, EFFECTIVE_JWT_SECRET); } catch {}
  }
  next();
}

const requireRole = (...roles) => (req, res, next) => roles.includes(req.user?.role) ? next() : res.status(403).json({ error: "forbidden" });

function isValidCoord(lat, lng) {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = deg => deg * Math.PI / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function toNumber(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function iso(v) { return v ? new Date(v).toISOString() : null; }

async function serializeUser(user, { privatePhoto = false } = {}) {
  if (!user) return null;
  const avatarUrl = user.avatarUrl ? fileApiPath(user.avatarUrl) : "";
  const verificationPhotoUrl = user.verificationPhotoUrl ? fileApiPath(user.verificationPhotoUrl) : "";
  const verificationPhotoUrlAbs = privatePhoto && user.verificationPhotoUrl ? await createSignedUrl(user.verificationPhotoUrl, 300) : verificationPhotoUrl;
  return {
    id: user.id, email: user.email, username: user.username || "", name: user.name || "", role: user.role,
    grade: user.grade || "junior", phone: user.phone || "", discord: user.discord || "",
    avatarUrl, avatarUrlAbs: user.avatarUrl ? await createSignedUrl(user.avatarUrl, 3600) : "",
    verified: !!user.verified,
    verificationStatus: user.verificationStatus || (user.verified ? "APPROVED" : "PENDING"),
    verificationPhotoUrl, verificationPhotoUrlAbs,
    verifiedAt: user.verifiedAt || null, verifiedBy: user.verifiedBy || null,
  };
}

function stripPrivateJob(job, user) {
  if (!job) return job;
  if (user && (user.role === "pm" || user.role === "admin")) return job;
  const safe = { ...job };
  delete safe.applications;
  delete safe.approved;
  delete safe.rejected;
  delete safe.attendance;
  delete safe.adjustments;
  delete safe.fullTimers;
  delete safe.parkingReceipts;
  if (safe.loadingUnload) safe.loadingUnload = { ...safe.loadingUnload, applicants: safe.loadingUnload.applicants?.length || 0, participants: safe.loadingUnload.participants?.length || 0 };
  if (safe.earlyCall) safe.earlyCall = { ...safe.earlyCall, applicants: undefined, participants: undefined };
  return safe;
}

function knownJobKeys() {
  return new Set(["title","venue","description","startTime","endTime","headcount","transportOptions","rate","earlyCall","loadingUnload","ldu","roleCounts","roleRates","applyDueDate","applicationDeadline","session","breakEnabled","adjustments"]);
}
function extraFromPayload(payload) {
  const known = knownJobKeys();
  return Object.fromEntries(Object.entries(payload || {}).filter(([k]) => !known.has(k)));
}
function normalizeTransportOptions(v) {
  if (!v || typeof v !== "object") return { bus: true, own: true };
  const bus = v.bus ?? v.atagTransport ?? true;
  const own = v.own ?? v.ownTransport ?? true;
  return { ...v, bus: !!bus, own: !!own, atagTransport: !!bus, ownTransport: !!own };
}
function parseApplicationDeadline(body) {
  const raw = body?.applicationDeadline !== undefined ? body.applicationDeadline : body?.applyDueDate;
  const parsed = parseDeadlineInput(raw);
  if (parsed === undefined) throw new HttpError(400, "invalid_application_deadline");
  return parsed;
}

async function sendResetEmail(to, link) {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER, RESEND_API_KEY } = process.env;
  if (GMAIL_CLIENT_ID && GMAIL_CLIENT_SECRET && GMAIL_REFRESH_TOKEN && GMAIL_SENDER) {
    try {
      const oauth = new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, "urn:ietf:wg:oauth:2.0:oob");
      oauth.setCredentials({ refresh_token: GMAIL_REFRESH_TOKEN });
      const gmail = google.gmail({ version: "v1", auth: oauth });
      const raw = Buffer.from([
        `From: ${GMAIL_SENDER}`, `To: ${to}`, "Subject: Reset your ATAG Jobs password", 'Content-Type: text/plain; charset="UTF-8"', "",
        `Click this link to reset your password:\n${link}\n`,
      ].join("\r\n")).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
      return true;
    } catch (err) { console.error("[email] Gmail API error", err?.response?.data || err); }
  }
  if (RESEND_API_KEY) {
    try {
      const resp = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: process.env.FROM_EMAIL || process.env.MAIL_FROM || "ATAG Jobs <onboarding@resend.dev>", to: [to], subject: "Reset your ATAG Jobs password", html: `<p>Click this link to reset your password:</p><p><a href="${link}">${link}</a></p>` }) });
      if (resp.ok) return true;
      console.error("[email] Resend error", await resp.text());
    } catch (err) { console.error("[email] Resend throw", err); }
  }
  console.warn("[email] no provider configured; reset link was not emailed");
  return false;
}

async function deliverPush(userIds, payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !userIds?.length) return;
  const subs = await getPushSubscriptions([...new Set(userIds)]);
  if (!subs.length) return;
  const results = await Promise.allSettled(subs.map(s => webpush.sendNotification(s.subscription, JSON.stringify(payload))));
  const invalidEndpoints = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const code = r.reason?.statusCode;
      if (code === 404 || code === 410) invalidEndpoints.push(subs[i].endpoint);
      else console.warn("[push] delivery failed", code, r.reason?.message || r.reason);
    }
  });
  if (invalidEndpoints.length) await pool.query(`DELETE FROM push_subscriptions WHERE endpoint=ANY($1)`, [invalidEndpoints]);
}

async function notifyAfterCommit(userIds, item) {
  deliverPush(userIds, { title: item.title, body: item.body, url: item.link }).catch(err => console.warn("[push]", err?.message || err));
}

function normalizeAdjustments(obj, actor) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const [uid, arr] of Object.entries(obj)) {
    out[String(uid)] = (Array.isArray(arr) ? arr : []).map(x => ({
      amount: Number(x?.amount) || 0, reason: String(x?.reason || ""),
      ts: x?.ts ? new Date(x.ts).toISOString() : new Date().toISOString(),
      by: x?.by && typeof x.by === "object" ? { id: x.by.id ?? actor?.id ?? null, email: x.by.email ?? actor?.email ?? null } : actor ? { id: actor.id ?? null, email: actor.email ?? null } : null,
    }));
  }
  return out;
}

function generateJobCSV(job) {
  const rows = [];
  const applications = job.applications || [], approved = job.approved || [], rejected = job.rejected || [], attendance = job.attendance || {};
  const scheduledHours = Math.max(0, (new Date(job.endTime) - new Date(job.startTime)) / 3600000).toFixed(2);
  for (const a of applications) {
    const rec = attendance[a.userId] || {};
    rows.push({ section: "applications", userId: a.userId, email: a.email || "", transport: a.transport || "", status: approved.includes(a.userId) ? "approved" : rejected.includes(a.userId) ? "rejected" : "applied", in: "", out: "", lateMinutes: "", present: !!(rec.in || rec.out), scheduledStart: job.startTime, scheduledEnd: job.endTime, scheduledHours, eventStartedAt: job.events?.startedAt || "", eventEndedAt: job.events?.endedAt || "", luApplied: (job.loadingUnload?.applicants || []).includes(a.userId), luConfirmed: (job.loadingUnload?.participants || []).includes(a.userId) });
  }
  for (const [userId, rec] of Object.entries(attendance)) {
    const a = applications.find(x => x.userId === userId) || {};
    rows.push({ section: "attendance", userId, email: a.email || "", transport: a.transport || "", status: approved.includes(userId) ? "approved" : rejected.includes(userId) ? "rejected" : "applied", in: rec.in || "", out: rec.out || "", lateMinutes: rec.lateMinutes ?? "", present: !!(rec.in || rec.out), scheduledStart: job.startTime, scheduledEnd: job.endTime, scheduledHours, eventStartedAt: job.events?.startedAt || "", eventEndedAt: job.events?.endedAt || "", luApplied: (job.loadingUnload?.applicants || []).includes(userId), luConfirmed: (job.loadingUnload?.participants || []).includes(userId) });
  }
  return rows;
}
function csvEscape(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

// ---------- Auth ----------
app.post("/login", asyncHandler(async (req, res) => {
  const { identifier, email, username, password } = req.body || {};
  const id = identifier || email || username;
  if (!id || !password) throw new HttpError(400, "missing_credentials");
  const user = await findUserByIdentifier(id);
  if (!user) throw new HttpError(401, "unknown_user");
  if (!verifyPassword(password, user.passwordHash)) throw new HttpError(401, "invalid_password");
  if (!user.verified) return res.status(403).json({ error: "pending_verification", code: "PENDING_VERIFICATION" });
  await withTransaction(client => addAudit(client, "login", { identifier: id }, { user }));
  res.json({ token: signUserToken(user), user: await serializeUser(user, { privatePhoto: true }) });
}));

app.post("/register", asyncHandler(async (req, res) => {
  const { email, username, name, password, role, phone, discord, verificationDataUrl } = req.body || {};
  if (!email || !password) throw new HttpError(400, "email_and_password_required");
  if (!verificationDataUrl || typeof verificationDataUrl !== "string") throw new HttpError(400, "verification_photo_required");
  const id = randomId("u", 6);
  const finalUsername = username || String(email).split("@")[0];
  let uploaded;
  try { uploaded = await uploadImageDataUrl(verificationDataUrl, { kind: "verification", ownerUserId: id }); }
  catch (e) { throw new HttpError(400, e?.message || "invalid_verification_photo"); }
  try {
    const user = await withTransaction(async client => {
      const { rows } = await client.query(
        `INSERT INTO users(id,email,username,name,role,grade,password_hash,phone,discord,verified,verification_status,verification_photo_path)
         VALUES($1,$2,$3,$4,$5,'junior',$6,$7,$8,false,'PENDING',$9) RETURNING *`,
        [id, String(email), String(finalUsername), String(name || finalUsername), clampRole(role || "part-timer"), hashPassword(String(password)), String(phone || ""), String(discord || ""), uploaded.ref]
      );
      const u = rows[0];
      await addAudit(client, "register_pending_verification", { email, role: u.role }, { user: { id: u.id, email: u.email, role: u.role } });
      return await getUserById(u.id, client);
    });
    res.json({ ok: true, pending: true, user: await serializeUser(user, { privatePhoto: true }) });
  } catch (err) {
    await removeStoredFile(uploaded.ref).catch(() => {});
    throw err;
  }
}));

async function handleForgotPassword(req, res) {
  const { email } = req.body || {};
  if (!email) throw new HttpError(400, "email_required");
  const user = await findUserByIdentifier(email);
  // Do not disclose whether an account exists.
  if (!user || String(user.email).toLowerCase() !== String(email).toLowerCase()) return res.json({ ok: true });
  const token = crypto.randomBytes(24).toString("hex");
  const expires = new Date(Date.now() + 3600000);
  await withTransaction(async client => {
    await client.query(`DELETE FROM password_reset_tokens WHERE user_id=$1`, [user.id]);
    await client.query(`INSERT INTO password_reset_tokens(token_hash,user_id,expires_at) VALUES($1,$2,$3)`, [sha256(token), user.id, expires]);
    await addAudit(client, "forgot_password", { email: user.email }, { user });
  });
  const base = String(process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || process.env.APP_ORIGIN || req.headers.origin || "").replace(/\/$/, "");
  const resetLink = `${base}/#/reset?token=${token}`;
  const emailed = await sendResetEmail(user.email, resetLink);
  return res.json({ ok: true, ...(process.env.NODE_ENV !== "production" && !emailed ? { resetLink } : {}) });
}

async function handleResetPassword(req, res) {
  const { token, password } = req.body || {};
  if (!token || !password) throw new HttpError(400, "missing_token_or_password");
  await withTransaction(async client => {
    const { rows } = await client.query(`SELECT * FROM password_reset_tokens WHERE token_hash=$1 FOR UPDATE`, [sha256(token)]);
    const rec = rows[0];
    if (!rec) throw new HttpError(400, "invalid_token");
    if (Date.now() > new Date(rec.expires_at).getTime()) {
      await client.query(`DELETE FROM password_reset_tokens WHERE token_hash=$1`, [rec.token_hash]);
      throw new HttpError(400, "token_expired");
    }
    await client.query(`UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2`, [hashPassword(String(password)), rec.user_id]);
    await client.query(`DELETE FROM password_reset_tokens WHERE user_id=$1`, [rec.user_id]);
    const user = await getUserById(rec.user_id, client);
    await addAudit(client, "reset_password", { userId: rec.user_id }, { user });
  });
  return res.json({ ok: true });
}

app.post("/forgot-password", asyncHandler(handleForgotPassword));
app.post("/auth/forgot", asyncHandler(handleForgotPassword));
app.post("/reset-password", asyncHandler(handleResetPassword));
app.post("/auth/reset", asyncHandler(handleResetPassword));

// ---------- Profile ----------
app.get("/me", authMiddleware, asyncHandler(async (req, res) => {
  const user = await getUserById(req.user.id);
  if (!user) throw new HttpError(404, "user_not_found");
  res.json({ user: await serializeUser(user, { privatePhoto: true }) });
}));

async function handleUpdateMe(req, res) {
  const { email, username, name, phone, discord } = req.body || {};
  const user = await withTransaction(async client => {
    const before = await getUserById(req.user.id, client);
    if (!before) throw new HttpError(404, "user_not_found");
    await client.query(
      `UPDATE users SET email=COALESCE($2,email),username=COALESCE($3,username),name=COALESCE($4,name),phone=COALESCE($5,phone),discord=COALESCE($6,discord),updated_at=now() WHERE id=$1`,
      [req.user.id, email !== undefined ? String(email) : null, username !== undefined ? String(username) : null, name !== undefined ? String(name) : null, phone !== undefined ? String(phone || "") : null, discord !== undefined ? String(discord || "") : null]
    );
    await addAudit(client, "me_update_profile", { userId: req.user.id }, req);
    return getUserById(req.user.id, client);
  });
  res.json({ ok: true, token: signUserToken(user), user: await serializeUser(user, { privatePhoto: true }) });
}
app.patch("/me", authMiddleware, asyncHandler(handleUpdateMe));
app.post("/me/update", authMiddleware, asyncHandler(handleUpdateMe));
app.post("/me/profile", authMiddleware, asyncHandler(handleUpdateMe));
app.patch("/me/profile", authMiddleware, asyncHandler(handleUpdateMe));

app.post("/me/password", authMiddleware, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) throw new HttpError(400, "missing_fields");
  if (String(newPassword).length < 6) throw new HttpError(400, "weak_password");
  await withTransaction(async client => {
    const user = await getUserById(req.user.id, client);
    if (!user) throw new HttpError(404, "user_not_found");
    if (!verifyPassword(currentPassword, user.passwordHash)) throw new HttpError(401, "invalid_current_password");
    await client.query(`UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2`, [hashPassword(String(newPassword)), user.id]);
    await addAudit(client, "me_change_password", { userId: user.id }, req);
  });
  res.json({ ok: true });
}));

app.post("/me/avatar", authMiddleware, asyncHandler(async (req, res) => {
  const dataUrl = req.body?.dataUrl;
  if (!dataUrl) throw new HttpError(400, "dataUrl_required");
  const current = await getUserById(req.user.id);
  if (!current) throw new HttpError(404, "user_not_found");
  let uploaded;
  try { uploaded = await uploadImageDataUrl(dataUrl, { kind: "avatar", ownerUserId: current.id }); }
  catch (e) { throw new HttpError(400, e?.message || "invalid_avatar"); }
  try {
    await withTransaction(async client => {
      await client.query(`UPDATE users SET avatar_path=$1,updated_at=now() WHERE id=$2`, [uploaded.ref, current.id]);
      await addAudit(client, "me_update_avatar", { userId: current.id }, req);
    });
  } catch (e) { await removeStoredFile(uploaded.ref).catch(() => {}); throw e; }
  if (current.avatarUrl) removeStoredFile(current.avatarUrl).catch(() => {});
  res.json({ ok: true, avatarUrl: fileApiPath(uploaded.ref), avatarUrlAbs: await createSignedUrl(uploaded.ref, 3600) });
}));

app.post("/me/verification-photo", authMiddleware, asyncHandler(async (req, res) => {
  const dataUrl = req.body?.dataUrl || req.body?.verificationDataUrl || req.body?.verifyImageDataUrl;
  if (!dataUrl) throw new HttpError(400, "dataUrl_required");
  const current = await getUserById(req.user.id);
  if (!current) throw new HttpError(404, "user_not_found");
  const uploaded = await uploadImageDataUrl(dataUrl, { kind: "verification", ownerUserId: current.id });
  try {
    const user = await withTransaction(async client => {
      await client.query(`UPDATE users SET verification_photo_path=$1,verified=false,verification_status='PENDING',verified_at=NULL,verified_by=NULL,updated_at=now() WHERE id=$2`, [uploaded.ref, current.id]);
      await addAudit(client, "me_update_verification_photo", { userId: current.id }, req);
      return getUserById(current.id, client);
    });
    if (current.verificationPhotoUrl) removeStoredFile(current.verificationPhotoUrl).catch(() => {});
    res.json({ ok: true, user: await serializeUser(user, { privatePhoto: true }) });
  } catch (e) { await removeStoredFile(uploaded.ref).catch(() => {}); throw e; }
}));

app.post("/me/verification-photo/remove", authMiddleware, asyncHandler(async (req, res) => {
  const current = await getUserById(req.user.id);
  if (!current) throw new HttpError(404, "user_not_found");
  const user = await withTransaction(async client => {
    await client.query(`UPDATE users SET verification_photo_path=NULL,verified=false,verification_status='PENDING',verified_at=NULL,verified_by=NULL,updated_at=now() WHERE id=$1`, [current.id]);
    await addAudit(client, "me_remove_verification_photo", { userId: current.id }, req);
    return getUserById(current.id, client);
  });
  if (current.verificationPhotoUrl) removeStoredFile(current.verificationPhotoUrl).catch(() => {});
  res.json({ ok: true, user: await serializeUser(user, { privatePhoto: true }) });
}));

// ---------- Admin users ----------
app.get("/admin/users", authMiddleware, requireRole("admin"), asyncHandler(async (_req, res) => {
  const users = await listUsers();
  res.json(await Promise.all(users.map(u => serializeUser(u, { privatePhoto: true }))));
}));

app.patch("/admin/users/:id", authMiddleware, requireRole("admin"), asyncHandler(async (req, res) => {
  let oldPhoto = null, notify = false;
  const user = await withTransaction(async client => {
    const target = await getUserById(req.params.id, client);
    if (!target) throw new HttpError(404, "user_not_found");
    const { role, grade, verified, verificationStatus } = req.body || {};
    if (role !== undefined && target.role === "admin" && clampRole(role) !== "admin") {
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM users WHERE role='admin'`);
      if (rows[0].n <= 1) throw new HttpError(400, "last_admin");
    }
    let nextRole = role !== undefined ? clampRole(role) : target.role;
    let nextGrade = grade !== undefined ? clampGrade(grade) : target.grade;
    let nextVerified = target.verified;
    let nextStatus = target.verificationStatus;
    let verifiedAt = target.verifiedAt;
    let verifiedBy = target.verifiedBy;
    if (verified !== undefined) {
      nextVerified = !!verified;
      nextStatus = nextVerified ? "APPROVED" : (nextStatus || "PENDING");
      verifiedAt = nextVerified ? new Date().toISOString() : null;
      verifiedBy = nextVerified ? req.user.id : null;
    }
    if (verificationStatus !== undefined) {
      const s = String(verificationStatus).toUpperCase();
      if (!["PENDING","APPROVED","REJECTED"].includes(s)) throw new HttpError(400, "bad_verificationStatus");
      nextStatus = s; nextVerified = s === "APPROVED";
      verifiedAt = nextVerified ? new Date().toISOString() : null;
      verifiedBy = nextVerified ? req.user.id : null;
    }
    const decided = nextStatus === "APPROVED" || nextStatus === "REJECTED";
    oldPhoto = decided ? target.verificationPhotoUrl : null;
    await client.query(`UPDATE users SET role=$2,grade=$3,verified=$4,verification_status=$5,verified_at=$6,verified_by=$7,verification_photo_path=CASE WHEN $8 THEN NULL ELSE verification_photo_path END,updated_at=now() WHERE id=$1`, [target.id, nextRole, nextGrade, nextVerified, nextStatus, verifiedAt, verifiedBy, decided]);
    await addAudit(client, "admin_update_user_role_grade", { userId: target.id, before: { role: target.role, grade: target.grade }, after: { role: nextRole, grade: nextGrade, verified: nextVerified, verificationStatus: nextStatus } }, req);
    const n = await insertNotifications(client, [target.id], { title: "Your account was updated", body: `Role: ${nextRole} • Grade: ${nextGrade} • Verified: ${nextVerified ? "YES" : "NO"}`, link: "/#/", type: "account_update", eventKeyBase: `account_update:${target.id}:${Date.now()}` });
    notify = n.length > 0;
    return getUserById(target.id, client);
  });
  if (oldPhoto) removeStoredFile(oldPhoto).catch(() => {});
  if (notify) notifyAfterCommit([user.id], { title: "Your account was updated", body: `Role: ${user.role} • Grade: ${user.grade}`, link: "/#/" });
  res.json({ ok: true, user: await serializeUser(user, { privatePhoto: true }) });
}));

app.delete("/admin/users/:id", authMiddleware, requireRole("admin"), asyncHandler(async (req, res) => {
  if (req.params.id === req.user.id) throw new HttpError(400, "self_delete_not_allowed");
  let files = [], removed;
  await withTransaction(async client => {
    const target = await getUserById(req.params.id, client);
    if (!target) throw new HttpError(404, "user_not_found");
    if (target.role === "admin") {
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM users WHERE role='admin'`);
      if (rows[0].n <= 1) throw new HttpError(400, "last_admin");
    }
    const receipts = await client.query(`SELECT storage_path FROM parking_receipts WHERE user_id=$1`, [target.id]);
    files = [target.avatarUrl, target.verificationPhotoUrl, ...receipts.rows.map(r => r.storage_path)].filter(Boolean);
    await client.query(`DELETE FROM users WHERE id=$1`, [target.id]);
    await addAudit(client, "admin_delete_user", { userId: target.id, email: target.email }, req);
    removed = { id: target.id, email: target.email };
  });
  await Promise.allSettled(files.map(removeStoredFile));
  res.json({ ok: true, removed });
}));

app.post("/admin/users/:id/verification-photo/remove", authMiddleware, requireRole("admin"), asyncHandler(async (req, res) => {
  const target = await getUserById(req.params.id);
  if (!target) throw new HttpError(404, "user_not_found");
  await withTransaction(async client => {
    await client.query(`UPDATE users SET verification_photo_path=NULL,updated_at=now() WHERE id=$1`, [target.id]);
    await addAudit(client, "admin_remove_verification_photo", { userId: target.id }, req);
  });
  if (target.verificationPhotoUrl) removeStoredFile(target.verificationPhotoUrl).catch(() => {});
  res.json({ ok: true });
}));

// ---------- Config ----------
app.get("/config/rates", authMiddleware, requireRole("admin"), asyncHandler(async (_req, res) => {
  const config = await getAppConfig();
  res.json({ ...config.rates, roleRatesDefaults: config.roleRatesDefaults });
}));
app.post("/config/rates", authMiddleware, requireRole("admin"), asyncHandler(async (req, res) => {
  const result = await withTransaction(async client => {
    const current = await getAppConfig(client);
    const body = req.body || {};
    const roleRatesDefaults = body.roleRatesDefaults && typeof body.roleRatesDefaults === "object" ? { ...current.roleRatesDefaults, ...body.roleRatesDefaults } : current.roleRatesDefaults;
    const cleanBody = { ...body }; delete cleanBody.roleRatesDefaults;
    const rates = { ...current.rates, ...cleanBody, earlyCall: { ...current.rates.earlyCall, ...(cleanBody.earlyCall || {}) } };
    await setConfigValue(client, "rates", rates);
    await setConfigValue(client, "roleRatesDefaults", roleRatesDefaults);
    await addAudit(client, "update_rates_default", { rates, roleRatesDefaults }, req);
    return { rates, roleRatesDefaults };
  });
  res.json({ ok: true, ...result });
}));

// ---------- Jobs ----------
app.get("/jobs", asyncHandler(async (req, res) => {
  const jobs = await listJobsPublic();
  const limit = Number(req.query.limit || 0);
  res.json(limit > 0 ? jobs.slice(0, limit) : jobs);
}));

app.get("/jobs/:id", optionalAuthMiddleware, asyncHandler(async (req, res) => {
  const job = await getJobFull(req.params.id);
  if (!job) throw new HttpError(404, "job_not_found");
  // API paths for assets; private receipt signed links are added only for managers.
  job.fullTimers = (job.fullTimers || []).map(ft => ({ ...ft }));
  job.applications = (job.applications || []).map(a => ({ ...a, avatarUrl: a.avatarUrl ? fileApiPath(a.avatarUrl) : "" }));
  if (req.user && (req.user.role === "pm" || req.user.role === "admin")) {
    job.parkingReceipts = await Promise.all((job.parkingReceipts || []).map(async r => ({ ...r, photoUrl: fileApiPath(r.photoUrl), photoUrlAbs: await createSignedUrl(r.photoUrl, 300) })));
  }
  res.json(stripPrivateJob(job, req.user));
}));

async function handleBreakToggle(req, res) {
  const body = req.body || {};
  const result = await withTransaction(async client => {
    const { rows } = await client.query(`SELECT break_enabled FROM jobs WHERE id=$1 FOR UPDATE`, [req.params.id]);
    if (!rows[0]) throw new HttpError(404, "job_not_found");
    const has = typeof body.enabled === "boolean" || typeof body.breakEnabled === "boolean" || typeof body.value === "boolean";
    const next = has ? !!(body.enabled ?? body.breakEnabled ?? body.value) : !rows[0].break_enabled;
    await client.query(`UPDATE jobs SET break_enabled=$2,updated_at=now() WHERE id=$1`, [req.params.id, next]);
    await addAudit(client, "break_toggle", { jobId: req.params.id, breakEnabled: next }, req);
    return next;
  });
  res.json({ ok: true, breakEnabled: result });
}
for (const p of ["/jobs/:id/break","/jobs/:id/break-time","/jobs/:id/break/toggle","/jobs/:id/break-enabled"]) app.post(p, authMiddleware, requireRole("pm","admin"), asyncHandler(handleBreakToggle));

app.post("/jobs", authMiddleware, requireRole("pm","admin"), asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.title || !body.venue || !body.startTime || !body.endTime) throw new HttpError(400, "missing_fields");
  const start = new Date(body.startTime), end = new Date(body.endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) throw new HttpError(400, "invalid_job_time");
  const deadline = parseApplicationDeadline(body);
  if (deadline && new Date(deadline) > start) throw new HttpError(400, "deadline_after_job_start");
  const config = await getAppConfig();
  const roleCounts = { junior: toNumber(body.roleCounts?.junior), senior: toNumber(body.roleCounts?.senior), lead: toNumber(body.roleCounts?.lead), junior_emcee: toNumber(body.roleCounts?.junior_emcee), senior_emcee: toNumber(body.roleCounts?.senior_emcee) };
  const countSum = Object.values(roleCounts).reduce((a,b) => a+b, 0);
  const rr = {};
  for (const r of STAFF_ROLES) rr[r] = { ...(config.roleRatesDefaults[r] || defaultRoleRates(config.rates)[r]), ...(body.roleRates?.[r] || {}) };
  const ldu = body.ldu || body.loadingUnload || {};
  const ec = body.earlyCall || {};
  const id = randomId("j", 5);
  const recipients = await withTransaction(async client => {
    await client.query(
      `INSERT INTO jobs(id,title,venue,description,start_time,end_time,application_deadline,status,headcount,transport_options,rate,role_counts,role_rates,session,break_enabled,extra,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,'upcoming',$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [id, String(body.title), String(body.venue), String(body.description || ""), start, end, deadline, toNumber(body.headcount, countSum || 5), normalizeTransportOptions(body.transportOptions), body.rate ? { ...config.rates, ...body.rate } : config.rates, roleCounts, rr, body.session || {}, !!body.breakEnabled, extraFromPayload(body), req.user.id]
    );
    await client.query(`INSERT INTO job_loading_config(job_id,enabled,quota,price,closed) VALUES($1,$2,$3,$4,$5)`, [id, !!ldu.enabled || toNumber(ldu.quota) > 0, Math.max(0,toNumber(ldu.quota)), toNumber(ldu.price, config.rates.loadingUnloading.amount), !!ldu.closed]);
    await client.query(`INSERT INTO job_early_call_config(job_id,enabled,amount,threshold_hours) VALUES($1,$2,$3,$4)`, [id, !!ec.enabled, toNumber(ec.amount, config.rates.earlyCall.defaultAmount), toNumber(ec.thresholdHours, config.rates.earlyCall.thresholdHours)]);
    await client.query(`INSERT INTO job_events(job_id) VALUES($1)`, [id]);
    await addAudit(client, "create_job", { jobId: id, title: body.title }, req);
    const { rows } = await client.query(`SELECT id FROM users WHERE role IN ('part-timer','admin')`);
    const ids = rows.map(r => r.id);
    await insertNotifications(client, ids, { title: `New job: ${body.title}`, body: `${body.venue} — ${new Intl.DateTimeFormat("en-MY", { timeZone: BUSINESS_TIME_ZONE, day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" }).format(start)}`, link: `/#/jobs/${id}`, type: "job_new", eventKeyBase: `job_new:${id}` });
    return ids;
  });
  notifyAfterCommit(recipients, { title: `New job: ${body.title}`, body: String(body.venue), link: `/#/jobs/${id}` });
  res.json(await getJobFull(id));
}));

app.patch("/jobs/:id", authMiddleware, requireRole("pm","admin"), asyncHandler(async (req, res) => {
  const body = req.body || {};
  await withTransaction(async client => {
    const { rows } = await client.query(`SELECT * FROM jobs WHERE id=$1 FOR UPDATE`, [req.params.id]);
    const row = rows[0]; if (!row) throw new HttpError(404, "job_not_found");
    const nextStart = body.startTime !== undefined ? new Date(body.startTime) : new Date(row.start_time);
    const nextEnd = body.endTime !== undefined ? new Date(body.endTime) : new Date(row.end_time);
    if (Number.isNaN(nextStart.getTime()) || Number.isNaN(nextEnd.getTime()) || nextEnd < nextStart) throw new HttpError(400, "invalid_job_time");
    const deadline = body.applicationDeadline !== undefined || body.applyDueDate !== undefined ? parseApplicationDeadline(body) : (row.application_deadline ? new Date(row.application_deadline).toISOString() : null);
    if (deadline && new Date(deadline) > nextStart) throw new HttpError(400, "deadline_after_job_start");
    const transport = body.transportOptions !== undefined ? normalizeTransportOptions(body.transportOptions) : row.transport_options;
    const extra = { ...(row.extra || {}), ...extraFromPayload(body) };
    await client.query(
      `UPDATE jobs SET title=COALESCE($2,title),venue=COALESCE($3,venue),description=COALESCE($4,description),start_time=$5,end_time=$6,application_deadline=$7,
       headcount=COALESCE($8,headcount),transport_options=$9,rate=COALESCE($10,rate),role_counts=COALESCE($11,role_counts),role_rates=COALESCE($12,role_rates),session=COALESCE($13,session),
       break_enabled=COALESCE($14,break_enabled),extra=$15,updated_at=now() WHERE id=$1`,
      [req.params.id, body.title !== undefined ? String(body.title) : null, body.venue !== undefined ? String(body.venue) : null, body.description !== undefined ? String(body.description || "") : null, nextStart, nextEnd, deadline, body.headcount !== undefined ? Math.max(0,toNumber(body.headcount)) : null, transport, body.rate !== undefined ? body.rate : null, body.roleCounts !== undefined ? body.roleCounts : null, body.roleRates !== undefined ? body.roleRates : null, body.session !== undefined ? body.session : null, body.breakEnabled !== undefined ? !!body.breakEnabled : null, extra]
    );
    const ldu = body.ldu || body.loadingUnload;
    if (ldu) await client.query(`UPDATE job_loading_config SET enabled=COALESCE($2,enabled),quota=COALESCE($3,quota),price=COALESCE($4,price),closed=COALESCE($5,closed),updated_at=now() WHERE job_id=$1`, [req.params.id, ldu.enabled !== undefined ? !!ldu.enabled : null, ldu.quota !== undefined ? Math.max(0,toNumber(ldu.quota)) : null, ldu.price !== undefined ? toNumber(ldu.price) : null, ldu.closed !== undefined ? !!ldu.closed : null]);
    if (body.earlyCall) await client.query(`UPDATE job_early_call_config SET enabled=COALESCE($2,enabled),amount=COALESCE($3,amount),threshold_hours=COALESCE($4,threshold_hours),updated_at=now() WHERE job_id=$1`, [req.params.id, body.earlyCall.enabled !== undefined ? !!body.earlyCall.enabled : null, body.earlyCall.amount !== undefined ? toNumber(body.earlyCall.amount) : null, body.earlyCall.thresholdHours !== undefined ? toNumber(body.earlyCall.thresholdHours) : null]);
    if (body.adjustments && typeof body.adjustments === "object") await replaceAdjustments(client, req.params.id, normalizeAdjustments(body.adjustments, req.user), req.user);
    await addAudit(client, "edit_job", { jobId: req.params.id }, req);
  });
  res.json(await getJobFull(req.params.id));
}));

app.post("/jobs/:id/adjustments", authMiddleware, requireRole("pm","admin"), asyncHandler(async (req, res) => {
  const adjustments = normalizeAdjustments(req.body?.adjustments || {}, req.user);
  await withTransaction(async client => {
    const exists = await client.query(`SELECT 1 FROM jobs WHERE id=$1`, [req.params.id]); if (!exists.rowCount) throw new HttpError(404, "job_not_found");
    await replaceAdjustments(client, req.params.id, adjustments, req.user);
    await addAudit(client, "update_adjustments", { jobId: req.params.id, entries: Object.values(adjustments).reduce((s,a)=>s+a.length,0) }, req);
  });
  res.json({ ok: true, job: await getJobFull(req.params.id) });
}));

app.delete("/jobs/:id", authMiddleware, requireRole("pm","admin"), asyncHandler(async (req, res) => {
  let paths = [], removed;
  await withTransaction(async client => {
    const { rows } = await client.query(`SELECT id,title FROM jobs WHERE id=$1 FOR UPDATE`, [req.params.id]); if (!rows[0]) throw new HttpError(404, "job_not_found");
    const pr = await client.query(`SELECT storage_path FROM parking_receipts WHERE job_id=$1`, [req.params.id]); paths = pr.rows.map(r=>r.storage_path);
    await client.query(`DELETE FROM jobs WHERE id=$1`, [req.params.id]);
    await addAudit(client, "delete_job", { jobId: req.params.id }, req); removed = rows[0];
  });
  await Promise.allSettled(paths.map(removeStoredFile));
  res.json({ ok: true, removed });
}));

app.post("/jobs/:id/apply", authMiddleware, requireRole("part-timer"), asyncHandler(async (req, res) => {
  let admins = [], notif = null;
  const result = await withTransaction(async client => {
    const { rows } = await client.query(`SELECT * FROM jobs WHERE id=$1 FOR SHARE`, [req.params.id]); const job = rows[0];
    if (!job) throw new HttpError(404, "job_not_found");
    if (isApplicationClosed(job.application_deadline)) throw new HttpError(409, "application_closed", "Application deadline has passed.");
    let transport = req.body?.transport;
    const opts = normalizeTransportOptions(job.transport_options);
    if (!transport || !["ATAG Bus","Own Transport"].includes(transport)) transport = "Own Transport";
    if ((transport === "ATAG Bus" && !opts.bus) || (transport === "Own Transport" && !opts.own)) {
      if (opts.bus || opts.own) throw new HttpError(400, "transport_not_allowed");
    }
    const wantsLU = req.body?.wantsLU;
    const existingR = await client.query(`SELECT * FROM job_applications WHERE job_id=$1 AND user_id=$2 FOR UPDATE`, [job.id, req.user.id]);
    const existing = existingR.rows[0];
    if (existing?.status === "rejected") {
      const countR = await client.query(`SELECT count(*)::int n FROM job_applications WHERE job_id=$1 AND status='approved'`, [job.id]);
      if (Number(job.headcount || 0) > 0 && countR.rows[0].n >= Number(job.headcount)) throw new HttpError(409, "job_full_no_reapply");
    }
    const now = new Date();
    if (!existing) {
      await client.query(`INSERT INTO job_applications(job_id,user_id,email_snapshot,transport,status,wants_loading,applied_at,updated_at) VALUES($1,$2,$3,$4,'applied',$5,$6,$6)`, [job.id, req.user.id, req.user.email || "", transport, wantsLU === true, now]);
    } else if (existing.status === "rejected") {
      await client.query(`UPDATE job_applications SET transport=$3,status='applied',wants_loading=CASE WHEN $4::boolean IS NULL THEN wants_loading ELSE $4 END,applied_at=$5,updated_at=$5 WHERE job_id=$1 AND user_id=$2`, [job.id, req.user.id, transport, typeof wantsLU === "boolean" ? wantsLU : null, now]);
    } else {
      if (existing.transport === transport && typeof wantsLU !== "boolean") return { message: "already_applied", changed: false };
      await client.query(`UPDATE job_applications SET transport=$3,wants_loading=CASE WHEN $4::boolean IS NULL THEN wants_loading ELSE $4 END,updated_at=now() WHERE job_id=$1 AND user_id=$2`, [job.id, req.user.id, transport, typeof wantsLU === "boolean" ? wantsLU : null]);
    }
    if (typeof wantsLU === "boolean") {
      await client.query(`INSERT INTO job_loading_members(job_id,user_id,applied,present) VALUES($1,$2,$3,false) ON CONFLICT(job_id,user_id) DO UPDATE SET applied=EXCLUDED.applied,updated_at=now()`, [job.id, req.user.id, wantsLU]);
    }
    await addAudit(client, existing?.status === "rejected" ? "reapply" : existing ? "apply_update" : "apply", { jobId: job.id, userId: req.user.id, transport, wantsLU: !!wantsLU }, req);
    admins = await listAdminIds(client);
    const me = await getUserById(req.user.id, client);
    notif = { title: existing ? `Application update: ${job.title}` : `New application: ${job.title}`, body: `${me?.name || req.user.email} ${existing ? "updated application" : "applied"} • ${transport}`, link: `/#/admin/jobs/${job.id}`, type: "app_new" };
    await insertNotifications(client, admins, { ...notif, eventKeyBase: `app_event:${job.id}:${req.user.id}:${now.getTime()}` });
    return { ok: true, ...(existing?.status === "rejected" ? { reapply: true } : existing ? { updated: true } : {}) };
  });
  if (result.changed === false) return res.json({ message: "already_applied" });
  if (admins.length) notifyAfterCommit(admins, notif);
  res.json(result);
}));

// ---------- Parking receipts / storage ----------
app.post("/jobs/:id/parking-receipt", authMiddleware, requireRole("part-timer","pm","admin"), asyncHandler(async (req, res) => {
  const full = await getJobFull(req.params.id); if (!full) throw new HttpError(404, "job_not_found");
  const isManager = req.user.role === "pm" || req.user.role === "admin";
  if (!isManager && !(full.approved || []).includes(req.user.id)) throw new HttpError(403, "not_approved");
  const dataUrl = req.body?.dataUrl || req.body?.receiptDataUrl || req.body?.imageDataUrl || req.body?.parkingReceiptDataUrl;
  if (!dataUrl) throw new HttpError(400, "dataUrl_required");
  const uploaded = await uploadImageDataUrl(dataUrl, { kind: "parking-receipt", ownerUserId: req.user.id, jobId: full.id });
  const rid = randomId("pr", 7);
  try {
    await withTransaction(async client => {
      await client.query(`INSERT INTO parking_receipts(id,job_id,user_id,email_snapshot,amount,note,storage_path,status) VALUES($1,$2,$3,$4,$5,$6,$7,'SUBMITTED')`, [rid, full.id, req.user.id, req.user.email || "", req.body?.amount === "" || req.body?.amount == null ? null : toNumber(req.body.amount), String(req.body?.note ?? req.body?.remark ?? ""), uploaded.ref]);
      await addAudit(client, "parking_receipt_submit", { jobId: full.id, userId: req.user.id, receiptId: rid }, req);
    });
  } catch (e) { await removeStoredFile(uploaded.ref).catch(()=>{}); throw e; }
  const user = await getUserById(req.user.id);
  const receipt = { id: rid, jobId: full.id, userId: req.user.id, email: req.user.email, amount: req.body?.amount === "" || req.body?.amount == null ? null : toNumber(req.body.amount), note: String(req.body?.note ?? req.body?.remark ?? ""), photoUrl: fileApiPath(uploaded.ref), photoUrlAbs: await createSignedUrl(uploaded.ref, 300), createdAt: new Date().toISOString(), status: "SUBMITTED", name: user?.name || "", phone: user?.phone || "", discord: user?.discord || "" };
  res.json({ ok: true, receipt, photoUrl: receipt.photoUrl, photoUrlAbs: receipt.photoUrlAbs });
}));

async function receiptRows(jobId, userId = null) {
  const params = [jobId];
  let where = `p.job_id=$1`;
  if (userId) { params.push(userId); where += ` AND p.user_id=$2`; }
  const { rows } = await pool.query(`SELECT p.*,u.name,u.phone,u.discord FROM parking_receipts p LEFT JOIN users u ON u.id=p.user_id WHERE ${where} ORDER BY p.created_at DESC`, params);
  return Promise.all(rows.map(async r => ({ id:r.id,jobId:r.job_id,userId:r.user_id,email:r.email_snapshot,amount:r.amount==null?null:Number(r.amount),note:r.note||"",photoUrl:fileApiPath(r.storage_path),photoUrlAbs:await createSignedUrl(r.storage_path,300),createdAt:iso(r.created_at),status:r.status||"SUBMITTED",name:r.name||"",phone:r.phone||"",discord:r.discord||"" })));
}
app.get("/jobs/:id/parking-receipts", authMiddleware, requireRole("pm","admin"), asyncHandler(async (req,res)=>{
  const exists = await pool.query(`SELECT 1 FROM jobs WHERE id=$1`,[req.params.id]); if(!exists.rowCount) throw new HttpError(404,"job_not_found");
  res.json({ok:true,receipts:await receiptRows(req.params.id)});
}));
app.get("/jobs/:id/parking-receipt/me", authMiddleware, requireRole("part-timer","pm","admin"), asyncHandler(async (req,res)=>{
  const exists = await pool.query(`SELECT 1 FROM jobs WHERE id=$1`,[req.params.id]); if(!exists.rowCount) throw new HttpError(404,"job_not_found");
  const receipts=await receiptRows(req.params.id,req.user.id); res.json({ok:true,receipt:receipts[0]||null,receipts});
}));
app.post("/jobs/:id/parking-receipt/me/remove", authMiddleware, requireRole("part-timer","pm","admin"), asyncHandler(async (req,res)=>{
  let paths=[]; await withTransaction(async client=>{const r=await client.query(`DELETE FROM parking_receipts WHERE job_id=$1 AND user_id=$2 RETURNING storage_path`,[req.params.id,req.user.id]);paths=r.rows.map(x=>x.storage_path);await addAudit(client,"parking_receipt_me_remove",{jobId:req.params.id,userId:req.user.id,removed:paths.length},req);});
  await Promise.allSettled(paths.map(removeStoredFile)); res.json({ok:true,removed:paths.length});
}));
app.post("/jobs/:id/parking-receipt/:rid/delete", authMiddleware, requireRole("part-timer","pm","admin"), asyncHandler(async (req,res)=>{
  let pathRef; await withTransaction(async client=>{const r=await client.query(`SELECT * FROM parking_receipts WHERE id=$1 AND job_id=$2 FOR UPDATE`,[req.params.rid,req.params.id]);const x=r.rows[0];if(!x)throw new HttpError(404,"receipt_not_found");if(!["pm","admin"].includes(req.user.role)&&x.user_id!==req.user.id)throw new HttpError(403,"forbidden");pathRef=x.storage_path;await client.query(`DELETE FROM parking_receipts WHERE id=$1`,[x.id]);await addAudit(client,"parking_receipt_delete",{jobId:req.params.id,userId:req.user.id,receiptId:x.id},req);});
  if(pathRef)removeStoredFile(pathRef).catch(()=>{});res.json({ok:true});
}));

app.get("/files/:bucket/*", optionalAuthMiddleware, asyncHandler(async (req,res)=>{
  const bucket=decodeURIComponent(req.params.bucket);const objectPath=String(req.params[0]||"").split("/").map(decodeURIComponent).join("/");const ref=makeStorageRef(bucket,objectPath);
  if(bucket!=="avatars"){
    if(!req.user)throw new HttpError(401,"no_token");
    if(bucket==="verification-photos"){
      const r=await pool.query(`SELECT id FROM users WHERE verification_photo_path=$1`,[ref]);if(!r.rowCount)throw new HttpError(404,"file_not_found");if(req.user.role!=="admin"&&r.rows[0].id!==req.user.id)throw new HttpError(403,"forbidden");
    }else if(bucket==="parking-receipts"){
      const r=await pool.query(`SELECT user_id FROM parking_receipts WHERE storage_path=$1`,[ref]);if(!r.rowCount)throw new HttpError(404,"file_not_found");if(!["pm","admin"].includes(req.user.role)&&r.rows[0].user_id!==req.user.id)throw new HttpError(403,"forbidden");
    }else throw new HttpError(404,"file_not_found");
  }
  const f=await downloadStoredFile(ref);res.setHeader("Content-Type",f.contentType);res.setHeader("Cache-Control",bucket==="avatars"?"public, max-age=3600":"private, no-store");res.end(f.buffer);
}));


// ---------- My jobs / applicants ----------
app.get("/me/jobs", authMiddleware, requireRole("part-timer"), asyncHandler(async (req,res)=>{
  const { rows }=await pool.query(`SELECT j.id,j.title,j.venue,j.start_time,j.end_time,j.status,a.status AS my_status,a.wants_loading,COALESCE(lm.present,false) AS lu_confirmed,e.started_at,e.ended_at FROM job_applications a JOIN jobs j ON j.id=a.job_id LEFT JOIN job_loading_members lm ON lm.job_id=a.job_id AND lm.user_id=a.user_id LEFT JOIN job_events e ON e.job_id=j.id WHERE a.user_id=$1 ORDER BY j.start_time`,[req.user.id]);
  res.json(rows.map(r=>{const tmp={startTime:iso(r.start_time),endTime:iso(r.end_time),status:r.status,events:{startedAt:iso(r.started_at),endedAt:iso(r.ended_at)}};return{id:r.id,title:r.title,venue:r.venue,startTime:tmp.startTime,endTime:tmp.endTime,status:computeStatus(tmp),myStatus:r.my_status,luApplied:!!r.wants_loading,luConfirmed:!!r.lu_confirmed};}));
}));

app.get("/jobs/:id/applicants", authMiddleware, requireRole("pm","admin"), asyncHandler(async (req,res)=>{
  const { rows }=await pool.query(`SELECT a.*,u.name,u.phone,u.discord,u.avatar_path,COALESCE(lm.applied,false) lu_applied,COALESCE(lm.present,false) lu_confirmed FROM job_applications a JOIN users u ON u.id=a.user_id LEFT JOIN job_loading_members lm ON lm.job_id=a.job_id AND lm.user_id=a.user_id WHERE a.job_id=$1 ORDER BY a.applied_at`,[req.params.id]);
  const exists=await pool.query(`SELECT 1 FROM jobs WHERE id=$1`,[req.params.id]);if(!exists.rowCount)throw new HttpError(404,"job_not_found");
  res.json(rows.map(a=>({userId:a.user_id,email:a.email_snapshot||a.email,transport:a.transport,appliedAt:iso(a.applied_at),status:a.status,luApplied:!!a.lu_applied,luConfirmed:!!a.lu_confirmed,name:a.name||"",phone:a.phone||"",discord:a.discord||"",avatarUrl:a.avatar_path?fileApiPath(a.avatar_path):""})));
}));

app.post("/jobs/:id/approve", authMiddleware, requireRole("pm","admin"), asyncHandler(async (req,res)=>{
  const { userId, approve }=req.body||{};if(!userId||typeof approve!=="boolean")throw new HttpError(400,"bad_request");
  const idemKey=String(req.headers["idempotency-key"]||"").trim();if(idemKey.length>200)throw new HttpError(400,"idempotency_key_too_long");
  const routeKey=`POST /jobs/${req.params.id}/approve`;const requestHash=stableRequestHash({jobId:req.params.id,userId,approve});
  let pushIds=[];let pushPayload=null;let replayed=false;
  const output=await withTransaction(async client=>{
    if(idemKey){
      const ins=await client.query(`INSERT INTO idempotency_requests(actor_user_id,route_key,idempotency_key,request_hash,state) VALUES($1,$2,$3,$4,'processing') ON CONFLICT DO NOTHING RETURNING idempotency_key`,[req.user.id,routeKey,idemKey,requestHash]);
      if(!ins.rowCount){const ex=await client.query(`SELECT * FROM idempotency_requests WHERE actor_user_id=$1 AND route_key=$2 AND idempotency_key=$3 FOR UPDATE`,[req.user.id,routeKey,idemKey]);const r=ex.rows[0];if(!r)throw new HttpError(409,"idempotency_retry");if(r.request_hash!==requestHash)throw new HttpError(409,"idempotency_key_reused");if(r.state==="completed"){replayed=true;return{status:r.response_status,body:r.response_body};}throw new HttpError(409,"idempotency_in_progress");}
    }
    const jr=await client.query(`SELECT id,title,headcount FROM jobs WHERE id=$1 FOR UPDATE`,[req.params.id]);const job=jr.rows[0];if(!job)throw new HttpError(404,"job_not_found");
    const ar=await client.query(`SELECT * FROM job_applications WHERE job_id=$1 AND user_id=$2 FOR UPDATE`,[job.id,userId]);const appRow=ar.rows[0];if(!appRow)throw new HttpError(400,"user_not_applied");
    const target=approve?"approved":"rejected";
    let changed=appRow.status!==target;
    if(changed&&approve){const c=await client.query(`SELECT count(*)::int n FROM job_applications WHERE job_id=$1 AND status='approved' AND user_id<>$2`,[job.id,userId]);if(Number(job.headcount||0)>0&&c.rows[0].n>=Number(job.headcount))throw new HttpError(409,"job_full");}
    if(changed){
      await client.query(`UPDATE job_applications SET status=$3,updated_at=now() WHERE job_id=$1 AND user_id=$2`,[job.id,userId,target]);
      if(approve&&appRow.wants_loading){const cfgR=await client.query(`SELECT * FROM job_loading_config WHERE job_id=$1 FOR UPDATE`,[job.id]);const cfg=cfgR.rows[0];if(cfg&&!cfg.closed){const cnt=await client.query(`SELECT count(*)::int n FROM job_loading_members WHERE job_id=$1 AND present=true`,[job.id]);if(Number(cfg.quota)<=0||cnt.rows[0].n<Number(cfg.quota)){await client.query(`INSERT INTO job_loading_members(job_id,user_id,applied,present) VALUES($1,$2,true,true) ON CONFLICT(job_id,user_id) DO UPDATE SET applied=true,present=true,updated_at=now()`,[job.id,userId]);const nextCount=cnt.rows[0].n+1;if(Number(cfg.quota)>0&&nextCount>=Number(cfg.quota))await client.query(`UPDATE job_loading_config SET closed=true,updated_at=now() WHERE job_id=$1`,[job.id]);}}}
      await addAudit(client,approve?"approve":"reject",{jobId:job.id,userId},req);
      if(approve){const n=await insertNotifications(client,[userId],{title:"Your application was approved ✅",body:job.title,link:`/#/jobs/${job.id}`,type:"app_approved",eventKeyBase:`app_approved:${job.id}:${userId}:${Date.now()}`});if(n.length){pushIds=[userId];pushPayload={title:"Your application was approved ✅",body:job.title,link:`/#/jobs/${job.id}`};}}
    }
    const body={ok:true,status:target,idempotent:!changed};
    if(idemKey)await client.query(`UPDATE idempotency_requests SET state='completed',response_status=200,response_body=$4 WHERE actor_user_id=$1 AND route_key=$2 AND idempotency_key=$3`,[req.user.id,routeKey,idemKey,body]);
    return{status:200,body};
  });
  if(replayed)res.setHeader("Idempotency-Replayed","true");
  if(pushIds.length)notifyAfterCommit(pushIds,pushPayload);
  res.status(output.status).json(output.body);
}));

// ---------- Early call ----------
async function getEarlyCall(jobId){const cfg=await pool.query(`SELECT * FROM job_early_call_config WHERE job_id=$1`,[jobId]);if(!cfg.rowCount){const j=await pool.query(`SELECT 1 FROM jobs WHERE id=$1`,[jobId]);if(!j.rowCount)throw new HttpError(404,"job_not_found");return{enabled:false,amount:0,thresholdHours:0,applicants:[],participants:[],participantDetails:[]};}const m=await pool.query(`SELECT m.*,u.email,u.name,u.phone,u.discord FROM job_early_call_members m JOIN users u ON u.id=m.user_id WHERE m.job_id=$1`,[jobId]);return{enabled:!!cfg.rows[0].enabled,amount:Number(cfg.rows[0].amount),thresholdHours:Number(cfg.rows[0].threshold_hours),applicants:m.rows.filter(x=>x.applied).map(x=>x.user_id),participants:m.rows.filter(x=>x.present).map(x=>x.user_id),participantDetails:m.rows.filter(x=>x.present).map(x=>({userId:x.user_id,email:x.email,name:x.name||"",phone:x.phone||"",discord:x.discord||""}))};}
app.get("/jobs/:id/earlycall",authMiddleware,requireRole("pm","admin"),asyncHandler(async(req,res)=>res.json(await getEarlyCall(req.params.id))));
const markEarlyCall = asyncHandler(async(req,res)=>{const {userId}=req.body||{};const present=typeof req.body?.present==="boolean"?req.body.present:typeof req.body?.enabled==="boolean"?req.body.enabled:undefined;if(!userId)throw new HttpError(400,"userId_required");if(typeof present!=="boolean")throw new HttpError(400,"present_boolean_required");await withTransaction(async client=>{const j=await client.query(`SELECT 1 FROM jobs WHERE id=$1`,[req.params.id]);if(!j.rowCount)throw new HttpError(404,"job_not_found");await client.query(`INSERT INTO job_early_call_members(job_id,user_id,present) VALUES($1,$2,$3) ON CONFLICT(job_id,user_id) DO UPDATE SET present=EXCLUDED.present,updated_at=now()`,[req.params.id,userId,present]);await addAudit(client,"early_call_mark",{jobId:req.params.id,userId,present},req);});const ec=await getEarlyCall(req.params.id);res.json({ok:true,participants:ec.participants,participantDetails:ec.participantDetails});});
app.post("/jobs/:id/earlycall/mark",authMiddleware,requireRole("pm","admin"),markEarlyCall);
app.post("/jobs/:id/earlycall/config",authMiddleware,requireRole("pm","admin"),asyncHandler(async(req,res)=>{const {enabled,amount,thresholdHours}=req.body||{};if(amount!==undefined&&toNumber(amount,-1)<0)throw new HttpError(400,"amount_must_be_non_negative_number");if(thresholdHours!==undefined&&toNumber(thresholdHours,-1)<0)throw new HttpError(400,"thresholdHours_must_be_non_negative_number");await withTransaction(async client=>{const j=await client.query(`SELECT 1 FROM jobs WHERE id=$1`,[req.params.id]);if(!j.rowCount)throw new HttpError(404,"job_not_found");await client.query(`INSERT INTO job_early_call_config(job_id,enabled,amount,threshold_hours) VALUES($1,COALESCE($2,false),COALESCE($3,0),COALESCE($4,0)) ON CONFLICT(job_id) DO UPDATE SET enabled=COALESCE($2,job_early_call_config.enabled),amount=COALESCE($3,job_early_call_config.amount),threshold_hours=COALESCE($4,job_early_call_config.threshold_hours),updated_at=now()`,[req.params.id,typeof enabled==="boolean"?enabled:null,amount!==undefined?toNumber(amount):null,thresholdHours!==undefined?toNumber(thresholdHours):null]);await addAudit(client,"early_call_config",{jobId:req.params.id,enabled,amount,thresholdHours},req);});res.json({ok:true,earlyCall:await getEarlyCall(req.params.id)});}));
app.get("/jobs/:id/early-call",authMiddleware,requireRole("pm","admin"),asyncHandler(async(req,res)=>res.json(await getEarlyCall(req.params.id))));
app.post("/jobs/:id/early-call/mark",authMiddleware,requireRole("pm","admin"),markEarlyCall);

// ---------- Loading ----------
async function getLoading(jobId){const cfg=await pool.query(`SELECT * FROM job_loading_config WHERE job_id=$1`,[jobId]);if(!cfg.rowCount){const j=await pool.query(`SELECT 1 FROM jobs WHERE id=$1`,[jobId]);if(!j.rowCount)throw new HttpError(404,"job_not_found");return{enabled:false,price:0,quota:0,closed:false,applicants:[],participants:[]};}const m=await pool.query(`SELECT m.*,u.email,u.name FROM job_loading_members m JOIN users u ON u.id=m.user_id WHERE m.job_id=$1`,[jobId]);const detail=x=>({userId:x.user_id,email:x.email,name:x.name||""});return{enabled:!!cfg.rows[0].enabled,price:Number(cfg.rows[0].price),quota:Number(cfg.rows[0].quota),closed:!!cfg.rows[0].closed,applicants:m.rows.filter(x=>x.applied).map(detail),participants:m.rows.filter(x=>x.present).map(detail)};}
app.get("/jobs/:id/loading",authMiddleware,requireRole("pm","admin"),asyncHandler(async(req,res)=>res.json(await getLoading(req.params.id))));
app.post("/jobs/:id/loading/mark",authMiddleware,requireRole("pm","admin"),asyncHandler(async(req,res)=>{const {userId}=req.body||{};const present=typeof req.body?.present==="boolean"?req.body.present:typeof req.body?.enabled==="boolean"?req.body.enabled:undefined;if(!userId||typeof present!=="boolean")throw new HttpError(400,"bad_request");const out=await withTransaction(async client=>{const cfgR=await client.query(`SELECT * FROM job_loading_config WHERE job_id=$1 FOR UPDATE`,[req.params.id]);const cfg=cfgR.rows[0];if(!cfg)throw new HttpError(404,"job_not_found");const cur=await client.query(`SELECT present FROM job_loading_members WHERE job_id=$1 AND user_id=$2 FOR UPDATE`,[req.params.id,userId]);const already=!!cur.rows[0]?.present;const c=await client.query(`SELECT count(*)::int n FROM job_loading_members WHERE job_id=$1 AND present=true`,[req.params.id]);if(present&&!already&&Number(cfg.quota)>0&&c.rows[0].n>=Number(cfg.quota))throw new HttpError(409,"lu_quota_full","Loading/unloading quota is full.",{quota:Number(cfg.quota),count:c.rows[0].n});await client.query(`INSERT INTO job_loading_members(job_id,user_id,present) VALUES($1,$2,$3) ON CONFLICT(job_id,user_id) DO UPDATE SET present=EXCLUDED.present,updated_at=now()`,[req.params.id,userId,present]);const next=c.rows[0].n+(present&&!already?1:0)-(!present&&already?1:0);const closed=Number(cfg.quota)>0&&next>=Number(cfg.quota);await client.query(`UPDATE job_loading_config SET closed=$2,updated_at=now() WHERE job_id=$1`,[req.params.id,closed]);await addAudit(client,"lu_mark",{jobId:req.params.id,userId,present},req);return{quota:Number(cfg.quota),closed};});const l=await getLoading(req.params.id);res.json({ok:true,participants:l.participants.map(x=>x.userId),closed:out.closed,quota:out.quota});}));

// ---------- Attendance / events ----------
app.post("/jobs/:id/attendance/mark",authMiddleware,requireRole("pm","admin"),asyncHandler(async(req,res)=>{const {userId,inAt,outAt,clear}=req.body||{};if(!userId)throw new HttpError(400,"userId_required");let record=null;await withTransaction(async client=>{const j=await client.query(`SELECT start_time FROM jobs WHERE id=$1`,[req.params.id]);if(!j.rowCount)throw new HttpError(404,"job_not_found");if(clear===true){await client.query(`DELETE FROM job_attendance WHERE job_id=$1 AND user_id=$2`,[req.params.id,userId]);await addAudit(client,"attendance_clear",{jobId:req.params.id,userId},req);return;}const cur=await client.query(`SELECT * FROM job_attendance WHERE job_id=$1 AND user_id=$2 FOR UPDATE`,[req.params.id,userId]);let inDate=cur.rows[0]?.in_at||null,outDate=cur.rows[0]?.out_at||null,late=Number(cur.rows[0]?.late_minutes||0);if(inAt!==undefined&&inAt!==null){inDate=new Date(inAt);if(Number.isNaN(inDate.getTime()))throw new HttpError(400,"invalid_inAt");late=Math.max(0,Math.floor((inDate-new Date(j.rows[0].start_time))/60000));}if(outAt!==undefined&&outAt!==null){outDate=new Date(outAt);if(Number.isNaN(outDate.getTime()))throw new HttpError(400,"invalid_outAt");}const r=await client.query(`INSERT INTO job_attendance(job_id,user_id,in_at,out_at,late_minutes) VALUES($1,$2,$3,$4,$5) ON CONFLICT(job_id,user_id) DO UPDATE SET in_at=EXCLUDED.in_at,out_at=EXCLUDED.out_at,late_minutes=EXCLUDED.late_minutes,updated_at=now() RETURNING *`,[req.params.id,userId,inDate,outDate,late]);const x=r.rows[0];record={in:iso(x.in_at),out:iso(x.out_at),breakIn:iso(x.break_in_at),breakOut:iso(x.break_out_at),lateMinutes:Number(x.late_minutes||0),breakMinutes:Number(x.break_minutes||0)};await addAudit(client,"attendance_mark",{jobId:req.params.id,userId,inAt,outAt},req);});const job=await getJobFull(req.params.id);res.json({ok:true,record,jobId:req.params.id,status:computeStatus(job)});}));
app.post("/jobs/:id/start",authMiddleware,requireRole("pm","admin"),asyncHandler(async(req,res)=>{const startedAt=await withTransaction(async client=>{const r=await client.query(`SELECT started_at FROM job_events WHERE job_id=$1 FOR UPDATE`,[req.params.id]);if(!r.rowCount)throw new HttpError(404,"job_not_found");if(r.rows[0].started_at)return iso(r.rows[0].started_at);const t=new Date();await client.query(`UPDATE job_events SET started_at=$2,ended_at=NULL,updated_at=now() WHERE job_id=$1`,[req.params.id,t]);await addAudit(client,"start_event",{jobId:req.params.id},req);return t.toISOString();});res.json({ok:true,startedAt});}));
app.post("/jobs/:id/end",authMiddleware,requireRole("pm","admin"),asyncHandler(async(req,res)=>{const endedAt=await withTransaction(async client=>{const r=await client.query(`SELECT 1 FROM job_events WHERE job_id=$1 FOR UPDATE`,[req.params.id]);if(!r.rowCount)throw new HttpError(404,"job_not_found");const t=req.body?.actualEndAt?new Date(req.body.actualEndAt):new Date();if(Number.isNaN(t.getTime()))throw new HttpError(400,"invalid_actualEndAt");await client.query(`UPDATE job_events SET ended_at=$2,updated_at=now() WHERE job_id=$1`,[req.params.id,t]);await addAudit(client,"end_event",{jobId:req.params.id},req);return t.toISOString();});res.json({ok:true,endedAt});}));
async function handleReset(req,res){const keep=!!req.body?.keepAttendance;await withTransaction(async client=>{const r=await client.query(`UPDATE job_events SET started_at=NULL,ended_at=NULL,scanner_lat=NULL,scanner_lng=NULL,scanner_updated_at=NULL,updated_at=now() WHERE job_id=$1 RETURNING job_id`,[req.params.id]);if(!r.rowCount)throw new HttpError(404,"job_not_found");if(!keep)await client.query(`DELETE FROM job_attendance WHERE job_id=$1`,[req.params.id]);await addAudit(client,"reset_event",{jobId:req.params.id,keepAttendance:keep},req);});res.json({ok:true,job:await getJobFull(req.params.id)});}
app.post("/jobs/:id/reset",authMiddleware,requireRole("pm","admin"),asyncHandler(handleReset));app.patch("/jobs/:id/reset",authMiddleware,requireRole("pm","admin"),asyncHandler(handleReset));

const VALID_DIR=new Set(["in","out","break_in","break_out"]);const isBreakDir=d=>d==="break_in"||d==="break_out";
app.post("/jobs/:id/qr",authMiddleware,requireRole("part-timer"),asyncHandler(async(req,res)=>{const job=await getJobFull(req.params.id);if(!job)throw new HttpError(404,"job_not_found");if(!(job.approved||[]).includes(req.user.id))throw new HttpError(400,"not_approved");if(!job.events?.startedAt)throw new HttpError(400,"event_not_started");const {direction,lat,lng}=req.body||{};const latN=Number(lat),lngN=Number(lng);if(!VALID_DIR.has(direction))throw new HttpError(400,"bad_direction");if(isBreakDir(direction)&&!job.breakEnabled)throw new HttpError(400,"break_disabled");if(!isValidCoord(latN,lngN))throw new HttpError(400,"location_required");const payload={typ:"scan",j:job.id,u:req.user.id,dir:direction,lat:Math.round(latN*1e5)/1e5,lng:Math.round(lngN*1e5)/1e5,iat:Math.floor(Date.now()/1000),nonce:crypto.randomUUID()};const token=jwt.sign(payload,EFFECTIVE_JWT_SECRET,{expiresIn:"60s"});await withTransaction(client=>addAudit(client,"gen_qr",{jobId:job.id,dir:direction,userId:req.user.id,lat:payload.lat,lng:payload.lng},req));const config=await getAppConfig();res.json({token,maxDistanceMeters:config.scanMaxDistanceMeters});}));

app.post("/scan",authMiddleware,requireRole("pm","admin"),asyncHandler(async(req,res)=>{const {token,scannerLat,scannerLng}=req.body||{};if(!token)throw new HttpError(400,"missing_token");let payload;try{payload=jwt.verify(token,EFFECTIVE_JWT_SECRET);}catch{throw new HttpError(400,"jwt_error");}if(payload.typ!=="scan")throw new HttpError(400,"bad_token_type");if(!VALID_DIR.has(payload.dir))throw new HttpError(400,"bad_direction");const sLat=Number(scannerLat),sLng=Number(scannerLng);if(!isValidCoord(payload.lat,payload.lng))throw new HttpError(400,"token_missing_location");if(!isValidCoord(sLat,sLng))throw new HttpError(400,"scanner_location_required");const config=await getAppConfig();const dist=haversineMeters(payload.lat,payload.lng,sLat,sLng);if(dist>config.scanMaxDistanceMeters)throw new HttpError(400,"too_far","Scanner is too far from QR location.",{distanceMeters:Math.round(dist),maxDistanceMeters:config.scanMaxDistanceMeters});let record,time;await withTransaction(async client=>{const jR=await client.query(`SELECT j.start_time,j.break_enabled,e.started_at FROM jobs j JOIN job_events e ON e.job_id=j.id WHERE j.id=$1 FOR UPDATE OF e`,[payload.j]);const j=jR.rows[0];if(!j)throw new HttpError(404,"job_not_found");if(!j.started_at)throw new HttpError(400,"event_not_started");if(isBreakDir(payload.dir)&&!j.break_enabled)throw new HttpError(400,"break_disabled");const a=await client.query(`SELECT * FROM job_attendance WHERE job_id=$1 AND user_id=$2 FOR UPDATE`,[payload.j,payload.u]);const r=a.rows[0]||{};if(payload.dir==="in"&&r.in_at)throw new HttpError(409,"already_checked_in","Already checked in.",{at:iso(r.in_at)});if(payload.dir==="out"&&r.out_at)throw new HttpError(409,"already_checked_out","Already checked out.",{at:iso(r.out_at)});if(payload.dir==="break_in"&&r.break_in_at)throw new HttpError(409,"already_break_in","Break already started.",{at:iso(r.break_in_at)});if(payload.dir==="break_out"&&r.break_out_at)throw new HttpError(409,"already_break_out","Break already ended.",{at:iso(r.break_out_at)});if(payload.dir==="break_in"&&(!r.in_at||r.out_at))throw new HttpError(409,!r.in_at?"must_check_in_first":"already_checked_out",!r.in_at?"No check-in recorded yet.":"Already checked out.",r.out_at?{at:iso(r.out_at)}:undefined);if(payload.dir==="break_out"&&(!r.in_at||r.out_at||!r.break_in_at))throw new HttpError(409,!r.in_at?"must_check_in_first":r.out_at?"already_checked_out":"break_in_missing",!r.in_at?"No check-in recorded yet.":r.out_at?"Already checked out.":"No break-in recorded.",r.out_at?{at:iso(r.out_at)}:undefined);time=new Date();let inAt=r.in_at||null,outAt=r.out_at||null,bi=r.break_in_at||null,bo=r.break_out_at||null,late=Number(r.late_minutes||0),bm=Number(r.break_minutes||0);if(payload.dir==="in"){inAt=time;late=Math.max(0,Math.floor((time-new Date(j.start_time))/60000));}if(payload.dir==="out")outAt=time;if(payload.dir==="break_in")bi=time;if(payload.dir==="break_out"){bo=time;bm=Math.max(0,Math.floor((time-new Date(bi))/60000));}const up=await client.query(`INSERT INTO job_attendance(job_id,user_id,in_at,out_at,break_in_at,break_out_at,late_minutes,break_minutes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(job_id,user_id) DO UPDATE SET in_at=EXCLUDED.in_at,out_at=EXCLUDED.out_at,break_in_at=EXCLUDED.break_in_at,break_out_at=EXCLUDED.break_out_at,late_minutes=EXCLUDED.late_minutes,break_minutes=EXCLUDED.break_minutes,updated_at=now() RETURNING *`,[payload.j,payload.u,inAt,outAt,bi,bo,late,bm]);const x=up.rows[0];record={in:iso(x.in_at),out:iso(x.out_at),breakIn:iso(x.break_in_at),breakOut:iso(x.break_out_at),lateMinutes:Number(x.late_minutes),breakMinutes:Number(x.break_minutes)};await addAudit(client,"scan_"+payload.dir,{jobId:payload.j,userId:payload.u,distanceMeters:Math.round(dist)},req);});res.json({ok:true,jobId:payload.j,userId:payload.u,direction:payload.dir,time:time.toISOString(),record});}));

app.get("/jobs/:id/csv",authMiddleware,requireRole("admin"),asyncHandler(async(req,res)=>{const job=await getJobFull(req.params.id);if(!job)throw new HttpError(404,"job_not_found");const headers=["section","userId","email","transport","status","in","out","lateMinutes","present","scheduledStart","scheduledEnd","scheduledHours","eventStartedAt","eventEndedAt","luApplied","luConfirmed"];const rows=generateJobCSV(job);res.setHeader("Content-Type","text/csv; charset=utf-8");res.setHeader("Content-Disposition",`attachment; filename="job-${job.id}.csv"`);res.write(headers.map(csvEscape).join(",")+"\n");for(const row of rows)res.write(headers.map(h=>csvEscape(row[h])).join(",")+"\n");res.end();}));

// ---------- Audit / push / notifications ----------
app.get("/admin/audit",authMiddleware,requireRole("admin"),asyncHandler(async(req,res)=>{const limit=Math.min(1000,Math.max(1,Number(req.query.limit||200)));const {rows}=await pool.query(`SELECT id,audit_time AS time,actor,role,action,details FROM audit_logs ORDER BY audit_time DESC LIMIT $1`,[limit]);res.json(rows.map(r=>({...r,time:iso(r.time)})));}));
app.get("/push/public-key",(_req,res)=>res.json({key:VAPID_PUBLIC_KEY}));
app.post("/push/subscribe",authMiddleware,asyncHandler(async(req,res)=>{const sub=req.body?.subscription;if(!sub?.endpoint)throw new HttpError(400,"bad_subscription");await withTransaction(async client=>{await client.query(`INSERT INTO push_subscriptions(user_id,endpoint,subscription) VALUES($1,$2,$3) ON CONFLICT(user_id,endpoint) DO UPDATE SET subscription=EXCLUDED.subscription,updated_at=now()`,[req.user.id,sub.endpoint,sub]);await addAudit(client,"push_subscribe",{userId:req.user.id},req);});res.json({ok:true});}));
app.post("/push/unsubscribe",authMiddleware,asyncHandler(async(req,res)=>{const ep=req.body?.endpoint;if(!ep)throw new HttpError(400,"endpoint_required");await withTransaction(async client=>{await client.query(`DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2`,[req.user.id,ep]);await addAudit(client,"push_unsubscribe",{userId:req.user.id},req);});res.json({ok:true});}));
app.get("/notifications/summary",authMiddleware,asyncHandler(async(req,res)=>{const {rows}=await pool.query(`SELECT count(*)::int total,count(*) FILTER(WHERE read=false)::int unread FROM notifications WHERE user_id=$1`,[req.user.id]);res.json({unreadCount:rows[0].unread,total:rows[0].total});}));
app.get("/notifications",authMiddleware,asyncHandler(async(req,res)=>{const limit=Math.min(50,Math.max(1,Number(req.query.limit||30)));const unread=String(req.query.unread||"")==="1";const {rows}=await pool.query(`SELECT id,notification_time AS time,title,body,link,read,type FROM notifications WHERE user_id=$1 ${unread?"AND read=false":""} ORDER BY notification_time DESC LIMIT $2`,[req.user.id,limit]);res.json(rows.map(r=>({...r,time:iso(r.time)})));}));
app.post("/notifications/:id/read",authMiddleware,asyncHandler(async(req,res)=>{const r=await pool.query(`UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2 RETURNING id`,[req.params.id,req.user.id]);if(!r.rowCount)throw new HttpError(404,"not_found");res.json({ok:true});}));
app.get("/me/notifications",authMiddleware,asyncHandler(async(req,res)=>{const limit=Math.min(200,Math.max(1,Number(req.query.limit||50)));const {rows}=await pool.query(`SELECT id,notification_time AS time,title,body,link,read,type FROM notifications WHERE user_id=$1 ORDER BY notification_time DESC LIMIT $2`,[req.user.id,limit]);res.json({items:rows.map(r=>({...r,time:iso(r.time)}))});}));
app.post("/me/notifications/read-all",authMiddleware,asyncHandler(async(req,res)=>{await pool.query(`UPDATE notifications SET read=true WHERE user_id=$1 AND read=false`,[req.user.id]);res.json({ok:true});}));
app.post("/push/test",authMiddleware,requireRole("admin"),asyncHandler(async(req,res)=>{await withTransaction(client=>insertNotifications(client,[req.user.id],{title:"Test notification",body:"Push is working ✅",link:"/#/",type:"test",eventKeyBase:`push_test:${Date.now()}`}));notifyAfterCommit([req.user.id],{title:"Test notification",body:"Push is working ✅",link:"/#/"});res.json({ok:true});}));

// ---------- Scanner heartbeat ----------
app.post("/jobs/:id/scanner/heartbeat",authMiddleware,requireRole("pm","admin"),asyncHandler(async(req,res)=>{const lat=Number(req.body?.lat),lng=Number(req.body?.lng);if(!isValidCoord(lat,lng))throw new HttpError(400,"scanner_location_required");const updatedAt=await withTransaction(async client=>{const r=await client.query(`SELECT started_at FROM job_events WHERE job_id=$1 FOR UPDATE`,[req.params.id]);if(!r.rowCount)throw new HttpError(404,"job_not_found");if(!r.rows[0].started_at)throw new HttpError(400,"event_not_started");const t=new Date();await client.query(`UPDATE job_events SET scanner_lat=$2,scanner_lng=$3,scanner_updated_at=$4,updated_at=now() WHERE job_id=$1`,[req.params.id,lat,lng,t]);await addAudit(client,"scanner_heartbeat",{jobId:req.params.id,lat,lng},req);return t.toISOString();});res.json({ok:true,updatedAt});}));
app.get("/jobs/:id/scanner",authMiddleware,asyncHandler(async(req,res)=>{const {rows}=await pool.query(`SELECT started_at,scanner_lat,scanner_lng,scanner_updated_at FROM job_events WHERE job_id=$1`,[req.params.id]);const s=rows[0];if(!s)throw new HttpError(404,"job_not_found");if(!s.started_at)throw new HttpError(400,"event_not_started");if(!s.scanner_updated_at)throw new HttpError(404,"scanner_unknown");res.json({lat:Number(s.scanner_lat),lng:Number(s.scanner_lng),updatedAt:iso(s.scanner_updated_at)});}));

// Stateless no-op compatibility endpoint, now protected.
app.post("/__reset",authMiddleware,requireRole("admin"),(req,res)=>res.json({ok:true,message:"stateless_backend_no_cache_to_reset"}));
app.get("/health",asyncHandler(async(_req,res)=>{const db=await healthCheck();res.json({ok:true,database:"ok",databaseLatencyMs:db.latencyMs,storageConfigured:!!(process.env.SUPABASE_URL&&(process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY)),timeZone:BUSINESS_TIME_ZONE});}));

function listRoutes(appInstance){const out=[];appInstance._router?.stack?.forEach(m=>{if(m.route?.path){const methods=Object.keys(m.route.methods).map(s=>s.toUpperCase());out.push(`${methods.join(",")} ${m.route.path}`);}});return out.sort();}
app.get("/__routes",authMiddleware,requireRole("admin"),(_req,res)=>res.json({routes:listRoutes(app)}));

// ---------- Final error middleware ----------
app.use((err, req, res, _next) => {
  if (res.headersSent) return;
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.error, message: err.message, ...(err.details ? err.details : {}) });
  }
  const pg = postgresErrorResponse(err);
  if (pg) return res.status(pg.status).json(pg.body);
  if (err?.message === "Origin not allowed by CORS") return res.status(403).json({ error: "cors_forbidden" });
  console.error(`[${req.method} ${req.originalUrl}]`, err);
  return res.status(500).json({ error: "internal_server_error", message: "The request could not be completed." });
});

app.listen(PORT, () => {
  console.log(`ATAG server running on http://localhost:${PORT}`);
  console.log("Persistence: normalized PostgreSQL tables; files: Supabase Storage");
});
