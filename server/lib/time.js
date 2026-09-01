export const BUSINESS_TIME_ZONE = "Asia/Kuala_Lumpur";

// Date-only legacy deadlines represent the end of that Malaysia calendar day.
export function parseDeadlineInput(value) {
  if (value === undefined) return null;
  if (value === null || value === "") return null;
  const s = String(value).trim();
  let d;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) d = new Date(`${s}T23:59:59.999+08:00`);
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(s)) d = new Date(`${s}+08:00`);
  else d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function isApplicationClosed(deadline) {
  if (!deadline) return false;
  const d = deadline instanceof Date ? deadline : new Date(deadline);
  return !Number.isNaN(d.getTime()) && Date.now() > d.getTime();
}

export function deadlineDateAlias(deadline) {
  if (!deadline) return null;
  const d = deadline instanceof Date ? deadline : new Date(deadline);
  if (Number.isNaN(d.getTime())) return null;
  // Convert to Malaysia calendar date without external timezone dependency.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(d);
  const map = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
