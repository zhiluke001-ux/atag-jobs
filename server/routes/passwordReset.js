// server/routes/passwordReset.js
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { sendMail } from "../email.js";

const TTL_MINUTES = Number(process.env.RESET_TOKEN_TTL_MINUTES || 60);

// Utility: build reset link
function buildResetLink(token) {
  const origin = process.env.APP_ORIGIN || "http://localhost:5173";
  // Your Reset page should read `token` query param.
  return `${origin.replace(/\/$/, "")}/reset?token=${encodeURIComponent(token)}`;
}

// Minimal email template
function resetEmailHTML(link) {
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <h2>Password reset</h2>
    <p>We received a request to reset your password. Click the button below:</p>
    <p><a href="${link}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#111;color:#fff;text-decoration:none">Reset Password</a></p>
    <p>Or copy this link:<br><a href="${link}">${link}</a></p>
    <p style="color:#666;font-size:12px">If you did not request this, you can ignore this email.</p>
  </div>`;
}

export function registerPasswordResetRoutes(app, prisma) {
  // POST /forgot-password  { email }
  app.post("/forgot-password", async (req, res) => {
    const { email } = req.body || {};
    if (!email || typeof email !== "string")
      return res.status(400).json({ error: "invalid_email" });

    // Always respond 200 to avoid email enumeration
    let user = null;
    try {
      user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    } catch (e) {
      // DB error shouldn't leak
    }

    try {
      if (user) {
        const token = jwt.sign(
          { sub: user.id, typ: "pwd_reset" },
          process.env.JWT_SECRET,
          { expiresIn: `${TTL_MINUTES}m` }
        );
        const link = buildResetLink(token);

        const html = resetEmailHTML(link);
        const text = `Reset your password: ${link}`;

        const emailRes = await sendMail({
          to: email,
          subject: "Reset your ATAG Jobs password",
          html,
          text,
        });

        // If no RESEND_API_KEY, we’re in dev: return token+link so the FE can show it
        if (emailRes?.via === "dev-no-email") {
          return res.json({ ok: true, via: "dev", token, resetLink: link });
        }

        return res.json({ ok: true, via: "email" });
      }

      // User not found: still return ok (no hints)
      return res.json({ ok: true, via: "noop" });
    } catch (err) {
      console.error("forgot-password error", err);
      return res.status(500).json({ error: "email_send_failed" });
    }
  });

  // POST /reset-password  { token, password }
  app.post("/reset-password", async (req, res) => {
    const { token, password } = req.body || {};
    if (!token || !password || password.length < 8) {
      return res.status(400).json({ error: "invalid_payload" });
    }

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (payload?.typ !== "pwd_reset" || !payload?.sub) {
        return res.status(400).json({ error: "bad_token_type" });
      }

      const userId = payload.sub;
      const hash = await bcrypt.hash(password, 10);

      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: hash },
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error("reset-password error", err);
      // Token errors
      if (err?.name === "TokenExpiredError")
        return res.status(400).json({ error: "token_expired" });
      if (err?.name === "JsonWebTokenError")
        return res.status(400).json({ error: "token_invalid" });

      return res.status(500).json({ error: "reset_failed" });
    }
  });
}
