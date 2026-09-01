export const DEFAULT_RATES = {
  virtualHourly: { junior: 20, senior: 20, lead: 30 },
  physicalSession: {
    halfDay: { junior: 80, senior: 100, lead: 44 },
    fullDay: { junior: 150, senior: 180, lead: 88 },
    twoD1N: { junior: 230, senior: 270, lead: null },
    threeD2n: { junior: 300, senior: 350, lead: null },
  },
  physicalHourly: { junior: 20, senior: 30, lead: 30 },
  loadingUnloading: { amount: 30 },
  earlyCall: { defaultAmount: 20, thresholdHours: 3 },
};

export function defaultRoleRates(rates = DEFAULT_RATES) {
  const physical = rates?.physicalHourly || DEFAULT_RATES.physicalHourly;
  return {
    junior: { payMode: "hourly", base: Number(physical.junior ?? 20), specificPayment: null, otMultiplier: 0 },
    senior: { payMode: "hourly", base: Number(physical.senior ?? 30), specificPayment: null, otMultiplier: 0 },
    lead: { payMode: "hourly", base: Number(physical.lead ?? 30), specificPayment: null, otMultiplier: 0 },
    junior_emcee: { payMode: "hourly", base: Number(physical.junior ?? 20), specificPayment: null, otMultiplier: 0 },
    senior_emcee: { payMode: "hourly", base: Number(physical.senior ?? 30), specificPayment: null, otMultiplier: 0 },
  };
}

async function getValue(client, key) {
  const { rows } = await client.query(`SELECT value FROM app_config WHERE key=$1`, [key]);
  return rows[0]?.value;
}

export async function getAppConfig(client) {
  if (!client?.query) {
    const { pool } = await import("../db.js");
    client = pool;
  }
  const [ratesRaw, rolesRaw, scanRaw] = await Promise.all([
    getValue(client, "rates"),
    getValue(client, "roleRatesDefaults"),
    getValue(client, "scanMaxDistanceMeters"),
  ]);
  const rates = { ...DEFAULT_RATES, ...(ratesRaw && typeof ratesRaw === "object" ? ratesRaw : {}) };
  rates.loadingUnloading = { ...DEFAULT_RATES.loadingUnloading, ...(rates.loadingUnloading || {}) };
  rates.earlyCall = { ...DEFAULT_RATES.earlyCall, ...(rates.earlyCall || {}) };
  const defaults = defaultRoleRates(rates);
  const roleRatesDefaults = {};
  for (const role of Object.keys(defaults)) roleRatesDefaults[role] = { ...defaults[role], ...(rolesRaw?.[role] || {}) };
  const scanMaxDistanceMeters = Number(scanRaw ?? process.env.SCAN_MAX_DISTANCE_METERS ?? 500) || 500;
  return { rates, roleRatesDefaults, scanMaxDistanceMeters };
}

export async function setConfigValue(client, key, value) {
  await client.query(`
    INSERT INTO app_config(key,value,updated_at) VALUES($1,$2,now())
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()
  `, [key, value]);
}
