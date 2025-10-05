// Simple helpers for displaying job date/time ranges nicely in local time.
export function formatLocal(dtIso: string) {
  const d = new Date(dtIso);
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: 'numeric', minute: '2-digit'
  }).format(d);
}

export function formatTime(dtIso: string) {
  const d = new Date(dtIso);
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric', minute: '2-digit'
  }).format(d);
}

export function formatJobRange(startIso: string, endIso?: string) {
  if (!endIso) return formatLocal(startIso);
  const start = new Date(startIso);
  const end = new Date(endIso);
  const sameDay = start.toDateString() === end.toDateString();

  if (sameDay) {
    // e.g. "Oct 05, 8:00 PM — 11:00 PM"
    const dayPart = new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: 'short', day: '2-digit'
    }).format(start);
    return `${dayPart}, ${formatTime(startIso)} — ${formatTime(endIso)}`;
  }

  // Different days: "Oct 05, 8:00 PM — Oct 06, 1:00 AM"
  return `${formatLocal(startIso)} — ${formatLocal(endIso)}`;
}
