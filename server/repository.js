import { pool } from "./db.js";
import { getAppConfig } from "./lib/config.js";
import { deadlineDateAlias } from "./lib/time.js";
import { randomId } from "./lib/security.js";

export const ROLES = ["part-timer", "pm", "admin"];
export const STAFF_ROLES = ["junior", "senior", "lead", "junior_emcee", "senior_emcee"];

export const clampRole = (r) => (ROLES.includes(String(r)) ? String(r) : "part-timer");
export const clampGrade = (g) => {
  const x = String(g || "").toLowerCase().replace(/\s+/g, "_");
  return STAFF_ROLES.includes(x) ? x : "junior";
};

export function userFromRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    email: r.email,
    username: r.username,
    name: r.name || "",
    role: r.role,
    grade: r.grade || "junior",
    passwordHash: r.password_hash,
    phone: r.phone || "",
    discord: r.discord || "",
    avatarUrl: r.avatar_path || "",
    verified: !!r.verified,
    verificationStatus: r.verification_status || (r.verified ? "APPROVED" : "PENDING"),
    verificationPhotoUrl: r.verification_photo_path || "",
    verifiedAt: r.verified_at ? new Date(r.verified_at).toISOString() : null,
    verifiedBy: r.verified_by || null,
  };
}

export async function findUserByIdentifier(identifier, client = pool) {
  const x = String(identifier || "").toLowerCase();
  const { rows } = await client.query(
    `SELECT * FROM users WHERE lower(email)=$1 OR lower(username)=$1 LIMIT 1`,
    [x]
  );
  return userFromRow(rows[0]);
}

export async function getUserById(id, client = pool) {
  const { rows } = await client.query(`SELECT * FROM users WHERE id=$1`, [id]);
  return userFromRow(rows[0]);
}

export async function listUsers(client = pool) {
  const { rows } = await client.query(`SELECT * FROM users ORDER BY lower(name), lower(email)`);
  return rows.map(userFromRow);
}

export function computeStatus(job) {
  const now = Date.now();
  if (job?.events?.endedAt) return "ended";
  if (job?.events?.startedAt) return "ongoing";
  const start = new Date(job.startTime).getTime();
  const end = new Date(job.endTime).getTime();
  if (Number.isFinite(start) && now < start) return "upcoming";
  if (Number.isFinite(end) && now > end) return "ended";
  return job.status || "upcoming";
}

export function paySummaryFromRate(rate = {}) {
  const pm = rate.payMode;
  const hr = Number(rate.base ?? rate.hourlyBase);
  const fix = Number(rate.specificPayment ?? rate.specificAmount);
  const otm = Number(rate.otMultiplier || 0);
  const otTag = otm > 0 ? ` (OT x${otm})` : "";
  if (pm === "specific" && Number.isFinite(fix)) return `RM ${Math.round(fix)} / shift`;
  if (pm === "specific_plus_hourly" && Number.isFinite(fix) && Number.isFinite(hr)) return `RM ${Math.round(fix)} + RM ${Math.round(hr)}/hr${otTag}`;
  if ((pm === "hourly" || pm == null) && Number.isFinite(hr)) return `RM ${Math.round(hr)}/hr${otTag}`;
  const legacyHr = rate?.physicalHourly?.junior ?? rate?.virtualHourly?.junior;
  return Number.isFinite(legacyHr) ? `From RM ${Math.round(legacyHr)}/hr` : "See details";
}

function baseJobFromRow(r) {
  const extra = r.extra && typeof r.extra === "object" ? r.extra : {};
  const applicationDeadline = r.application_deadline ? new Date(r.application_deadline).toISOString() : null;
  return {
    ...extra,
    id: r.id,
    title: r.title,
    venue: r.venue,
    description: r.description || "",
    startTime: new Date(r.start_time).toISOString(),
    endTime: new Date(r.end_time).toISOString(),
    applicationDeadline,
    applyDueDate: deadlineDateAlias(applicationDeadline),
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : null,
    status: r.status || "upcoming",
    headcount: Number(r.headcount || 0),
    transportOptions: r.transport_options || { bus: true, own: true },
    rate: r.rate || {},
    roleCounts: r.role_counts || {},
    roleRates: r.role_rates || {},
    session: r.session || extra.session || {},
    breakEnabled: !!r.break_enabled,
  };
}

export async function listJobsPublic(client = pool) {
  const { rows } = await client.query(`
    SELECT j.*,
      (SELECT count(*)::int FROM job_applications a WHERE a.job_id=j.id) AS applied_count,
      (SELECT count(*)::int FROM job_applications a WHERE a.job_id=j.id AND a.status='approved') AS approved_count,
      (SELECT count(*)::int FROM job_full_timers ft WHERE ft.job_id=j.id) AS full_timers_count,
      lc.enabled AS lu_enabled, lc.quota AS lu_quota, lc.price AS lu_price, lc.closed AS lu_closed,
      (SELECT count(*)::int FROM job_loading_members lm WHERE lm.job_id=j.id AND lm.applied) AS lu_applicants,
      (SELECT count(*)::int FROM job_loading_members lm WHERE lm.job_id=j.id AND lm.present) AS lu_participants,
      e.started_at, e.ended_at
    FROM jobs j
    LEFT JOIN job_loading_config lc ON lc.job_id=j.id
    LEFT JOIN job_events e ON e.job_id=j.id
    ORDER BY j.start_time ASC
  `);
  const config = await getAppConfig(client);
  return rows.map((r) => {
    const job = baseJobFromRow(r);
    job.events = { startedAt: r.started_at ? new Date(r.started_at).toISOString() : null, endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null };
    return {
      id: job.id,
      title: job.title,
      venue: job.venue,
      description: job.description,
      startTime: job.startTime,
      endTime: job.endTime,
      applicationDeadline: job.applicationDeadline,
      applyDueDate: job.applyDueDate,
      createdAt: job.createdAt,
      headcount: job.headcount,
      status: computeStatus(job),
      transportOptions: job.transportOptions,
      breakEnabled: job.breakEnabled,
      loadingUnload: {
        enabled: !!r.lu_enabled,
        quota: Number(r.lu_quota || 0),
        applicants: Number(r.lu_applicants || 0),
        closed: !!r.lu_closed,
        participants: Number(r.lu_participants || 0),
        price: Number(r.lu_price ?? config.rates.loadingUnloading.amount ?? 0),
      },
      roleCounts: {
        junior: Number(job.roleCounts?.junior ?? 0), senior: Number(job.roleCounts?.senior ?? 0), lead: Number(job.roleCounts?.lead ?? 0),
        junior_emcee: Number(job.roleCounts?.junior_emcee ?? 0), senior_emcee: Number(job.roleCounts?.senior_emcee ?? 0),
      },
      appliedCount: Number(r.applied_count || 0),
      approvedCount: Number(r.approved_count || 0),
      fullTimersCount: Number(r.full_timers_count || 0),
      paySummary: paySummaryFromRate(job.rate || {}),
    };
  });
}

export async function getJobFull(id, client = pool) {
  const { rows } = await client.query(`SELECT * FROM jobs WHERE id=$1`, [id]);
  if (!rows[0]) return null;
  const job = baseJobFromRow(rows[0]);

  const [appsR, attR, loadCfgR, loadMembersR, earlyCfgR, earlyMembersR, adjR, ftR, receiptR, eventR] = await Promise.all([
    client.query(`SELECT a.*,u.email,u.name,u.phone,u.discord,u.avatar_path FROM job_applications a JOIN users u ON u.id=a.user_id WHERE a.job_id=$1 ORDER BY a.applied_at`, [id]),
    client.query(`SELECT * FROM job_attendance WHERE job_id=$1`, [id]),
    client.query(`SELECT * FROM job_loading_config WHERE job_id=$1`, [id]),
    client.query(`SELECT * FROM job_loading_members WHERE job_id=$1`, [id]),
    client.query(`SELECT * FROM job_early_call_config WHERE job_id=$1`, [id]),
    client.query(`SELECT * FROM job_early_call_members WHERE job_id=$1`, [id]),
    client.query(`SELECT * FROM job_adjustments WHERE job_id=$1 ORDER BY adjustment_time`, [id]),
    client.query(`SELECT ft.*,u.email,u.name,u.phone,u.grade,u.role AS account_role FROM job_full_timers ft JOIN users u ON u.id=ft.user_id WHERE ft.job_id=$1`, [id]),
    client.query(`SELECT p.*,u.name,u.phone,u.discord FROM parking_receipts p LEFT JOIN users u ON u.id=p.user_id WHERE p.job_id=$1 ORDER BY p.created_at DESC`, [id]),
    client.query(`SELECT * FROM job_events WHERE job_id=$1`, [id]),
  ]);

  job.applications = appsR.rows.map((a) => ({
    userId: a.user_id,
    email: a.email_snapshot || a.email,
    transport: a.transport,
    appliedAt: new Date(a.applied_at).toISOString(),
    status: a.status,
    name: a.name || "",
    phone: a.phone || "",
    discord: a.discord || "",
    avatarUrl: a.avatar_path || "",
    luApplied: !!a.wants_loading,
  }));
  job.approved = appsR.rows.filter(a => a.status === "approved").map(a => a.user_id);
  job.rejected = appsR.rows.filter(a => a.status === "rejected").map(a => a.user_id);
  job.appliedCount = appsR.rows.length;
  job.approvedCount = job.approved.length;
  job.rejectedCount = job.rejected.length;

  job.attendance = {};
  for (const a of attR.rows) {
    job.attendance[a.user_id] = {
      in: a.in_at ? new Date(a.in_at).toISOString() : null,
      out: a.out_at ? new Date(a.out_at).toISOString() : null,
      breakIn: a.break_in_at ? new Date(a.break_in_at).toISOString() : null,
      breakOut: a.break_out_at ? new Date(a.break_out_at).toISOString() : null,
      lateMinutes: Number(a.late_minutes || 0),
      breakMinutes: Number(a.break_minutes || 0),
    };
  }

  const config = await getAppConfig(client);
  const lc = loadCfgR.rows[0];
  job.loadingUnload = {
    enabled: !!lc?.enabled,
    quota: Number(lc?.quota || 0),
    price: Number(lc?.price ?? config.rates.loadingUnloading.amount ?? 0),
    closed: !!lc?.closed,
    applicants: loadMembersR.rows.filter(x => x.applied).map(x => x.user_id),
    participants: loadMembersR.rows.filter(x => x.present).map(x => x.user_id),
  };

  const ec = earlyCfgR.rows[0];
  job.earlyCall = {
    enabled: !!ec?.enabled,
    amount: Number(ec?.amount ?? config.rates.earlyCall.defaultAmount ?? 0),
    thresholdHours: Number(ec?.threshold_hours ?? config.rates.earlyCall.thresholdHours ?? 0),
    applicants: earlyMembersR.rows.filter(x => x.applied).map(x => x.user_id),
    participants: earlyMembersR.rows.filter(x => x.present).map(x => x.user_id),
  };

  job.adjustments = {};
  for (const a of adjR.rows) {
    if (!job.adjustments[a.user_id]) job.adjustments[a.user_id] = [];
    job.adjustments[a.user_id].push({
      amount: Number(a.amount || 0),
      reason: a.reason || "",
      ts: new Date(a.adjustment_time).toISOString(),
      by: a.by_user_id || a.by_email ? { id: a.by_user_id || null, email: a.by_email || null } : null,
    });
  }

  job.fullTimersCount = ftR.rows.length;
  job.fullTimers = ftR.rows.map(ft => ({
    ...(ft.data || {}), userId: ft.user_id, role: ft.role || ft.data?.role || "junior",
    name: ft.name || ft.data?.name || "", email: ft.email || ft.data?.email || "", phone: ft.phone || ft.data?.phone || "",
    grade: ft.grade || ft.data?.grade || "junior", accountRole: ft.account_role || ft.data?.accountRole || "",
  }));

  job.parkingReceipts = receiptR.rows.map(r => ({
    id: r.id, jobId: r.job_id, userId: r.user_id, email: r.email_snapshot, amount: r.amount == null ? null : Number(r.amount),
    note: r.note || "", photoUrl: r.storage_path, createdAt: new Date(r.created_at).toISOString(), status: r.status || "SUBMITTED",
    name: r.name || "", phone: r.phone || "", discord: r.discord || "",
  }));

  const ev = eventR.rows[0];
  job.events = {
    startedAt: ev?.started_at ? new Date(ev.started_at).toISOString() : null,
    endedAt: ev?.ended_at ? new Date(ev.ended_at).toISOString() : null,
    scanner: ev?.scanner_updated_at ? { lat: Number(ev.scanner_lat), lng: Number(ev.scanner_lng), updatedAt: new Date(ev.scanner_updated_at).toISOString() } : null,
  };
  job.status = computeStatus(job);
  return job;
}

export async function addAudit(client, action, details, reqOrActor = null) {
  const user = reqOrActor?.user || reqOrActor || null;
  const id = randomId("a", 7);
  const actor = user?.email || "guest";
  const role = user?.role || "guest";
  const actorId = user?.id || null;
  await client.query(
    `INSERT INTO audit_logs(id,audit_time,actor_user_id,actor,role,action,details) VALUES($1,now(),$2,$3,$4,$5,$6)`,
    [id, actorId, actor, role, action, details || {}]
  );
  return id;
}

export async function insertNotifications(client, userIds, { title, body, link, type = "info", eventKeyBase = null }) {
  const inserted = [];
  for (const uid of [...new Set((userIds || []).filter(Boolean))]) {
    const id = randomId("n", 8);
    const eventKey = eventKeyBase ? `${eventKeyBase}:${uid}` : null;
    const { rows } = await client.query(
      `INSERT INTO notifications(id,user_id,event_key,notification_time,title,body,link,read,type)
       VALUES($1,$2,$3,now(),$4,$5,$6,false,$7)
       ON CONFLICT (user_id,event_key) WHERE event_key IS NOT NULL DO NOTHING
       RETURNING id,user_id`,
      [id, uid, eventKey, title, body || "", link || null, type]
    );
    if (rows[0]) inserted.push(rows[0]);
  }
  return inserted;
}

export async function getPushSubscriptions(userIds, client = pool) {
  if (!userIds?.length) return [];
  const { rows } = await client.query(`SELECT id,user_id,endpoint,subscription FROM push_subscriptions WHERE user_id=ANY($1)`, [userIds]);
  return rows;
}

export async function listAdminIds(client = pool) {
  const { rows } = await client.query(`SELECT id FROM users WHERE role='admin'`);
  return rows.map(r => r.id);
}

export async function replaceAdjustments(client, jobId, adjustments, actor) {
  await client.query(`DELETE FROM job_adjustments WHERE job_id=$1`, [jobId]);
  for (const [uid, list] of Object.entries(adjustments || {})) {
    for (const item of Array.isArray(list) ? list : []) {
      await client.query(
        `INSERT INTO job_adjustments(id,job_id,user_id,amount,reason,adjustment_time,by_user_id,by_email)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [randomId("adj", 8), jobId, uid, Number(item?.amount || 0), String(item?.reason || ""), item?.ts ? new Date(item.ts) : new Date(), item?.by?.id || actor?.id || null, item?.by?.email || actor?.email || null]
      );
    }
  }
}
