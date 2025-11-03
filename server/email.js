// server/email.js
import fetch from "node-fetch";

export async function sendMail({ to, subject, html, text }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "ATAG Jobs <noreply@atagjobs.email>";

  // Dev fallback: no email service configured
  if (!key) return { ok: true, via: "dev-no-email" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`email_send_failed ${res.status}: ${body}`);
  }
  return res.json();
}
