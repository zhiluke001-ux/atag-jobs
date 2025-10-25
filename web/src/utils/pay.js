// web/src/utils/pay.js
/* ---------- small helpers ---------- */
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
export const money = (v) => {
  const n = num(v);
  return Number.isFinite(n) && n > 0 ? `RM${n % 1 === 0 ? n : n.toFixed(2)}` : null;
};

/* ---------- viewer role + kind ---------- */
export function deriveViewerRank(user) {
  const raw = (
    user?.ptRole || user?.jobRole || user?.rank || user?.tier || user?.level || user?.roleRank || ""
  ).toString().toLowerCase();
  if (["lead", "leader", "supervisor", "captain"].includes(raw)) return "lead";
  if (["senior", "sr"].includes(raw)) return "senior";
  return "junior";
}

export function deriveKind(job) {
  const kind =
    job?.rate?.sessionKind ||
    job?.sessionKind ||
    job?.physicalSubtype ||
    job?.session?.physicalType ||
    (job?.session?.mode === "virtual" ? "virtual" : null);

  const mode =
    job?.session?.mode || job?.sessionMode || job?.mode || (kind === "virtual" ? "virtual" : "physical");
  const isVirtual = mode === "virtual" || kind === "virtual";

  const resolvedKind = isVirtual
    ? "virtual"
    : ["half_day", "full_day", "2d1n", "3d2n", "hourly_by_role", "hourly_flat"].includes(kind)
      ? kind
      : "half_day";

  const label =
    resolvedKind === "virtual" ? "Virtual"
      : resolvedKind === "half_day" ? "Physical — Half Day"
      : resolvedKind === "full_day" ? "Physical — Full Day"
      : resolvedKind === "2d1n" ? "Physical — 2D1N"
      : resolvedKind === "3d2n" ? "Physical — 3D2N"
      : resolvedKind === "hourly_by_role" ? "Physical — Hourly (by role)"
      : "Physical — Backend (flat hourly)";

  return { isVirtual, kind: resolvedKind, label };
}

/* ---------- normalize tier access ---------- */
function pickField(obj, fields) {
  for (const f of fields) {
    const v = obj?.[f];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
}
function getTierRates(job) {
  const src = job?.rate || job?.rolePlan || job || {};
  const tr = src.tierRates || src.roleRates || {};
  const norm = (t) => t || {};
  return {
    junior: norm(tr.junior),
    senior: norm(tr.senior),
    lead:   norm(tr.lead),
    flat:   src.flatHourly || {},
  };
}
function getHourlyBase(tier) {
  return pickField(tier, ["base", "hourly", "hourlyBase", "perHour", "ratePerHour"]);
}
function getHourlyOT(tier) {
  return pickField(tier, ["otRatePerHour", "otHourly", "overtimePerHour", "ot"]);
}
function getSessionAmount(tier, kind) {
  if (kind === "half_day") return pickField(tier, ["halfDay", "half_day", "specificPayment"]);
  if (kind === "full_day") return pickField(tier, ["fullDay", "full_day", "specificPayment"]);
  if (kind === "2d1n")     return pickField(tier, ["twoD1N", "two_d1n", "specificPayment"]);
  if (kind === "3d2n")     return pickField(tier, ["threeD2N", "three_d2n", "specificPayment"]);
  return null;
}

/* ---------- text rules (no multipliers) ---------- */
function otSuffix(hourlyRM, otRM) {
  if (otRM && otRM !== hourlyRM) return ` (OT ${otRM}/hr after end)`;
  if (hourlyRM) return ` (OT billed hourly after end)`;
  return "";
}

/* ---------- the ONE source of truth ---------- */
export function buildPayForViewer(job, viewerUser) {
  const { kind } = deriveKind(job);
  const { junior, senior, lead, flat } = getTierRates(job);
  const rank = deriveViewerRank(viewerUser);
  const tier = rank === "lead" ? lead : rank === "senior" ? senior : junior;

  // backend hourly only
  if (kind === "hourly_flat") {
    const base = money(getHourlyBase(flat) ?? getHourlyBase(tier));
    const ot   = money(getHourlyOT(flat));
    if (base || ot) return `${base ? `${base}/hr` : ""}${otSuffix(base, ot)}`.trim();
    return "-";
  }

  // virtual / hourly-by-role
  if (kind === "virtual" || kind === "hourly_by_role") {
    const base = money(getHourlyBase(tier));
    const ot   = money(getHourlyOT(tier));
    if (base || ot) return `${base ? `${base}/hr` : ""}${otSuffix(base, ot)}`.trim();
    return "-";
  }

  // session kinds
  const sessionRM = money(getSessionAmount(tier, kind));
  const hasAddon =
    job?.session?.hourlyEnabled ||
    job?.physicalHourlyEnabled ||
    (tier?.payMode && String(tier.payMode).toLowerCase() === "specific_plus_hourly");

  const hrBase = money(getHourlyBase(tier));
  const hrOT   = money(getHourlyOT(tier));

  if (sessionRM) {
    if (hasAddon && (hrBase || hrOT)) {
      return `${sessionRM}  +  ${hrBase ? `${hrBase}/hr` : ""}${otSuffix(hrBase, hrOT)}`.trim();
    }
    return sessionRM;
  }

  if (hrBase || hrOT) return `${hrBase ? `${hrBase}/hr` : ""}${otSuffix(hrBase, hrOT)}`.trim();
  return "-";
}
