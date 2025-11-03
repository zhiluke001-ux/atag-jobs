import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { Pool } from "pg";

const router = express.Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Neon
  ssl: { rejectUnauthorized: false },
});

const APP_BASE_URL = process.env.APP_BASE_URL || "https://your-app.onrender.com";
const MAIL_FROM = process.env.MAIL_FROM || "ATAG Auth <auth@yourdomain.com>";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";

/** Send email via Resend REST API */
async function sendResetEmail(to, resetLink) {
  if (!RESEND_API_KEY) {
    // Dev fallback: no-op (frontend will show dev link if backend returns it)
    console.warn("[auth] RESEND_API_KEY missing; not sending email. Link:", resetLink);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: MAIL_FROM,
      to,
      subject: "Reset your password",
      html: `
        <p>You requested a password reset.</p>
        <p><a href="${resetLink}">Click here to reset your password</a></p>
        <p>This link will expire in 60 minutes. If you did not request this, you can ignore this email.</p>
      `,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("[auth] Resend send failed:", res.status, t);
    throw new Error("Failed to send email");
  }
}

/** Generate random token */
function newToken() {
  return crypto.randomBytes(32).toString("hex");
}

/** POST /auth/forgot { email } */
router.post("/forgot", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "email_required" });

  const client = await pool.connect();
  try {
    // Lookup user (avoid timing side-channel leaks as much as possible)
    const u = await client.query(
      `SELECT id, email FROM users WHERE lower(email) = $1 LIMIT 1`,
      [email]
    );

    // Always behave as if it worked (no email enumeration)
    const token = newToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 60 minutes

    if (u.rowCount) {
      const user = u.rows[0];
      await client.query(
        `INSERT INTO password_reset_tokens (email, user_id, token, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [user.email, String(user.id), token, expiresAt]
      );
      const link = `${APP_BASE_URL}/#/reset?token=${encodeURIComponent(token)}`;
      await sendResetEmail(user.email, link);

      // In production, return no token/link. In dev, include them for convenience.
      if (process.env.NODE_ENV !== "production") {
        return res.json({ ok: true, token, resetLink: link });
      }
      return res.json({ ok: true });
    } else {
      // No user: still respond ok (no enumeration). Optionally burn a fake wait.
      if (process.env.NODE_ENV !== "production") {
        const link = `${APP_BASE_URL}/#/reset?token=${encodeURIComponent(token)}`;
        return res.json({ ok: true, token, resetLink: link, note: "dev-only: no such email" });
      }
      return res.json({ ok: true });
    }
  } catch (e) {
    console.error("[auth/forgot]", e);
    return res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

/** POST /auth/reset { token, password } */
router.post("/reset", async (req, res) => {
  const token = String(req.body?.token || "");
  const password = String(req.body?.password || "");

  if (!token) return res.status(400).json({ error: "token_required" });
  if (!password || password.length < 8) {
    return res.status(400).json({ error: "password_too_short" });
  }

  const client = await pool.connect();
  try {
    // 1) Load and validate token
    const t = await client.query(
      `SELECT id, email, user_id, expires_at, used
       FROM password_reset_tokens
       WHERE token = $1
       LIMIT 1`,
      [token]
    );
    if (!t.rowCount) return res.status(400).json({ error: "invalid_token" });

    const row = t.rows[0];
    if (row.used) return res.status(400).json({ error: "token_used" });
    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: "token_expired" });
    }

    // 2) Hash new password
    const hash = await bcrypt.hash(password, 10);

    // 3) Update user password (adjust to your schema as needed)
    const up = await client.query(
      `UPDATE users SET password_hash = $1, updated_at = now()
       WHERE lower(email) = $2
       RETURNING id`,
      [hash, row.email.toLowerCase()]
    );
    if (!up.rowCount) return res.status(400).json({ error: "user_not_found" });

    // 4) Mark token used and optionally invalidate all other tokens for this email
    await client.query(
      `UPDATE password_reset_tokens SET used = true, used_at = now() WHERE token = $1`,
      [token]
    );
    await client.query(
      `DELETE FROM password_reset_tokens WHERE email = $1 AND used = false`,
      [row.email.toLowerCase()]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("[auth/reset]", e);
    return res.status(500).json({ error: "server_error" });
  } finally {
    client.release();
  }
});

export default router;
