// web/src/lib/scanErrors.js
// Turns a failed /scan (or /jobs/:id/qr) API error into a human message for
// marshals. Used by the camera scanner in PMJobDetails.jsx and the standalone
// Scanner.jsx paste page.
//
// api.js throws Error with:
//   - HTTP error:   err.status (number), err.payload ({ error, message, ...extra } | null)
//   - network/CORS: no err.status, no err.payload (err.message is a generic string)

import dayjs from "dayjs";

const hhmm = (t) => {
  const d = t ? dayjs(t) : null;
  return d && d.isValid() ? d.format("HH:mm") : null;
};

const dirLabel = (dir) => {
  switch (dir) {
    case "in":
      return "check-IN";
    case "out":
      return "check-OUT";
    case "break_in":
      return "BREAK-IN";
    case "break_out":
      return "BREAK-OUT";
    default:
      return "scan";
  }
};

/**
 * @param {object|null} payload  err.payload from api.js (parsed JSON body)
 * @param {number|undefined} status  err.status from api.js
 * @returns {{ text: string, hint?: string }}
 */
export function scanErrorMessage(payload, status) {
  // No status at all => request never got a response (offline / DNS / CORS / server down)
  if (status === undefined || status === null) {
    return {
      text: "No response from the server — nothing was saved.",
      hint: "Check your signal and scan again.",
    };
  }

  const code = payload?.error || "";
  const at = hhmm(payload?.at);

  switch (code) {
    case "missing_token":
    case "bad_token_type":
      return { text: "That QR isn't a valid check-in code.", hint: "Ask them to open Check In/Out and show the QR again." };

    case "jwt_error":
      return { text: "QR expired.", hint: "Ask them to tap Regenerate and show the new QR (codes last 60 seconds)." };

    case "bad_direction":
      return { text: "That QR has no direction.", hint: "Ask them to regenerate it." };

    case "token_missing_location":
      return { text: "Their QR has no location.", hint: "Ask them to allow location on their phone, then regenerate." };

    case "location_required":
      return { text: "Their phone location isn't ready.", hint: "Ask them to allow location, then regenerate the QR." };

    case "scanner_location_required":
      return { text: "Your location isn't ready yet.", hint: "Wait for the GPS lock at the bottom of the screen, then scan again." };

    case "too_far": {
      const d = Number(payload?.distanceMeters);
      const max = Number(payload?.maxDistanceMeters);
      const detail =
        Number.isFinite(d) && Number.isFinite(max) ? ` (about ${d} m away, limit ${max} m)` : "";
      return { text: `Too far from the person${detail}.`, hint: "Stand next to them and scan again." };
    }

    case "job_not_found":
      return { text: "This job could not be found.", hint: "Reload the page." };

    case "event_not_started":
      return { text: "The event hasn't been started.", hint: "Press Start on the job first, then scan." };

    case "break_disabled":
      return { text: "Breaks aren't enabled for this job.", hint: "Scan the Work IN / OUT QR instead." };

    case "not_approved":
      return { text: "This person isn't on the approved list for this job.", hint: "Approve them first, or mark manually." };

    case "already_checked_in":
      return {
        text: at ? `Already checked in at ${at}.` : "Already checked in.",
        hint: "Scan their check-OUT QR instead.",
      };

    case "already_checked_out":
      return { text: at ? `Already checked out at ${at}.` : "Already checked out.", hint: "Nothing more to scan for this person." };

    case "already_break_in":
      return { text: at ? `Break already started at ${at}.` : "Break already started.", hint: "Scan their BREAK-OUT QR instead." };

    case "already_break_out":
      return { text: at ? `Break already ended at ${at}.` : "Break already ended." };

    case "must_check_in_first":
      return { text: "No check-in recorded yet.", hint: "Scan their check-IN QR first." };

    case "break_in_missing":
      return { text: "No break-in recorded.", hint: "Scan their BREAK-IN QR first." };

    default:
      break;
  }

  // Known status, unknown code
  if (status >= 500) {
    return { text: "The server hit an error — nothing was saved.", hint: "Try again in a moment, or mark manually." };
  }
  const label = code || payload?.message || `HTTP ${status}`;
  return { text: `Scan failed (${label}).`, hint: "Try again, or mark this person manually." };
}

export { dirLabel };
