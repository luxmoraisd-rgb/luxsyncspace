import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { sql } from "../db/client.js";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { sendPasswordResetCode } from "../services/email.js";

export const authRouter = Router();

const newPasswordSchema = z.string().min(8, "New password must be at least 8 characters").max(128)
  .regex(/[A-Z]/, "New password must include an uppercase letter")
  .regex(/[a-z]/, "New password must include a lowercase letter")
  .regex(/[0-9]/, "New password must include a number")
  .regex(/[^A-Za-z0-9]/, "New password must include a special character");

function hashResetCode(userId, code) {
  return crypto.createHmac("sha256", config.jwtSecret).update(`${userId}:${code}`).digest("hex");
}

function resetCodeMatches(expected, actual) {
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

async function issuePasswordResetCode(user) {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const otpHash = hashResetCode(user.id, code);
  const [issued] = await sql`
    INSERT INTO password_reset_otps (user_id, otp_hash, expires_at, attempts, created_at)
    VALUES (${user.id}, ${otpHash}, NOW() + INTERVAL '10 minutes', 0, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      otp_hash = EXCLUDED.otp_hash,
      expires_at = EXCLUDED.expires_at,
      attempts = 0,
      created_at = NOW()
    WHERE password_reset_otps.created_at <= NOW() - INTERVAL '1 minute'
    RETURNING user_id
  `;
  if (!issued) return false;

  try {
    await sendPasswordResetCode({ to: user.email, fullName: user.full_name, code });
  } catch (error) {
    throw Object.assign(error, { passwordResetDeliveryFailure: true });
  }
  return true;
}

authRouter.post("/login", async (req, res, next) => {
  try {
    const input = z.object({ email: z.string().email(), password: z.string().min(8) }).parse(req.body);
    const [user] = await sql`
      SELECT u.*, o.name AS organization_name, m.full_name AS manager_name
      FROM users u JOIN organizations o ON o.id = u.organization_id
      LEFT JOIN users m ON m.id = u.manager_id
      WHERE lower(u.email) = lower(${input.email})
    `;
    if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
      return res.status(401).json({ error: "Email or password is incorrect" });
    }
    if ((user.employment_status || "active") !== "active") {
      return res.status(403).json({ error: user.employment_status === "offboarded" ? "Your account has been offboarded. Contact your administrator." : "This employee account is no longer active." });
    }
    await sql`UPDATE users SET presence = 'online', availability_status = 'online' WHERE id = ${user.id}`;
    user.presence = "online";
    user.availability_status = "online";
    const token = jwt.sign(
      { userId: user.id, organizationId: user.organization_id, email: user.email },
      config.jwtSecret,
      { expiresIn: "12h" }
    );
    delete user.password_hash;
    res.json({ token, user });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/forgot-password", async (req, res, next) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    const [user] = await sql`
      SELECT id, organization_id FROM users
      WHERE lower(email) = lower(${email}) AND employment_status = 'active'
    `;
    if (user) {
      await sql`
        INSERT INTO password_reset_requests (organization_id, user_id)
        VALUES (${user.organization_id}, ${user.id})
        ON CONFLICT (user_id) WHERE status = 'pending'
        DO UPDATE SET requested_at = NOW()
      `;
    }
    res.json({ message: "Your password reset request has been sent to the administrator. You will receive an email once it is completed." });
  } catch (error) { next(error); }
});

authRouter.post("/password-reset-otp", async (req, res, next) => {
  try {
    const { email } = z.object({ email: z.string().trim().email().max(254) }).parse(req.body);
    if (!config.smtp.host || !config.smtp.user || !config.smtp.password || !config.smtp.fromEmail) {
      return res.status(503).json({ error: "Password reset email is temporarily unavailable. Please contact your administrator." });
    }
    const [user] = await sql`
      SELECT id, email, full_name FROM users
      WHERE lower(email) = lower(${email}) AND employment_status = 'active'
    `;
    if (!user) return res.json({ message: "If an active account exists for that email, a verification code has been sent." });

    const issued = await issuePasswordResetCode(user);
    if (!issued) return res.status(429).json({ error: "Please wait one minute before requesting another code." });
    res.json({ message: "If an active account exists for that email, a verification code has been sent." });
  } catch (error) {
    if (error.passwordResetDeliveryFailure) {
      console.error("Password reset code delivery failed", { code: error.code, responseCode: error.responseCode });
      return res.status(503).json({ error: "Could not send a verification code. Please try again later." });
    }
    next(error);
  }
});

authRouter.post("/reset-password-otp", async (req, res, next) => {
  try {
    const input = z.object({
      email: z.string().trim().email().max(254),
      code: z.string().regex(/^\d{6}$/, "Enter the 6-digit verification code"),
      newPassword: newPasswordSchema,
      confirmPassword: z.string().min(1).max(128)
    }).parse(req.body);
    if (input.newPassword !== input.confirmPassword) {
      return res.status(400).json({ error: "New passwords do not match" });
    }

    const [user] = await sql`
      SELECT id, password_hash FROM users
      WHERE lower(email) = lower(${input.email}) AND employment_status = 'active'
    `;
    if (!user) return res.status(400).json({ error: "The verification code is invalid or expired" });

    const [reset] = await sql`
      SELECT otp_hash FROM password_reset_otps
      WHERE user_id = ${user.id} AND expires_at > NOW() AND attempts < 5
    `;
    if (!reset) return res.status(400).json({ error: "The verification code is invalid or expired" });

    const otpHash = hashResetCode(user.id, input.code);
    if (!resetCodeMatches(reset.otp_hash, otpHash)) {
      await sql`
        UPDATE password_reset_otps SET attempts = attempts + 1
        WHERE user_id = ${user.id} AND expires_at > NOW() AND attempts < 5
      `;
      return res.status(400).json({ error: "The verification code is invalid or expired" });
    }

    if (await bcrypt.compare(input.newPassword, user.password_hash)) {
      return res.status(400).json({ error: "Choose a password you have not used before" });
    }

    const passwordHash = await bcrypt.hash(input.newPassword, 12);
    const [updated] = await sql`
      WITH consumed AS (
        DELETE FROM password_reset_otps
        WHERE user_id = ${user.id} AND otp_hash = ${reset.otp_hash}
          AND expires_at > NOW() AND attempts < 5
        RETURNING user_id
      )
      UPDATE users
      SET password_hash = ${passwordHash}, must_change_password = FALSE
      WHERE id IN (SELECT user_id FROM consumed)
      RETURNING id
    `;
    if (!updated) return res.status(400).json({ error: "The verification code is invalid or expired" });
    res.json({ ok: true, message: "Your password has been reset." });
  } catch (error) { next(error); }
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const [user] = await sql`
    SELECT u.id, u.employee_id, u.email, u.full_name, u.title, u.department, u.role, u.phone, u.location,
           u.bio, u.joined_at, u.manager_id, u.must_change_password, u.initials, u.avatar_color, u.presence, u.availability_status, u.employment_status,
           u.display_name, u.hide_full_name, u.hide_email, u.onboarding_completed_at,
           o.name AS organization_name, m.full_name AS manager_name
    FROM users u JOIN organizations o ON o.id = u.organization_id
    LEFT JOIN users m ON m.id = u.manager_id
    WHERE u.id = ${req.auth.userId}
  `;
  res.json({ user });
});

authRouter.post("/change-password", requireAuth, async (req, res, next) => {
  try {
    const input = z.object({
      currentPassword: z.string().min(8).max(128),
      newPassword: newPasswordSchema,
      confirmPassword: z.string().min(1).max(128)
    }).parse(req.body);
    if (input.newPassword !== input.confirmPassword) {
      return res.status(400).json({ error: "New passwords do not match" });
    }
    const [user] = await sql`SELECT password_hash FROM users WHERE id = ${req.auth.userId}`;
    if (!user || !(await bcrypt.compare(input.currentPassword, user.password_hash))) {
      return res.status(400).json({ error: "Old password is incorrect" });
    }
    if (await bcrypt.compare(input.newPassword, user.password_hash)) {
      return res.status(400).json({ error: "Choose a password you have not used before" });
    }
    const passwordHash = await bcrypt.hash(input.newPassword, 12);
    await sql`UPDATE users SET password_hash = ${passwordHash}, must_change_password = FALSE WHERE id = ${req.auth.userId}`;
    res.json({ ok: true });
  } catch (error) { next(error); }
});
