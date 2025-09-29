import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createClient } from 'redis';
import { randomUUID } from 'crypto';
import { SignJWT, jwtVerify, generateKeyPair, exportJWK, importPKCS8, importSPKI } from 'jose';
import { PrismaClient, Role, AssignmentStatus, TransportMode } from '@prisma/client';
import { google } from 'googleapis';

const app = express();
app.use(express.json());
app.use(cookieParser());

// CORS (dev permissive; prod restricts by WEB_URL)
app.use(
  cors({
    origin: (origin, cb) => {
      const web = process.env.WEB_URL;
      if (process.env.NODE_ENV === 'production' && web) {
        if (!origin || origin === web) return cb(null, true);
        return cb(null, false);
      }
      return cb(null, true);
    },
    credentials: true,
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','x-csrf-token','x-user-id','Authorization']
  })
);

const prisma = new PrismaClient();
const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS || '21600');
const TOKEN_TTL_SECONDS   = Number(process.env.QR_TOKEN_TTL_SECONDS || '60');
const NODE_ENV = process.env.NODE_ENV || 'development';

// ===== JWT keys =====
let privateKey: CryptoKey;
let publicKey: CryptoKey;
let publicJwk: any;

async function initKeys() {
  const pkcs8 = (process.env.JWT_PRIVATE_KEY || '').trim();
  const spki  = (process.env.JWT_PUBLIC_KEY  || '').trim();

  if (pkcs8 && spki && pkcs8.includes('BEGIN') && spki.includes('BEGIN')) {
    try {
      privateKey = await importPKCS8(pkcs8, 'EdDSA');
      publicKey  = await importSPKI(spki, 'EdDSA');
      console.log('[JWT] Using keys from env.');
      return;
    } catch (e:any) {
      console.warn('[JWT] Failed to import env keys; generating DEV keys:', e?.message || e);
    }
  }
  const pair = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
  privateKey = pair.privateKey;
  publicKey  = pair.publicKey;
  publicJwk  = await exportJWK(publicKey);
  console.log('[JWT] DEV keys generated. Public JWK:', JSON.stringify(publicJwk));
}
const ttl = (sec:number) => ({ EX: sec });

// ===== auth context =====
declare global {
  namespace Express {
    interface Request {
      authUser?: { id:string; role:Role; name:string; email:string } | null;
    }
  }
}
app.use(async (req,_res,next)=>{
  const uid = req.cookies?.uid as string | undefined;
  if (uid) {
    try {
      const u = await prisma.user.findUnique({ where: { id: uid } });
      req.authUser = u ? { id: u.id, role: u.role, name: u.name, email: u.email } : null;
    } catch { req.authUser = null; }
  } else req.authUser = null;
  next();
});

// ===== CSRF (strict in prod) =====
const CSRF_PREFIX = 'csrf:';
async function ensureCsrf(uid:string){ const k=`${CSRF_PREFIX}${uid}`; const e=await redis.get(k); if(e) return e; const t=randomUUID(); await redis.set(k,t,ttl(SESSION_TTL_SECONDS)); return t; }
async function getCsrf(uid:string){ return (await redis.get(`${CSRF_PREFIX}${uid}`)) || null; }
function requireCsrf(){
  return async (req:express.Request,res:express.Response,next:express.NextFunction)=>{
    if (NODE_ENV!=='production') return next();
    const uid = req.cookies?.uid as string|undefined;
    if(!uid) return res.status(401).json({error:'unauthorized'});
    const expected = await getCsrf(uid);
    const sent = (req.header('x-csrf-token')||'').trim();
    if(!expected || !sent || sent!==expected) return res.status(403).json({error:'csrf_invalid'});
    next();
  };
}

// ===== AUTH =====
app.post('/auth/login', async (req,res)=>{
  const { email } = req.body || {};
  if(!email) return res.status(400).json({ error: 'email required' });
  const u = await prisma.user.findUnique({ where: { email } });
  if(!u) return res.status(404).json({ error: 'user_not_found' });
  res.cookie('uid', u.id, { httpOnly:true, sameSite:'lax', secure: NODE_ENV==='production', maxAge:7*24*3600*1000 });
  try { await ensureCsrf(u.id); } catch {}
  res.json({ ok:true, user: { id:u.id, name:u.name, role:u.role, email:u.email } });
});
app.post('/auth/logout', requireCsrf(), async (req,res)=>{
  const uid = req.cookies?.uid as string|undefined;
  if (uid) try { await redis.del(`${CSRF_PREFIX}${uid}`); } catch {}
  res.clearCookie('uid'); res.json({ ok:true });
});
app.get('/auth/me', async (req,res)=>{ if(!req.authUser) return res.status(401).json({ user:null }); res.json({ user:req.authUser }); });
app.get('/auth/csrf', async (req,res)=>{ if(!req.authUser) return res.status(401).json({error:'unauthorized'}); res.json({ token: await ensureCsrf(req.authUser.id) }); });

// ===== Devices (optional) =====
app.post('/devices/register', async (req,res)=>{
  if(!req.authUser) return res.status(401).json({error:'unauthorized'});
  const { label } = req.body || {};
  const dev = await prisma.device.create({ data:{ userId:req.authUser.id, kind:'PM_SCANNER', label: label || 'Scanner' } });
  res.json({ deviceId: dev.id });
});

// ===== Jobs: public =====
app.get('/jobs', async (_req,res)=>{
  const jobs = await prisma.job.findMany({ where:{ status:'PUBLISHED' }, orderBy:{ createdAt:'desc' } });
  res.json(jobs);
});
app.get('/jobs/:id', async (req,res)=>{
  const job = await prisma.job.findUnique({ where:{ id:String(req.params.id) } });
  if(!job) return res.status(404).json({ error:'not_found' });
  res.json(job);
});

// ===== Admin/PM helpers =====
function mustAdminPM(req:express.Request,res:express.Response){ if(!req.authUser || (req.authUser.role!=='PM' && req.authUser.role!=='ADMIN')) { res.status(403).json({error:'forbidden'}); return false; } return true; }

app.post('/jobs', requireCsrf(), async (req,res)=>{
  if(!mustAdminPM(req,res)) return;
  const { title, venue, dateISO, callTimeISO, endTimeISO, jobType, headcountTarget,
    lat, lng, callGraceMins, baseHourly, minCallHours, otAfterHours, otMultiplier,
    breakMinutes, ownTransportAllowance, createSheet } = req.body || {};

  const job = await prisma.job.create({
    data: {
      title, venue, date: new Date(dateISO), callTimeUtc: new Date(callTimeISO),
      endTimeUtc: endTimeISO ? new Date(endTimeISO) : null, jobType,
      headcountTarget: headcountTarget ?? 0, status: 'PUBLISHED', createdBy: req.authUser!.id,
      callGraceMins: callGraceMins ?? 15, lat: lat ?? null, lng: lng ?? null,
      baseHourly: baseHourly ?? 12, minCallHours: minCallHours ?? 4, otAfterHours: otAfterHours ?? 8,
      otMultiplier: otMultiplier ?? 1.5, breakMinutes: breakMinutes ?? 0, ownTransportAllowance: ownTransportAllowance ?? 0
    }
  });

  await prisma.auditLog.create({ data:{ actorId:req.authUser!.id, jobId:job.id, action:'JOB_CREATE', entity:'Job', entityId:job.id, after: JSON.stringify(job) } });

  if (createSheet) {
    try {
      const sheetId = await createJobSheet(job);
      await prisma.job.update({ where:{id:job.id}, data:{ sheetId } });
    } catch(e:any){ console.warn('[sheets] create failed:', e?.message||e); }
  }

  res.json({ ok:true, job });
});

app.patch('/jobs/:id', requireCsrf(), async (req,res)=>{
  if(!mustAdminPM(req,res)) return;
  const { id } = req.params;
  const before = await prisma.job.findUnique({ where:{ id } });
  if(!before) return res.status(404).json({error:'not_found'});
  const up = await prisma.job.update({ where:{ id }, data: req.body || {} });
  await prisma.auditLog.create({ data:{ actorId:req.authUser!.id, jobId:id, action:'JOB_UPDATE', entity:'Job', entityId:id, before: JSON.stringify(before), after: JSON.stringify(up) } });
  res.json({ ok:true, job: up });
});

// ===== Part-timer: my assignments =====
app.get('/me/assignments', async (req,res)=>{
  if(!req.authUser || req.authUser.role!=='PART_TIMER') return res.status(403).json({ error:'forbidden' });
  const asns = await prisma.assignment.findMany({
    where:{ userId:req.authUser.id },
    include:{ job:true },
    orderBy:{ createdAt:'desc' }
  });
  const rows = asns.map(a=>({
    id:a.id, status:a.status, transport:a.transport, roleName:a.roleName, approvedAt:a.approvedAt,
    job:{ id:a.job.id, title:a.job.title, venue:a.job.venue, callTimeUtc:a.job.callTimeUtc, endTimeUtc:a.job.endTimeUtc, jobType:a.job.jobType, status:a.job.status }
  }));
  res.json(rows);
});

// Apply / approve / reject
app.post('/jobs/:id/apply', requireCsrf(), async (req,res)=>{
  if(!req.authUser || req.authUser.role!=='PART_TIMER') return res.status(403).json({ error:'forbidden' });
  const { id } = req.params;
  const { roleName, transport } = req.body || {};
  try {
    const existing = await prisma.assignment.findFirst({ where: { jobId:id, userId:req.authUser.id } });
    if (existing) {
      if (['WITHDRAWN','REJECTED'].includes(existing.status)) {
        const upd = await prisma.assignment.update({
          where:{ id:existing.id },
          data:{ status:'APPLIED', roleName: roleName||existing.roleName, transport: (transport==='ATAG_BUS'?'ATAG_BUS':'OWN') as TransportMode, approvedBy:null, approvedAt:null }
        });
        return res.json({ ok:true, assignmentId:upd.id });
      }
      return res.json({ ok:true, assignmentId:existing.id });
    }
    const created = await prisma.assignment.create({
      data:{ userId:req.authUser.id, jobId:id, roleName: roleName||'Worker', status:'APPLIED', transport: transport==='ATAG_BUS'?'ATAG_BUS':'OWN' }
    });
    res.json({ ok:true, assignmentId:created.id });
  } catch(e:any){ res.status(500).json({ error:e?.message||'apply_failed' }); }
});

app.get('/jobs/:id/applicants', async (req,res)=>{
  if(!req.authUser || (req.authUser.role!=='PM' && req.authUser.role!=='ADMIN')) return res.status(403).json({ error:'forbidden' });
  const { id } = req.params;
  const asns = await prisma.assignment.findMany({ where:{ jobId:id }, include:{ user:true }, orderBy:{ approvedAt:'desc' } });
  const rows = asns.map(a=>({ id:a.id, userId:a.userId, name:a.user.name, email:a.user.email, roleName:a.roleName, transport:a.transport, status:a.status, approvedBy:a.approvedBy||null, approvedAt:a.approvedAt||null }));
  res.json(rows);
});

app.post('/jobs/:id/approve', requireCsrf(), async (req,res)=>{
  if(!req.authUser || (req.authUser.role!=='PM' && req.authUser.role!=='ADMIN')) return res.status(403).json({ error:'forbidden' });
  const { assignmentId } = req.body || {};
  if(!assignmentId) return res.status(400).json({ error:'assignmentId required' });
  const upd = await prisma.assignment.update({ where:{ id:String(assignmentId) }, data:{ status:'APPROVED', approvedBy:req.authUser.id, approvedAt:new Date() } });
  await prisma.auditLog.create({ data:{ actorId:req.authUser!.id, jobId:upd.jobId, action:'ASSIGN_APPROVE', entity:'Assignment', entityId:upd.id, after: JSON.stringify(upd) } });
  res.json({ ok:true, assignmentId:upd.id });
});
app.post('/jobs/:id/reject', requireCsrf(), async (req,res)=>{
  if(!req.authUser || (req.authUser.role!=='PM' && req.authUser.role!=='ADMIN')) return res.status(403).json({ error:'forbidden' });
  const { assignmentId } = req.body || {};
  if(!assignmentId) return res.status(400).json({ error:'assignmentId required' });
  const upd = await prisma.assignment.update({ where:{ id:String(assignmentId) }, data:{ status:'REJECTED', approvedBy:req.authUser.id, approvedAt:new Date() } });
  await prisma.auditLog.create({ data:{ actorId:req.authUser!.id, jobId:upd.jobId, action:'ASSIGN_REJECT', entity:'Assignment', entityId:upd.id, after: JSON.stringify(upd) } });
  res.json({ ok:true, assignmentId:upd.id });
});

// ===== PM sessions =====
async function ensureSession(jobId:string, pmDeviceId:string){
  const key=`session:${jobId}`; const e=await redis.get(key);
  if(e){ await redis.expire(key, SESSION_TTL_SECONDS); return JSON.parse(e).sessionId as string; }
  const sid = randomUUID(); await redis.set(key, JSON.stringify({sessionId:sid, pmDeviceId, startedAt:Date.now()}), ttl(SESSION_TTL_SECONDS)); return sid;
}
async function rotateSession(jobId:string, pmDeviceId:string){
  const sid = randomUUID(); await redis.set(`session:${jobId}`, JSON.stringify({sessionId:sid, pmDeviceId, rotatedAt:Date.now()}), ttl(SESSION_TTL_SECONDS)); return sid;
}
async function currentSessionId(jobId:string){ const d=await redis.get(`session:${jobId}`); if(!d) throw new Error('no_active_session'); return JSON.parse(d).sessionId as string; }

app.post('/jobs/:id/session/start', async (req,res)=>{ const {id}=req.params; const {pmDeviceId}=req.body||{}; if(!pmDeviceId) return res.status(400).json({error:'pmDeviceId required'}); res.json({sessionId: await ensureSession(id, pmDeviceId), expiresIn: SESSION_TTL_SECONDS}); });
app.post('/jobs/:id/session/keepalive', async (req,res)=>{ const {id}=req.params; const {pmDeviceId}=req.body||{}; if(!pmDeviceId) return res.status(400).json({error:'pmDeviceId required'}); res.json({sessionId: await ensureSession(id, pmDeviceId), expiresIn: SESSION_TTL_SECONDS}); });
app.post('/jobs/:id/session/rotate', async (req,res)=>{ const {id}=req.params; const {pmDeviceId}=req.body||{}; if(!pmDeviceId) return res.status(400).json({error:'pmDeviceId required'}); res.json({sessionId: await rotateSession(id, pmDeviceId), expiresIn: SESSION_TTL_SECONDS}); });
app.get('/jobs/:id/session/current', async (req,res)=>{ const {id}=req.params; try{ res.json({sessionId: await currentSessionId(id)});}catch{ res.status(404).json({error:'no_active_session'}); }});

// ===== Issue QR token (short-lived, single-use, session-bound) =====
app.post('/jobs/:id/qr-token', async (req,res)=>{
  const { id } = req.params;
  const { action } = req.body || {};
  const userId = req.authUser?.id || (req.header('x-user-id') as string|undefined);
  if(!userId) return res.status(401).json({ error:'login_or_x-user-id_required' });
  if(!['in','out'].includes(action)) return res.status(400).json({ error:'action must be in|out' });

  const asn = await prisma.assignment.findFirst({ where:{ jobId:id, userId, status:'APPROVED' } });
  if(!asn) return res.status(403).json({ error:'not approved for this job' });

  try{
    const sid = await currentSessionId(id);
    const jti = randomUUID();
    const jwt = await new SignJWT({ sub:userId, job:id, act:action, sid, jti })
      .setProtectedHeader({ alg:'EdDSA' }).setIssuedAt().setExpirationTime(`${TOKEN_TTL_SECONDS}s`).sign(privateKey);
    res.json({ token: jwt, ttl: TOKEN_TTL_SECONDS });
  }catch(e:any){ res.status(400).json({ error:e.message }); }
});

// ===== Verify scan =====
app.post('/scan/verify', async (req,res)=>{
  const { token, pmDeviceId, sessionId, coords } = req.body || {};
  if(!token || !pmDeviceId || !sessionId) return res.status(400).json({ result:'invalid', reason:'missing_fields' });

  let payload:any; try{ ({payload} = await jwtVerify(token, publicKey, { clockTolerance:'10s' })); }
  catch(e:any){ return res.json({ result:'invalid', reason:'jwt_error', detail:e?.message||String(e) }); }

  try{
    const { sub, job, act, sid, jti } = payload as any;
    if(sid!==sessionId) return res.json({ result:'invalid', reason:'sid_mismatch' });

    const burnKey = `jti:${jti}`; const set = await redis.setNX(burnKey,'1'); if(!set) return res.json({ result:'duplicate' });
    await redis.expire(burnKey, TOKEN_TTL_SECONDS*2);

    if (act==='out') {
      const hasIn = await prisma.scan.findFirst({ where:{ jobId:String(job), userId:String(sub), action:'IN', result:'success' } });
      if(!hasIn) return res.json({ result:'invalid', reason:'no_prior_in' });
    }

    const scan = await prisma.scan.create({ data:{
      jobId:String(job), userId:String(sub), action: act==='out'?'OUT':'IN',
      pmDeviceId, result:'success', sessionId, lat:coords?.lat ?? null, lng:coords?.lng ?? null, tokenJti:String(jti)
    }});

    // Late merit on first IN
    let late=false, minutesLate=0;
    if (act==='in') {
      const priorIn = await prisma.scan.findFirst({ where:{ jobId:String(job), userId:String(sub), action:'IN', result:'success' } });
      if(!priorIn){
        const jb = await prisma.job.findUnique({ where:{ id:String(job) } });
        if (jb?.callTimeUtc) {
          const cutoff = new Date(jb.callTimeUtc.getTime() + (jb.callGraceMins ?? 15) * 60 * 1000);
          if (scan.tsUtc > cutoff) {
            late = true; minutesLate = Math.ceil((scan.tsUtc.getTime()-cutoff.getTime())/60000);
            await prisma.meritLog.create({ data:{ jobId:String(job), userId:String(sub), kind:'LATE', points:1, reason:`Clock-in after grace by ${minutesLate} min` }});
          }
        }
      }
    }

    try { await appendAttendanceRow(String(job), String(sub), scan, late, minutesLate); }
    catch(e:any){ console.warn('[sheets] append failed:', e?.message||e); }

    const user = await prisma.user.findUnique({ where:{ id:String(sub) } });
    return res.json({ result:'success', user:{ name:user?.name, photo:user?.photoUrl }, late, minutesLate });
  }catch(e:any){ return res.json({ result:'invalid', reason:'db_error', detail:e?.message||String(e) }); }
});

app.get('/scan/jti/:jti/status', async (req,res)=>{
  const { jti } = req.params;
  try{
    const scan = await prisma.scan.findUnique({ where:{ tokenJti:String(jti) } });
    if (scan) return res.json({ used:true, result:scan.result, action:scan.action, tsUtc:scan.tsUtc });
    const exists = await redis.exists(`jti:${jti}`);
    return res.json({ used: exists===1, result: exists ? 'pending' : 'unused' });
  }catch(e:any){ return res.status(500).json({ used:false, error:e?.message||String(e) }); }
});

// ===== Attendance (today) =====
app.get('/jobs/:id/attendance/today', async (req,res)=>{
  const { id } = req.params;
  const start=new Date(); start.setUTCHours(0,0,0,0);
  const end=new Date();   end.setUTCHours(23,59,59,999);
  const scans = await prisma.scan.findMany({ where:{ jobId:id, tsUtc:{ gte:start, lte:end } }, orderBy:{ tsUtc:'asc' } });
  const map = new Map<string,{ userId:string; firstIn?:Date; lastOut?:Date; totalIns:number }>();
  for (const s of scans) {
    const r = map.get(s.userId) || { userId:s.userId, totalIns:0 };
    if (s.action==='IN')  { r.totalIns+=1; if(!r.firstIn||s.tsUtc<r.firstIn) r.firstIn=s.tsUtc; }
    if (s.action==='OUT') { if(!r.lastOut||s.tsUtc>r.lastOut) r.lastOut=s.tsUtc; }
    map.set(s.userId,r);
  }
  const users  = await prisma.user.findMany({ where:{ id:{ in:[...map.keys()] } } });
  const merits = await prisma.meritLog.findMany({ where:{ jobId:id, kind:'LATE', tsUtc:{ gte:start, lte:end } } });
  const rows = [...map.values()].map(r=>{
    const u = users.find(x=>x.id===r.userId);
    const m = merits.find(x=>x.userId===r.userId);
    return { userId:r.userId, user:u?.name||r.userId, email:u?.email||'', firstInUtc:r.firstIn||null, lastOutUtc:r.lastOut||null, lateMinutes: m ? m.reason?.match(/(\d+) min/)?.[1] : null, totalIns:r.totalIns };
  });
  res.json({ jobId:id, date:new Date().toISOString().slice(0,10), records:rows });
});

// ===== Merits: recalc no-show =====
app.post('/jobs/:id/merit/recalc', requireCsrf(), async (req,res)=>{
  if(!mustAdminPM(req,res)) return;
  const { id } = req.params;
  const job = await prisma.job.findUnique({ where:{ id } });
  if(!job) return res.status(404).json({error:'not_found'});

  const cutoff = job.endTimeUtc ? new Date(job.endTimeUtc) : new Date(job.callTimeUtc.getTime() + 6*3600*1000);
  const approved = await prisma.assignment.findMany({ where:{ jobId:id, status:'APPROVED' } });
  const userIds = approved.map(a=>a.userId);
  const scannedIn = await prisma.scan.findMany({ where:{ jobId:id, userId:{ in:userIds }, action:'IN', result:'success', tsUtc:{ lte: cutoff } } });
  const hadIn = new Set(scannedIn.map(s=>s.userId));
  let noShow = 0;
  for (const a of approved) {
    if (!hadIn.has(a.userId)) {
      await prisma.meritLog.create({ data:{ jobId:id, userId:a.userId, kind:'NO_SHOW', points:3, reason:'Approved but no clock-in by cutoff' }});
      noShow++;
    }
  }
  res.json({ ok:true, noShowAssigned: noShow });
});

// ===== Wages & export =====
function hoursBetween(a:Date|undefined|null, b:Date|undefined|null){ if(!a || !b) return 0; return Math.max(0, (b.getTime()-a.getTime())/3600000); }

async function computePay(jobId:string){
  const job = await prisma.job.findUnique({ where:{ id:jobId } });
  if(!job) throw new Error('job_not_found');
  const approved = await prisma.assignment.findMany({ where:{ jobId:jobId, status: AssignmentStatus.APPROVED }, include:{ user:true } });

  const scans = await prisma.scan.findMany({ where:{ jobId }, orderBy:{ tsUtc:'asc' } });
  const byUser = new Map<string, { firstIn?:Date; lastOut?:Date }>();
  for (const s of scans) {
    const r = byUser.get(s.userId) || {};
    if (s.action==='IN')  { if(!r.firstIn || s.tsUtc < r.firstIn) r.firstIn = s.tsUtc; }
    if (s.action==='OUT') { if(!r.lastOut || s.tsUtc > r.lastOut) r.lastOut = s.tsUtc; }
    byUser.set(s.userId, r);
  }

  const rows = [];
  for (const a of approved) {
    const r = byUser.get(a.userId) || {};
    let span = hoursBetween(r.firstIn, r.lastOut);
    if (span > 0 && job.breakMinutes>0) span = Math.max(0, span - job.breakMinutes/60);
    const payable = Math.max(job.minCallHours, span);
    const baseHours = Math.min(payable, job.otAfterHours);
    const otHours   = Math.max(0, payable - job.otAfterHours);

    const basePay = baseHours * job.baseHourly;
    const otPay   = otHours * job.baseHourly * job.otMultiplier;
    const transportAllowance = a.transport === 'OWN' ? job.ownTransportAllowance : 0;
    const total = basePay + otPay + transportAllowance;

    rows.push({
      userId: a.userId,
      name: a.user.name,
      email: a.user.email,
      transport: a.transport,
      firstInUtc: r.firstIn || null,
      lastOutUtc: r.lastOut || null,
      baseHours: Number(baseHours.toFixed(2)),
      otHours: Number(otHours.toFixed(2)),
      payableHours: Number(payable.toFixed(2)),
      basePay: Number(basePay.toFixed(2)),
      otPay: Number(otPay.toFixed(2)),
      transportAllowance: Number(transportAllowance.toFixed(2)),
      totalPay: Number(total.toFixed(2))
    });
  }
  return { job, rows };
}

app.get('/jobs/:id/pay/preview', async (req,res)=>{
  if(!req.authUser || (req.authUser.role!=='ADMIN' && req.authUser.role!=='PM')) return res.status(403).json({error:'forbidden'});
  const { id } = req.params;
  const out = await computePay(id);
  res.json(out);
});

app.get('/jobs/:id/export.csv', async (req,res)=>{
  if(!req.authUser || (req.authUser.role!=='ADMIN' && req.authUser.role!=='PM')) return res.status(403).json({error:'forbidden'});
  const { id } = req.params;
  const { job, rows } = await computePay(id);
  const header = ['Name','Email','Transport','First IN','Last OUT','Base Hours','OT Hours','Payable Hours','Base Pay','OT Pay','Transport Allow.','Total Pay'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      `"${r.name}"`, `"${r.email}"`, r.transport,
      r.firstInUtc ? new Date(r.firstInUtc).toISOString() : '',
      r.lastOutUtc ? new Date(r.lastOutUtc).toISOString() : '',
      r.baseHours, r.otHours, r.payableHours, r.basePay, r.otPay, r.transportAllowance, r.totalPay
    ].join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="payout_${job?.title||id}.csv"`);
  res.send(lines.join('\n'));
});

// ===== Google Sheets =====
const GS_SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
function getSheetsClient(){
  const clientEmail = process.env.GS_SA_EMAIL;
  const privateKeyB64 = process.env.GS_SA_KEY_B64;
  if(!clientEmail || !privateKeyB64) throw new Error('sheets_not_configured');
  const key = Buffer.from(privateKeyB64,'base64').toString('utf8');
  const jwt = new google.auth.JWT(clientEmail, undefined, key, GS_SCOPES);
  return google.sheets({ version:'v4', auth:jwt });
}

async function createJobSheet(job:any){
  const sheets = getSheetsClient();
  const title = `ATAG – ${job.title} (${new Date(job.callTimeUtc).toISOString().slice(0,10)})`;
  const resp = await sheets.spreadsheets.create({
    requestBody:{
      properties:{ title },
      sheets:[
        { properties:{ title:'Attendance' },
          data:[{ rowData:[{ values: ['Timestamp','Name','Email','Role','Action','Transport','Notes','PM Device','Session','JTI'].map(v=>({userEnteredValue:{stringValue:String(v)}})) }]}] },
        { properties:{ title:'Summary' },
          data:[{ rowData:[{ values: ['Headcount','Unique','Late','No-show','Total Payable Hours','Total Wage'].map(v=>({userEnteredValue:{stringValue:String(v)}})) }]}] },
        { properties:{ title:'Payout' },
          data:[{ rowData:[{ values: ['Name','Email','Transport','First IN','Last OUT','Base Hours','OT Hours','Payable Hours','Base Pay','OT Pay','Transport Allow.','Total Pay'].map(v=>({userEnteredValue:{stringValue:String(v)}})) }]}] }
      ]
    }
  });
  return resp.data.spreadsheetId!;
}

async function appendAttendanceRow(jobId:string, userId:string, scan:any, late:boolean, lateMins:number){
  const job = await prisma.job.findUnique({ where:{ id:jobId } });
  if(!job?.sheetId) return;
  const sheets = getSheetsClient();
  const user = await prisma.user.findUnique({ where:{ id:userId } });
  const asn = await prisma.assignment.findFirst({ where:{ jobId, userId } });
  const values = [[
    new Date(scan.tsUtc).toISOString(),
    user?.name||userId,
    user?.email||'',
    asn?.roleName||'',
    scan.action,
    asn?.transport||'',
    late ? `LATE ${lateMins} min` : '',
    scan.pmDeviceId,
    scan.sessionId,
    scan.tokenJti
  ]];
  await sheets.spreadsheets.values.append({
    spreadsheetId: job.sheetId, range: 'Attendance!A1', valueInputOption:'USER_ENTERED', requestBody:{ values }
  });
}

app.post('/jobs/:id/sheets/rewrite', requireCsrf(), async (req,res)=>{
  if(!mustAdminPM(req,res)) return;
  const { id } = req.params;
  const job = await prisma.job.findUnique({ where:{ id } });
  if(!job?.sheetId) return res.status(400).json({error:'no_sheet_for_job'});

  const { rows } = await computePay(id);
  const sheets = getSheetsClient();

  const payout = rows.map(r=>[
    r.name, r.email, r.transport,
    r.firstInUtc ? new Date(r.firstInUtc).toISOString() : '',
    r.lastOutUtc ? new Date(r.lastOutUtc).toISOString() : '',
    r.baseHours, r.otHours, r.payableHours, r.basePay, r.otPay, r.transportAllowance, r.totalPay
  ]);
  await sheets.spreadsheets.values.clear({ spreadsheetId:job.sheetId, range:'Payout!A2:Z9999' });
  if (payout.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: job.sheetId, range: 'Payout!A2',
      valueInputOption:'USER_ENTERED', requestBody:{ values: payout }
    });
  }

  const headcount = rows.length;
  const unique = rows.filter(r=>r.firstInUtc).length;
  const late = await prisma.meritLog.count({ where:{ jobId:id, kind:'LATE' } });
  const noShow = await prisma.meritLog.count({ where:{ jobId:id, kind:'NO_SHOW' } });
  const totalHours = Number(rows.reduce((s,r)=>s+r.payableHours,0).toFixed(2));
  const totalWage  = Number(rows.reduce((s,r)=>s+r.totalPay,0).toFixed(2));
  await sheets.spreadsheets.values.update({
    spreadsheetId: job.sheetId, range:'Summary!A2',
    valueInputOption:'USER_ENTERED',
    requestBody:{ values:[[headcount, unique, late, noShow, totalHours, totalWage]] }
  });

  res.json({ ok:true, headcount, unique, late, noShow, totalHours, totalWage });
});

app.get('/', (_req,res)=>res.send('ATAG API running'));
app.get('/health', (_req,res)=>res.json({ ok:true }));

async function bootstrap(){
  await redis.connect();
  await initKeys();
  const port = Number(process.env.API_PORT || 4000);
  app.listen(port, ()=>console.log(`API http://localhost:${port}`));
}
bootstrap().catch(err=>{ console.error('Failed to start API:', err); process.exit(1); });
