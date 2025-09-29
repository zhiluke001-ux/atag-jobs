export function formatJobRange(callISO: string, endISO?: string | null) {
  const call = new Date(callISO);
  const end  = endISO ? new Date(endISO) : null;
  const dateStr = call.toLocaleDateString(undefined, { month:'numeric', day:'numeric', year:'numeric' });
  const startStr = call.toLocaleTimeString(undefined, { hour:'numeric', minute: undefined });
  const endStr   = end ? end.toLocaleTimeString(undefined, { hour:'numeric', minute: undefined }) : 'TBD';
  return `${dateStr}, ${startStr} — ${endStr}`;
}
