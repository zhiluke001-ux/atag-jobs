// web/src/utils/sortJobs.js
// Shared job-list comparators. Used by Home.jsx (admin Jobs Management + marshal
// sign-up list) and Available.jsx.

// Parse an ISO/date value to epoch ms, or null when missing/invalid.
export function toMs(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

// Upcoming / Present lists: newest-POSTED first.
// createdAt DESC -> startTime DESC -> id DESC. Missing createdAt sinks to bottom.
export function byNewestPosted(a, b) {
  const ca = toMs(a?.createdAt);
  const cb = toMs(b?.createdAt);
  if (ca != null && cb != null && ca !== cb) return cb - ca;
  if (ca != null && cb == null) return -1;
  if (ca == null && cb != null) return 1;
  const sa = toMs(a?.startTime);
  const sb = toMs(b?.startTime);
  if (sa != null && sb != null && sa !== sb) return sb - sa;
  return String(b?.id ?? "").localeCompare(String(a?.id ?? ""));
}

// Past tab: most recently finished first.
// endTime DESC (fallback startTime) -> startTime DESC -> id DESC.
export function byMostRecentlyFinished(a, b) {
  const ea = toMs(a?.endTime) ?? toMs(a?.startTime);
  const eb = toMs(b?.endTime) ?? toMs(b?.startTime);
  if (ea != null && eb != null && ea !== eb) return eb - ea;
  if (ea != null && eb == null) return -1;
  if (ea == null && eb != null) return 1;
  const sa = toMs(a?.startTime);
  const sb = toMs(b?.startTime);
  if (sa != null && sb != null && sa !== sb) return sb - sa;
  return String(b?.id ?? "").localeCompare(String(a?.id ?? ""));
}
