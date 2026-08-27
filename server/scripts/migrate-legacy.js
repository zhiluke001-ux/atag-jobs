import { Pool } from "pg";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { ensureBuckets, uploadBuffer } from "../storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OLD_DATABASE_URL = process.env.OLD_DATABASE_URL;
const DATABASE_URL = process.env.DATABASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!OLD_DATABASE_URL || !DATABASE_URL || !SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Missing required migration environment variables: OLD_DATABASE_URL, DATABASE_URL, SUPABASE_URL, SUPABASE_SECRET_KEY");
  process.exit(2);
}
if (OLD_DATABASE_URL === DATABASE_URL) {
  console.error("OLD_DATABASE_URL and DATABASE_URL must point to different databases. The old database is read-only migration source.");
  process.exit(2);
}

const ssl = process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false };
const oldPool = new Pool({ connectionString: OLD_DATABASE_URL, ssl, max: 1 });
const newPool = new Pool({ connectionString: DATABASE_URL, ssl, max: 5 });
const runId = `mig_${new Date().toISOString().replace(/[-:.TZ]/g, "")}_${crypto.randomBytes(3).toString("hex")}`;

const summary = {
  users: 0, jobs: 0, applications: 0, attendance: 0, loadingMembers: 0, earlyCallMembers: 0,
  adjustments: 0, fullTimers: 0, notifications: 0, pushSubscriptions: 0, auditLogs: 0,
  receipts: 0, filesMigrated: 0, filesReused: 0, filesFailed: 0, warnings: 0,
};
const warnings = [];
const failures = [];

function warn(message) { warnings.push(message); summary.warnings++; console.warn("WARN:", message); }
function fail(message) { failures.push(message); summary.filesFailed++; console.error("FILE FAILURE:", message); }
function id(prefix, value) { return `${prefix}_${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 22)}`; }
function lower(v) { return String(v || "").trim().toLowerCase(); }
function isObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
function arr(v) { return Array.isArray(v) ? v : []; }
function asDate(v, fallback = new Date()) { const d = v ? new Date(v) : fallback; return Number.isNaN(d.getTime()) ? fallback : d; }
function legacyBlobId(url) {
  const s = String(url || "").replace(/^https?:\/\/[^/]+/i, "").split("?")[0];
  return s.match(/^\/blob\/([a-z0-9_-]+)/i)?.[1] || null;
}
function extFromMime(mime) { return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"; }
function storageRef(bucket, objectPath) { return `storage://${bucket}/${objectPath}`; }
function normalizeRole(r) { return ["part-timer","pm","admin"].includes(String(r)) ? String(r) : "part-timer"; }
function normalizeGrade(g) { const x=String(g||"junior").toLowerCase().replace(/\s+/g,"_"); return ["junior","senior","lead","junior_emcee","senior_emcee"].includes(x)?x:"junior"; }
function normalizeVerificationStatus(v, verified) { const x=String(v || (verified ? "APPROVED" : "PENDING")).toUpperCase(); return ["PENDING","APPROVED","REJECTED"].includes(x) ? x : (verified ? "APPROVED" : "PENDING"); }
function deadlineFromLegacy(job) {
  const raw = job.applicationDeadline ?? job.applyDueDate;
  if (!raw) return null;
  const s = String(raw).trim();
  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T23:59:59+08:00` : (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s) ? `${s}+08:00` : s);
  const d = new Date(candidate);
  return Number.isNaN(d.getTime()) ? null : d;
}

function validateLegacy(db) {
  const issues = [];
  if (!isObject(db)) return ["kv.v is not an object"];
  for (const key of ["users","jobs"]) if (db[key] != null && !Array.isArray(db[key])) issues.push(`${key} is not an array`);
  const users = arr(db.users), jobs = arr(db.jobs);
  const seenIds = new Set(), seenEmails = new Set(), seenUsernames = new Set();
  for (let i=0;i<users.length;i++) {
    const u=users[i]||{};
    if (!u.id) issues.push(`users[${i}] missing id`); else if (seenIds.has(String(u.id))) issues.push(`duplicate user id: ${u.id}`); else seenIds.add(String(u.id));
    if (!u.email) issues.push(`user ${u.id||i} missing email`); else if (seenEmails.has(lower(u.email))) issues.push(`duplicate email: ${u.email}`); else seenEmails.add(lower(u.email));
    const effectiveUsername = u.username || (u.email ? String(u.email).split("@")[0] : "");
    if (!effectiveUsername) issues.push(`user ${u.id||i} missing username/email-derived username`);
    else if (seenUsernames.has(lower(effectiveUsername))) issues.push(`duplicate username: ${effectiveUsername}`);
    else seenUsernames.add(lower(effectiveUsername));
    if (!u.passwordHash) warn(`user ${u.id||i} has no passwordHash; migration will assign an unusable placeholder and password reset will be required`);
  }
  const requireUser = (uid, context) => {
    if (!uid) issues.push(`${context}: missing user id`);
    else if (!seenIds.has(String(uid))) issues.push(`${context}: references missing user ${uid}`);
  };
  const jobIds=new Set(), receiptIds=new Set();
  for (let i=0;i<jobs.length;i++) {
    const j=jobs[i]||{};
    if (!j.id) issues.push(`jobs[${i}] missing id`); else if(jobIds.has(String(j.id))) issues.push(`duplicate job id: ${j.id}`); else jobIds.add(String(j.id));
    if (!j.title) issues.push(`job ${j.id||i}: missing title`);
    if (!j.startTime) issues.push(`job ${j.id||i}: missing startTime`);
    else if (Number.isNaN(new Date(j.startTime).getTime())) issues.push(`job ${j.id||i}: malformed startTime`);
    if (!j.endTime) issues.push(`job ${j.id||i}: missing endTime`);
    else if (Number.isNaN(new Date(j.endTime).getTime())) issues.push(`job ${j.id||i}: malformed endTime`);
    const seenApps=new Set();
    for (const a of arr(j.applications)) {
      requireUser(a?.userId, `job ${j.id}: application`);
      if (a?.userId && seenApps.has(String(a.userId))) issues.push(`job ${j.id}: duplicate application for user ${a.userId}`);
      if (a?.userId) seenApps.add(String(a.userId));
    }
    for (const uid of [...arr(j.approved),...arr(j.rejected)]) requireUser(uid, `job ${j.id}: status list`);
    for (const uid of Object.keys(isObject(j.attendance)?j.attendance:{})) requireUser(uid, `job ${j.id}: attendance`);
    const lu=isObject(j.loadingUnload)?j.loadingUnload:{};
    for(const uid of [...arr(lu.applicants),...arr(lu.participants)]) requireUser(uid, `job ${j.id}: loading/unloading`);
    const ec=isObject(j.earlyCall)?j.earlyCall:{};
    for(const uid of [...arr(ec.applicants),...arr(ec.participants)]) requireUser(uid, `job ${j.id}: early-call`);
    for(const uid of Object.keys(isObject(j.adjustments)?j.adjustments:{})) requireUser(uid, `job ${j.id}: adjustment`);
    for(const ft of arr(j.fullTimers)) requireUser(ft?.userId, `job ${j.id}: full-timer`);
    for(const r of arr(j.parkingReceipts)) {
      requireUser(r?.userId, `job ${j.id}: parking receipt ${r?.id||"(no id)"}`);
      if(!r?.id) issues.push(`job ${j.id}: parking receipt missing id`);
      else if(receiptIds.has(String(r.id))) issues.push(`duplicate parking receipt id: ${r.id}`);
      else receiptIds.add(String(r.id));
      if(!r?.photoUrl) issues.push(`job ${j.id}: parking receipt ${r?.id||"(no id)"} missing photoUrl`);
    }
  }
  for(const uid of Object.keys(isObject(db.notifications)?db.notifications:{})) requireUser(uid, "notifications");
  for(const uid of Object.keys(isObject(db.pushSubs)?db.pushSubs:{})) requireUser(uid, "push subscriptions");
  return [...new Set(issues)];
}

const blobUse = new Map();
function markBlob(url, kind, ownerUserId, jobId) {
  const bid=legacyBlobId(url); if(!bid) return;
  const prev=blobUse.get(bid);
  if(prev && prev.kind!==kind) warn(`legacy blob ${bid} is referenced as both ${prev.kind} and ${kind}; first mapping kept`);
  else blobUse.set(bid,{kind,ownerUserId,jobId});
}

async function migrateBlob(db, bid) {
  const use=blobUse.get(bid)||{};
  const blob=db.blobs?.[bid];
  if(!blob){fail(`Referenced legacy blob ${bid} is missing from db.blobs`);return null;}
  const kind=use.kind||blob.meta?.kind;
  const bucket=kind==="avatar"?"avatars":kind==="verification"?"verification-photos":kind==="parking-receipt"?"parking-receipts":null;
  if(!bucket){fail(`Cannot determine bucket for legacy blob ${bid} (kind=${kind||"unknown"})`);return null;}
  const mime=String(blob.mime||"image/jpeg");
  let buffer;try{buffer=Buffer.from(String(blob.b64||""),"base64");}catch{buffer=null;}
  if(!buffer?.length){fail(`Legacy blob ${bid} has empty/invalid base64`);return null;}
  const objectPath=`legacy/${bid}.${extFromMime(mime)}`;
  const previous=await newPool.query(`SELECT bucket,storage_path FROM legacy_blob_migrations WHERE legacy_blob_id=$1`,[bid]);
  if(previous.rowCount){summary.filesReused++;return storageRef(previous.rows[0].bucket,previous.rows[0].storage_path);}
  try {
    await uploadBuffer(buffer,{bucket,objectPath,contentType:mime,upsert:true});
  } catch (error) {
    fail(`Upload ${bid} -> ${bucket}/${objectPath} failed: ${error.message}`);return null;
  }
  await newPool.query(`INSERT INTO legacy_blob_migrations(legacy_blob_id,bucket,storage_path,mime_type,byte_size) VALUES($1,$2,$3,$4,$5) ON CONFLICT(legacy_blob_id) DO UPDATE SET bucket=EXCLUDED.bucket,storage_path=EXCLUDED.storage_path,mime_type=EXCLUDED.mime_type,byte_size=EXCLUDED.byte_size,migrated_at=now()`,[bid,bucket,objectPath,mime,buffer.length]);
  summary.filesMigrated++;
  return storageRef(bucket,objectPath);
}

const migratedRefs=new Map();
async function convertFileRef(db, ref, expectedKind, ownerUserId, jobId) {
  if(!ref) return null;
  const s=String(ref);
  if(s.startsWith("storage://")) return s;
  const bid=legacyBlobId(s);
  if(bid){markBlob(s,expectedKind,ownerUserId,jobId);if(migratedRefs.has(bid))return migratedRefs.get(bid);const converted=await migrateBlob(db,bid);if(converted)migratedRefs.set(bid,converted);return converted;}
  if(/^\/uploads\//.test(s) || /^data:image\//.test(s)){fail(`Legacy file reference cannot be read from old PostgreSQL alone: ${s.slice(0,120)}`);return null;}
  if(/^https?:\/\//i.test(s)){warn(`External image URL preserved instead of uploaded: ${s}`);return s;}
  warn(`Unknown file reference preserved: ${s}`);return s;
}

async function main() {
  console.log(`Migration run ${runId}`);
  console.log("1/8 Reading legacy kv row (READ ONLY)...");
  const legacy=await oldPool.query(`SELECT v FROM kv WHERE k='db'`);
  if(!legacy.rowCount)throw new Error("Legacy kv row k='db' was not found.");
  const db=legacy.rows[0].v;
  const validation=validateLegacy(db);
  if(validation.length){console.error("Legacy validation failed:");validation.forEach(x=>console.error(" -",x));throw new Error(`Legacy validation found ${validation.length} blocking issue(s). No new data was imported.`);}

  console.log("2/8 Applying normalized schema to destination...");
  const schema=await fs.readFile(path.join(__dirname,"..","db","schema.sql"),"utf8");await newPool.query(schema);
  await newPool.query(`INSERT INTO migration_runs(id,status,summary) VALUES($1,'running',$2)`,[runId,{}]);
  console.log("3/8 Ensuring Supabase Storage buckets...");await ensureBuckets();

  for(const u of arr(db.users)){markBlob(u.avatarUrl,"avatar",u.id,null);markBlob(u.verificationPhotoUrl,"verification",u.id,null);}
  for(const j of arr(db.jobs))for(const r of arr(j.parkingReceipts))markBlob(r?.photoUrl,"parking-receipt",r?.userId,j.id);
  console.log(`4/8 Migrating ${blobUse.size} referenced Base64 file(s)...`);
  for(const bid of blobUse.keys())await migrateBlob(db,bid);

  console.log("5/8 Migrating users and configuration...");
  const config=isObject(db.config)?db.config:{};
  if(config.rates)await newPool.query(`INSERT INTO app_config(key,value) VALUES('rates',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,[config.rates]);
  if(config.roleRatesDefaults)await newPool.query(`INSERT INTO app_config(key,value) VALUES('roleRatesDefaults',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,[config.roleRatesDefaults]);
  if(config.scanMaxDistanceMeters!=null)await newPool.query(`INSERT INTO app_config(key,value) VALUES('scanMaxDistanceMeters',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,[config.scanMaxDistanceMeters]);
  const topExtra=Object.fromEntries(Object.entries(db).filter(([k])=>!["config","users","jobs","audit","notifications","pushSubs","blobs","blobOrder"].includes(k)));
  if(Object.keys(topExtra).length)await newPool.query(`INSERT INTO app_config(key,value) VALUES('legacyExtra',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,[topExtra]);

  for(const u of arr(db.users)){
    const avatar=await convertFileRef(db,u.avatarUrl,"avatar",u.id,null);const verification=await convertFileRef(db,u.verificationPhotoUrl,"verification",u.id,null);
    const username=u.username||String(u.email||`user_${u.id}`).split("@")[0];
    await newPool.query(`INSERT INTO users(id,email,username,name,role,grade,password_hash,phone,discord,avatar_path,verified,verification_status,verification_photo_path,verified_at,verified_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NULL) ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,username=EXCLUDED.username,name=EXCLUDED.name,role=EXCLUDED.role,grade=EXCLUDED.grade,password_hash=EXCLUDED.password_hash,phone=EXCLUDED.phone,discord=EXCLUDED.discord,avatar_path=EXCLUDED.avatar_path,verified=EXCLUDED.verified,verification_status=EXCLUDED.verification_status,verification_photo_path=EXCLUDED.verification_photo_path,verified_at=EXCLUDED.verified_at,updated_at=now()`,[String(u.id),String(u.email),String(username),String(u.name||username),normalizeRole(u.role),normalizeGrade(u.grade),String(u.passwordHash||`MIGRATION_RESET_REQUIRED$${crypto.randomBytes(20).toString("hex")}`),String(u.phone||""),String(u.discord||""),avatar,!!(u.verified??true),normalizeVerificationStatus(u.verificationStatus, !!(u.verified??true)),verification,u.verifiedAt?asDate(u.verifiedAt):null]);summary.users++;
    if(u.resetToken?.token&&u.resetToken?.expiresAt){await newPool.query(`INSERT INTO password_reset_tokens(token_hash,user_id,expires_at) VALUES($1,$2,$3) ON CONFLICT(token_hash) DO NOTHING`,[crypto.createHash("sha256").update(String(u.resetToken.token)).digest("hex"),String(u.id),asDate(u.resetToken.expiresAt)]);}
  }
  for(const u of arr(db.users))if(u.verifiedBy){await newPool.query(`UPDATE users SET verified_by=$2 WHERE id=$1 AND EXISTS(SELECT 1 FROM users WHERE id=$2)`,[String(u.id),String(u.verifiedBy)]);}

  console.log("6/8 Migrating jobs and operational records...");
  const knownJob=new Set(["id","title","venue","description","startTime","endTime","applicationDeadline","applyDueDate","status","headcount","transportOptions","rate","roleCounts","roleRates","session","breakEnabled","applications","approved","rejected","attendance","loadingUnload","earlyCall","adjustments","fullTimers","parkingReceipts","events"]);
  const legacyUsersById = new Map(arr(db.users).map(u => [String(u.id), u]));
  for(const j of arr(db.jobs)){
    const extra=Object.fromEntries(Object.entries(j).filter(([k])=>!knownJob.has(k)));
    const start=asDate(j.startTime),end=asDate(j.endTime,start);if(end<start)warn(`job ${j.id}: endTime before startTime; using startTime as endTime`);
    await newPool.query(`INSERT INTO jobs(id,title,venue,description,start_time,end_time,application_deadline,status,headcount,transport_options,rate,role_counts,role_rates,session,break_enabled,extra) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,venue=EXCLUDED.venue,description=EXCLUDED.description,start_time=EXCLUDED.start_time,end_time=EXCLUDED.end_time,application_deadline=EXCLUDED.application_deadline,status=EXCLUDED.status,headcount=EXCLUDED.headcount,transport_options=EXCLUDED.transport_options,rate=EXCLUDED.rate,role_counts=EXCLUDED.role_counts,role_rates=EXCLUDED.role_rates,session=EXCLUDED.session,break_enabled=EXCLUDED.break_enabled,extra=EXCLUDED.extra,updated_at=now()`,[String(j.id),String(j.title||"Untitled"),String(j.venue||""),String(j.description||""),start,end<start?start:end,deadlineFromLegacy(j),String(j.status||"upcoming"),Math.max(0,Number(j.headcount||0)),isObject(j.transportOptions)?j.transportOptions:{bus:true,own:true},isObject(j.rate)?j.rate:{},isObject(j.roleCounts)?j.roleCounts:{},isObject(j.roleRates)?j.roleRates:{},isObject(j.session)?j.session:{},!!j.breakEnabled,extra]);summary.jobs++;
    const lu=isObject(j.loadingUnload)?j.loadingUnload:{};await newPool.query(`INSERT INTO job_loading_config(job_id,enabled,quota,price,closed) VALUES($1,$2,$3,$4,$5) ON CONFLICT(job_id) DO UPDATE SET enabled=EXCLUDED.enabled,quota=EXCLUDED.quota,price=EXCLUDED.price,closed=EXCLUDED.closed,updated_at=now()`,[String(j.id),!!lu.enabled||Number(lu.quota||0)>0,Math.max(0,Number(lu.quota||0)),Number(lu.price||config.rates?.loadingUnloading?.amount||0),!!lu.closed]);
    const ec=isObject(j.earlyCall)?j.earlyCall:{};await newPool.query(`INSERT INTO job_early_call_config(job_id,enabled,amount,threshold_hours) VALUES($1,$2,$3,$4) ON CONFLICT(job_id) DO UPDATE SET enabled=EXCLUDED.enabled,amount=EXCLUDED.amount,threshold_hours=EXCLUDED.threshold_hours,updated_at=now()`,[String(j.id),!!ec.enabled,Number(ec.amount||config.rates?.earlyCall?.defaultAmount||0),Number(ec.thresholdHours||config.rates?.earlyCall?.thresholdHours||0)]);
    const ev=isObject(j.events)?j.events:{};await newPool.query(`INSERT INTO job_events(job_id,started_at,ended_at,scanner_lat,scanner_lng,scanner_updated_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(job_id) DO UPDATE SET started_at=EXCLUDED.started_at,ended_at=EXCLUDED.ended_at,scanner_lat=EXCLUDED.scanner_lat,scanner_lng=EXCLUDED.scanner_lng,scanner_updated_at=EXCLUDED.scanner_updated_at,updated_at=now()`,[String(j.id),ev.startedAt?asDate(ev.startedAt):null,ev.endedAt?asDate(ev.endedAt):null,ev.scanner?.lat??null,ev.scanner?.lng??null,ev.scanner?.updatedAt?asDate(ev.scanner.updatedAt):null]);
    const approved=new Set(arr(j.approved).map(String)),rejected=new Set(arr(j.rejected).map(String));
    const legacyApps = new Map(arr(j.applications).map(a => [String(a.userId), a]));
    for (const uid of new Set([...approved, ...rejected])) {
      if (!legacyApps.has(uid)) {
        const u = legacyUsersById.get(uid) || {};
        warn(`job ${j.id}: ${uid} is in approved/rejected list but missing from applications; synthesizing application row to preserve status`);
        legacyApps.set(uid, { userId: uid, email: u.email || "", transport: "Own Transport", appliedAt: j.createdAt || j.startTime });
      }
    }
    for(const a of legacyApps.values()){
      const uid=String(a.userId);const status=approved.has(uid)?"approved":rejected.has(uid)?"rejected":"applied";const wants=arr(lu.applicants).map(String).includes(uid);
      await newPool.query(`INSERT INTO job_applications(job_id,user_id,email_snapshot,transport,status,wants_loading,applied_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7) ON CONFLICT(job_id,user_id) DO UPDATE SET email_snapshot=EXCLUDED.email_snapshot,transport=EXCLUDED.transport,status=EXCLUDED.status,wants_loading=EXCLUDED.wants_loading,applied_at=EXCLUDED.applied_at,updated_at=now()`,[String(j.id),uid,String(a.email||legacyUsersById.get(uid)?.email||""),String(a.transport||"Own Transport"),status,wants,a.appliedAt?asDate(a.appliedAt):asDate(j.startTime)]);summary.applications++;
    }
    for(const [uid,r] of Object.entries(isObject(j.attendance)?j.attendance:{})){await newPool.query(`INSERT INTO job_attendance(job_id,user_id,in_at,out_at,break_in_at,break_out_at,late_minutes,break_minutes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(job_id,user_id) DO UPDATE SET in_at=EXCLUDED.in_at,out_at=EXCLUDED.out_at,break_in_at=EXCLUDED.break_in_at,break_out_at=EXCLUDED.break_out_at,late_minutes=EXCLUDED.late_minutes,break_minutes=EXCLUDED.break_minutes,updated_at=now()`,[String(j.id),String(uid),r?.in?asDate(r.in):null,r?.out?asDate(r.out):null,r?.breakIn?asDate(r.breakIn):null,r?.breakOut?asDate(r.breakOut):null,Number(r?.lateMinutes||0),Number(r?.breakMinutes||0)]);summary.attendance++;}
    const luUsers=new Set([...arr(lu.applicants),...arr(lu.participants)].map(String));for(const uid of luUsers){await newPool.query(`INSERT INTO job_loading_members(job_id,user_id,applied,present) VALUES($1,$2,$3,$4) ON CONFLICT(job_id,user_id) DO UPDATE SET applied=EXCLUDED.applied,present=EXCLUDED.present,updated_at=now()`,[String(j.id),uid,arr(lu.applicants).map(String).includes(uid),arr(lu.participants).map(String).includes(uid)]);summary.loadingMembers++;}
    const ecUsers=new Set([...arr(ec.applicants),...arr(ec.participants)].map(String));for(const uid of ecUsers){await newPool.query(`INSERT INTO job_early_call_members(job_id,user_id,applied,present) VALUES($1,$2,$3,$4) ON CONFLICT(job_id,user_id) DO UPDATE SET applied=EXCLUDED.applied,present=EXCLUDED.present,updated_at=now()`,[String(j.id),uid,arr(ec.applicants).map(String).includes(uid),arr(ec.participants).map(String).includes(uid)]);summary.earlyCallMembers++;}
    for(const [uid,list] of Object.entries(isObject(j.adjustments)?j.adjustments:{})){for(let ix=0;ix<arr(list).length;ix++){const x=list[ix]||{};const aid=id("adj",`${j.id}:${uid}:${ix}:${x.ts||""}:${x.amount||0}:${x.reason||""}`);await newPool.query(`INSERT INTO job_adjustments(id,job_id,user_id,amount,reason,adjustment_time,by_user_id,by_email) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET amount=EXCLUDED.amount,reason=EXCLUDED.reason,adjustment_time=EXCLUDED.adjustment_time,by_user_id=EXCLUDED.by_user_id,by_email=EXCLUDED.by_email`,[aid,String(j.id),String(uid),Number(x.amount||0),String(x.reason||""),x.ts?asDate(x.ts):new Date(),x.by?.id||null,x.by?.email||null]);summary.adjustments++;}}
    for(const ft of arr(j.fullTimers)){if(!ft?.userId)continue;await newPool.query(`INSERT INTO job_full_timers(job_id,user_id,role,data) VALUES($1,$2,$3,$4) ON CONFLICT(job_id,user_id) DO UPDATE SET role=EXCLUDED.role,data=EXCLUDED.data`,[String(j.id),String(ft.userId),String(ft.role||ft.type||ft.grade||"junior"),ft]);summary.fullTimers++;}
    for(const r of arr(j.parkingReceipts)){if(!r?.id||!r?.userId)continue;const fileRef=await convertFileRef(db,r.photoUrl,"parking-receipt",r.userId,j.id);if(!fileRef){fail(`Receipt ${r.id} for job ${j.id} has no successfully migrated file`);continue;}await newPool.query(`INSERT INTO parking_receipts(id,job_id,user_id,email_snapshot,amount,note,storage_path,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET amount=EXCLUDED.amount,note=EXCLUDED.note,storage_path=EXCLUDED.storage_path,status=EXCLUDED.status`,[String(r.id),String(j.id),String(r.userId),String(r.email||""),r.amount==null||r.amount===""?null:Number(r.amount),String(r.note||""),fileRef,String(r.status||"SUBMITTED"),r.createdAt?asDate(r.createdAt):new Date()]);summary.receipts++;}
  }

  console.log("7/8 Migrating notifications, push subscriptions and audit logs...");
  for(const [uid,list] of Object.entries(isObject(db.notifications)?db.notifications:{})){for(let ix=0;ix<arr(list).length;ix++){const n=list[ix]||{};const nid=id("nlegacy",`${uid}:${n.id||ix}`);await newPool.query(`INSERT INTO notifications(id,user_id,notification_time,title,body,link,read,type) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET read=EXCLUDED.read`,[nid,String(uid),n.time?asDate(n.time):new Date(),String(n.title||""),String(n.body||""),n.link||null,!!n.read,String(n.type||"info")]);summary.notifications++;}}
  for(const [uid,list] of Object.entries(isObject(db.pushSubs)?db.pushSubs:{})){for(const sub of arr(list)){if(!sub?.endpoint)continue;await newPool.query(`INSERT INTO push_subscriptions(user_id,endpoint,subscription) VALUES($1,$2,$3) ON CONFLICT(user_id,endpoint) DO UPDATE SET subscription=EXCLUDED.subscription,updated_at=now()`,[String(uid),String(sub.endpoint),sub]);summary.pushSubscriptions++;}}
  for(let ix=0;ix<arr(db.audit).length;ix++){const a=db.audit[ix]||{};const aid=String(a.id||id("alegacy",`${ix}:${a.time||""}:${a.action||""}`));await newPool.query(`INSERT INTO audit_logs(id,audit_time,actor,role,action,details) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING`,[aid,a.time?asDate(a.time):new Date(),String(a.actor||"guest"),String(a.role||"guest"),String(a.action||"legacy"),isObject(a.details)?a.details:{}]);summary.auditLogs++;}

  console.log("8/8 Verification counts...");
  const counts={};for(const [name,table] of Object.entries({users:"users",jobs:"jobs",applications:"job_applications",attendance:"job_attendance",notifications:"notifications",receipts:"parking_receipts",auditLogs:"audit_logs"})){const r=await newPool.query(`SELECT count(*)::int n FROM ${table}`);counts[name]=r.rows[0].n;}
  summary.destinationCounts=counts;summary.failures=failures;summary.warningMessages=warnings;
  const status=failures.length?"failed_files":"completed";
  await newPool.query(`UPDATE migration_runs SET finished_at=now(),status=$2,summary=$3 WHERE id=$1`,[runId,status,summary]);
  console.log("\n=== Migration summary ===");
  console.log(`Users migrated: ${summary.users}`);console.log(`Jobs migrated: ${summary.jobs}`);console.log(`Applications migrated: ${summary.applications}`);console.log(`Attendance records migrated: ${summary.attendance}`);console.log(`Notifications migrated: ${summary.notifications}`);console.log(`Parking receipts migrated: ${summary.receipts}`);console.log(`Files migrated: ${summary.filesMigrated}`);console.log(`Files reused: ${summary.filesReused}`);console.log(`Files failed: ${summary.filesFailed}`);console.log("Destination counts:",counts);
  if(failures.length){console.error("\nMigration has file failures. DO NOT cut over production until these are resolved.");process.exitCode=1;}
}

try{await main();}catch(err){console.error("\nMIGRATION FAILED:",err?.stack||err);try{await newPool.query(`UPDATE migration_runs SET finished_at=now(),status='failed',summary=$2 WHERE id=$1`,[runId,{...summary,error:String(err?.message||err),failures,warnings}]);}catch{}process.exitCode=1;}finally{await Promise.allSettled([oldPool.end(),newPool.end()]);}
