import { Router } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import multer from "multer";
import { z } from "zod";
import { sql } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";
import { sendEmployeeInvitation, sendPasswordResetCompleted, sendSupportRequest } from "../services/email.js";
import { config } from "../config.js";
import { sendPushToChannel, sendPushToOrganization, sendPushToUser } from "../services/push.js";
import { cached, invalidateCache } from "../services/cache.js";

export const workspaceRouter = Router();
workspaceRouter.use(requireAuth);

const allowedAttachmentTypes = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf", "text/plain", "text/csv",
  "application/zip", "application/x-zip-compressed",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation"
]);
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => callback(
    allowedAttachmentTypes.has(file.mimetype) ? null : new Error("This file type is not supported"),
    allowedAttachmentTypes.has(file.mimetype)
  )
});

workspaceRouter.post("/attachments", (req, res, next) => {
  attachmentUpload.single("file")(req, res, async (uploadError) => {
    if (uploadError) {
      const status = uploadError.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return next(Object.assign(new Error(uploadError.code === "LIMIT_FILE_SIZE" ? "Files must be 8 MB or smaller" : uploadError.message), { status }));
    }
    try {
      if (!req.file) return res.status(400).json({ error: "Choose a file to attach" });
      const [attachment] = await sql`
        INSERT INTO message_attachments (organization_id, uploader_id, file_name, mime_type, file_size, data_base64)
        VALUES (${req.auth.organizationId}, ${req.auth.userId}, ${req.file.originalname.slice(0, 240)},
          ${req.file.mimetype}, ${req.file.size}, ${req.file.buffer.toString("base64")})
        RETURNING id, file_name, mime_type, file_size
      `;
      res.status(201).json({ ...attachment, url: `/api/attachments/${attachment.id}` });
    } catch (error) { next(error); }
  });
});

workspaceRouter.get("/attachments/:id", async (req, res, next) => {
  try {
    const [attachment] = await sql`
      SELECT a.file_name, a.mime_type, a.file_size, a.data_base64
      FROM message_attachments a
      WHERE a.id = ${req.params.id} AND a.organization_id = ${req.auth.organizationId}
        AND (
          EXISTS (
            SELECT 1 FROM channel_messages cm
            JOIN channel_members member ON member.channel_id = cm.channel_id
            WHERE cm.attachment_id = a.id AND member.user_id = ${req.auth.userId}
          )
          OR EXISTS (
            SELECT 1 FROM direct_messages dm
            WHERE dm.attachment_id = a.id
              AND (dm.sender_id = ${req.auth.userId} OR dm.recipient_id = ${req.auth.userId})
          )
        )
    `;
    if (!attachment) return res.status(404).json({ error: "Attachment not found" });
    const safeName = attachment.file_name.replace(/[\r\n"]/g, "_");
    const disposition = attachment.mime_type.startsWith("image/") ? "inline" : "attachment";
    res.set({
      "Content-Type": attachment.mime_type,
      "Content-Length": String(attachment.file_size),
      "Content-Disposition": `${disposition}; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600"
    });
    res.send(Buffer.from(attachment.data_base64, "base64"));
  } catch (error) { next(error); }
});

workspaceRouter.get("/bootstrap", async (req, res, next) => {
  try {
    const { userId, organizationId } = req.auth;
    const viewerRole = await currentRole(userId);
    const [people, channels, events, announcements, channelUnreadRows, directUnreadRows] = await Promise.all([
      cached(`people:${organizationId}`, 30_000, () => sql`SELECT u.id, u.employee_id, u.email, u.full_name, u.title, u.department, u.role, u.phone, u.location,
             u.bio, u.joined_at, u.manager_id, u.initials, u.avatar_color, u.presence, u.availability_status,
             u.employment_status, u.offboarded_at, u.deleted_at, u.display_name, u.hide_full_name,
             u.hide_email, u.onboarding_completed_at,
             CASE WHEN m.hide_full_name THEN COALESCE(NULLIF(m.display_name, ''), 'Team member') ELSE m.full_name END AS manager_name
          FROM users u LEFT JOIN users m ON m.id = u.manager_id
          WHERE u.organization_id = ${organizationId} ORDER BY u.full_name`),
      cached(`channel-memberships:${organizationId}`, 10_000, () => sql`
          SELECT c.id, c.name, c.description, c.is_private, c.created_by, m.muted, m.user_id,
             COALESCE(message_stats.message_count, 0)::int AS message_count
          FROM channels c
          JOIN channel_members m ON m.channel_id = c.id
          LEFT JOIN (
            SELECT channel_id, COUNT(*)::int AS message_count
            FROM channel_messages GROUP BY channel_id
          ) message_stats ON message_stats.channel_id = c.id
          WHERE c.organization_id = ${organizationId}
          ORDER BY c.name
        `).then((memberships) => memberships.filter((membership) => membership.user_id === userId)),
      cached(`events:${organizationId}`, 15_000, () => sql`SELECT e.*,
             CASE WHEN u.hide_full_name THEN COALESCE(NULLIF(u.display_name, ''), 'Team member') ELSE u.full_name END AS organizer_name,
             COALESCE(json_agg(json_build_object('id', a.id, 'name', CASE WHEN a.hide_full_name THEN COALESCE(NULLIF(a.display_name, ''), 'Team member') ELSE a.full_name END, 'initials', a.initials, 'color', a.avatar_color))
               FILTER (WHERE a.id IS NOT NULL), '[]') AS attendees
          FROM events e
          JOIN users u ON u.id = e.organizer_id
          LEFT JOIN event_attendees ea ON ea.event_id = e.id
          LEFT JOIN users a ON a.id = ea.user_id
          WHERE e.organization_id = ${organizationId}
            AND e.starts_at >= date_trunc('day', NOW()) - INTERVAL '1 day'
            AND e.starts_at < date_trunc('day', NOW()) + INTERVAL '14 days'
          GROUP BY e.id, u.full_name, u.hide_full_name, u.display_name ORDER BY e.starts_at`)
      ,
      cached(`announcements:${organizationId}`, 30_000, () => sql`SELECT a.id, a.title, a.body, a.priority, a.published_at,
             CASE WHEN u.hide_full_name THEN COALESCE(NULLIF(u.display_name, ''), 'Team member') ELSE u.full_name END AS author_name,
             u.initials AS author_initials, u.avatar_color AS author_color
          FROM announcements a JOIN users u ON u.id = a.author_id
          WHERE a.organization_id = ${organizationId}
          ORDER BY a.published_at DESC LIMIT 20`),
      sql`SELECT member.channel_id, COUNT(message.id)::int AS unread_count
          FROM channel_members member
          LEFT JOIN channel_messages message ON message.channel_id = member.channel_id
            AND message.sender_id <> ${userId}
            AND message.deleted_at IS NULL
            AND (member.last_read_at IS NULL OR message.sent_at > member.last_read_at)
          WHERE member.user_id = ${userId}
          GROUP BY member.channel_id`,
      sql`SELECT sender_id, COUNT(*)::int AS unread_count
          FROM direct_messages
          WHERE recipient_id = ${userId} AND read_at IS NULL
          GROUP BY sender_id`
    ]);
    const channelUnread = new Map(channelUnreadRows.map((row) => [row.channel_id, row.unread_count]));
    const directoryPeople = people
      .filter((person) => (person.employment_status || "active") === "active")
      .map((person) => person.id === userId ? person : {
        ...person,
        full_name: person.hide_full_name ? (person.display_name || "Team member") : person.full_name,
        email: person.hide_email ? null : person.email
      });
    res.json({
      people: directoryPeople,
      workforce: workforceRoles.has(viewerRole) ? people : undefined,
      channels: channels.map((channel) => ({ ...channel, unread_count: channelUnread.get(channel.id) || 0 })),
      events,
      announcements,
      directUnreadCounts: Object.fromEntries(directUnreadRows.map((row) => [row.sender_id, row.unread_count]))
    });
  } catch (error) {
    next(error);
  }
});

const groupRoles = new Set(["hr", "senior_leader", "manager", "team_lead"]);
const announcementRoles = new Set(["hr", "senior_leader"]);
const inviteRoles = new Set(["hr", "senior_leader", "manager"]);
const workforceRoles = new Set(["hr", "senior_leader"]);

workspaceRouter.get("/password-reset-requests", async (req, res, next) => {
  try {
    if (await currentRole(req.auth.userId) !== "senior_leader") return res.status(403).json({ error: "Only the administrator can view password reset requests" });
    const requests = await sql`
      SELECT request.id, request.status, request.requested_at, request.completed_at,
             employee.id AS user_id, employee.full_name, employee.email, employee.employee_id,
             employee.title, employee.department
      FROM password_reset_requests request
      JOIN users employee ON employee.id = request.user_id
      WHERE request.organization_id = ${req.auth.organizationId}
      ORDER BY CASE WHEN request.status = 'pending' THEN 0 ELSE 1 END, request.requested_at DESC
      LIMIT 100
    `;
    res.json({ requests });
  } catch (error) { next(error); }
});

workspaceRouter.post("/employees/:id/password-reset", async (req, res, next) => {
  try {
    if (await currentRole(req.auth.userId) !== "senior_leader") return res.status(403).json({ error: "Only the administrator can reset employee passwords" });
    const employeeId = z.string().uuid().parse(req.params.id);
    if (employeeId === req.auth.userId) return res.status(400).json({ error: "Use your account security settings to change your own password" });
    const [employee] = await sql`
      SELECT id, email, full_name, password_hash, must_change_password FROM users
      WHERE id = ${employeeId} AND organization_id = ${req.auth.organizationId} AND employment_status = 'active'
    `;
    if (!employee) return res.status(404).json({ error: "Active employee not found" });
    const temporaryPassword = `Ls!${crypto.randomBytes(9).toString("base64url")}7`;
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    await sql`UPDATE users SET password_hash = ${passwordHash}, must_change_password = TRUE WHERE id = ${employee.id}`;
    try {
      await sendPasswordResetCompleted({ to: employee.email, fullName: employee.full_name, temporaryPassword });
    } catch (emailError) {
      await sql`UPDATE users SET password_hash = ${employee.password_hash}, must_change_password = ${employee.must_change_password} WHERE id = ${employee.id}`;
      throw Object.assign(new Error("The reset email could not be delivered, so the employee password was not changed."), { status: 502, cause: emailError });
    }
    await sql`
      UPDATE password_reset_requests SET status = 'completed', completed_at = NOW(), completed_by = ${req.auth.userId}
      WHERE user_id = ${employee.id} AND organization_id = ${req.auth.organizationId} AND status = 'pending'
    `;
    req.app.get("io")?.in(`user:${employee.id}`).disconnectSockets(true);
    res.json({ message: `${employee.full_name}'s password was reset and a temporary password was emailed.` });
  } catch (error) { next(error); }
});

workspaceRouter.patch("/presence", async (req, res, next) => {
  try {
    const { status } = z.object({
      status: z.enum(["online", "break", "lunch", "unavailable", "meeting", "offline"])
    }).parse(req.body);
    const legacyPresence = status === "online" ? "online" : status === "offline" ? "offline" : status === "unavailable" ? "busy" : "away";
    const [updated] = await sql`
      UPDATE users SET availability_status = ${status}, presence = ${legacyPresence}
      WHERE id = ${req.auth.userId} AND organization_id = ${req.auth.organizationId}
      RETURNING id, presence, availability_status
    `;
    invalidateCache(`people:${req.auth.organizationId}`);
    req.app.get("io")?.to(`org:${req.auth.organizationId}`).emit("presence:updated", updated);
    res.json(updated);
  } catch (error) { next(error); }
});

workspaceRouter.patch("/profile/privacy", async (req, res, next) => {
  try {
    const input = z.object({
      displayName: z.string().trim().max(80).default(""),
      hideFullName: z.boolean().default(false),
      hideEmail: z.boolean().default(false)
    }).refine((value) => !value.hideFullName || value.displayName.length >= 2, { message: "Add a display name before hiding your full name" }).parse(req.body);
    const [user] = await sql`
      UPDATE users
      SET display_name = ${input.displayName || null}, hide_full_name = ${input.hideFullName}, hide_email = ${input.hideEmail}
      WHERE id = ${req.auth.userId} AND organization_id = ${req.auth.organizationId}
      RETURNING id, display_name, hide_full_name, hide_email
    `;
    invalidateCache(`people:${req.auth.organizationId}`);
    req.app.get("io")?.to(`org:${req.auth.organizationId}`).emit("profile:privacy-updated", { id: user.id });
    res.json({ user, message: "Directory privacy updated" });
  } catch (error) { next(error); }
});

workspaceRouter.post("/onboarding/complete", async (req, res, next) => {
  try {
    const [user] = await sql`
      UPDATE users SET onboarding_completed_at = NOW()
      WHERE id = ${req.auth.userId}
      RETURNING id, onboarding_completed_at
    `;
    res.json(user);
  } catch (error) { next(error); }
});

async function markChannelRead(req, channelId) {
  const [receipt] = await sql`
    UPDATE channel_members member
    SET last_read_at = NOW()
    FROM channels channel
    WHERE member.channel_id = channel.id
      AND member.channel_id = ${channelId}
      AND member.user_id = ${req.auth.userId}
      AND channel.organization_id = ${req.auth.organizationId}
    RETURNING member.last_read_at
  `;
  if (!receipt) return null;

  const seenMessages = await sql`
    SELECT message.id
    FROM channel_messages message
    WHERE message.channel_id = ${channelId}
      AND message.sender_id <> ${req.auth.userId}
      AND message.sent_at <= ${receipt.last_read_at}
      AND NOT EXISTS (
        SELECT 1
        FROM channel_members reader
        WHERE reader.channel_id = message.channel_id
          AND reader.user_id <> message.sender_id
          AND (reader.last_read_at IS NULL OR reader.last_read_at < message.sent_at)
      )
    ORDER BY message.sent_at DESC
    LIMIT 200
  `;
  const result = {
    channelId,
    userId: req.auth.userId,
    readAt: receipt.last_read_at,
    seenMessageIds: seenMessages.map((message) => message.id)
  };
  req.app.get("io")?.to(`channel:${channelId}`).emit("channel:read", result);
  return result;
}

async function currentRole(userId) {
  const [user] = await sql`SELECT role FROM users WHERE id = ${userId}`;
  return user?.role;
}

async function isMainAdministrator(req, res) {
  if (await currentRole(req.auth.userId) === "senior_leader") return true;
  res.status(403).json({ error: "Only the main administrator can view chat history" });
  return false;
}

workspaceRouter.get("/admin/chat-history/conversations", async (req, res, next) => {
  try {
    if (!await isMainAdministrator(req, res)) return;
    const [directConversations, channelConversations] = await Promise.all([
      sql`
        WITH pairs AS (
          SELECT LEAST(sender_id, recipient_id) AS first_user_id,
                 GREATEST(sender_id, recipient_id) AS second_user_id,
                 COUNT(*)::int AS message_count,
                 MIN(sent_at) AS started_at,
                 MAX(sent_at) AS latest_at
          FROM direct_messages
          WHERE organization_id = ${req.auth.organizationId}
          GROUP BY LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id)
        )
        SELECT CONCAT('direct:', pairs.first_user_id, ':', pairs.second_user_id) AS id,
               'direct' AS kind,
               pairs.first_user_id, pairs.second_user_id, pairs.message_count,
               pairs.started_at, pairs.latest_at,
               first_user.full_name AS first_user_name,
               first_user.employee_id AS first_employee_id,
               second_user.full_name AS second_user_name,
               second_user.employee_id AS second_employee_id,
               latest.preview AS last_message
        FROM pairs
        JOIN users first_user ON first_user.id = pairs.first_user_id
        JOIN users second_user ON second_user.id = pairs.second_user_id
        LEFT JOIN LATERAL (
          SELECT CASE
            WHEN message.deleted_at IS NOT NULL THEN 'Message deleted'
            WHEN NULLIF(message.body, '') IS NOT NULL THEN message.body
            WHEN message.attachment_id IS NOT NULL THEN 'Attachment'
            ELSE 'Message'
          END AS preview
          FROM direct_messages message
          WHERE message.organization_id = ${req.auth.organizationId}
            AND LEAST(message.sender_id, message.recipient_id) = pairs.first_user_id
            AND GREATEST(message.sender_id, message.recipient_id) = pairs.second_user_id
          ORDER BY message.sent_at DESC, message.id DESC
          LIMIT 1
        ) latest ON TRUE
        ORDER BY pairs.latest_at DESC
        LIMIT 300
      `,
      sql`
        WITH channel_stats AS (
          SELECT channel.id AS channel_id, channel.name, channel.is_private,
                 COUNT(message.id)::int AS message_count,
                 MIN(message.sent_at) AS started_at,
                 MAX(message.sent_at) AS latest_at
          FROM channels channel
          JOIN channel_messages message ON message.channel_id = channel.id
          WHERE channel.organization_id = ${req.auth.organizationId}
          GROUP BY channel.id, channel.name, channel.is_private
        )
        SELECT CONCAT('channel:', stats.channel_id) AS id, 'channel' AS kind,
               stats.channel_id, stats.name, stats.is_private, stats.message_count,
               stats.started_at, stats.latest_at,
               (SELECT COUNT(*)::int FROM channel_members WHERE channel_id = stats.channel_id) AS participant_count,
               latest.preview AS last_message
        FROM channel_stats stats
        LEFT JOIN LATERAL (
          SELECT CASE
            WHEN message.deleted_at IS NOT NULL THEN 'Message deleted'
            WHEN NULLIF(message.body, '') IS NOT NULL THEN message.body
            WHEN message.attachment_id IS NOT NULL THEN 'Attachment'
            ELSE 'Message'
          END AS preview
          FROM channel_messages message
          WHERE message.channel_id = stats.channel_id
          ORDER BY message.sent_at DESC, message.id DESC
          LIMIT 1
        ) latest ON TRUE
        ORDER BY stats.latest_at DESC
        LIMIT 300
      `
    ]);
    const conversations = [...directConversations, ...channelConversations]
      .sort((left, right) => new Date(right.latest_at) - new Date(left.latest_at));
    res.json({ conversations });
  } catch (error) { next(error); }
});

workspaceRouter.get("/admin/chat-history/direct/:firstUserId/:secondUserId", async (req, res, next) => {
  try {
    if (!await isMainAdministrator(req, res)) return;
    const params = z.object({ firstUserId: z.string().uuid(), secondUserId: z.string().uuid() }).parse(req.params);
    const page = z.coerce.number().int().min(0).max(10000).default(0).parse(req.query.page);
    const pageSize = 100;
    const offset = page * pageSize;
    const [participants, countRows, messages] = await Promise.all([
      sql`
        SELECT id, full_name, employee_id
        FROM users
        WHERE organization_id = ${req.auth.organizationId}
          AND id IN (${params.firstUserId}, ${params.secondUserId})
        ORDER BY full_name
      `,
      sql`
        SELECT COUNT(*)::int AS total
        FROM direct_messages
        WHERE organization_id = ${req.auth.organizationId}
          AND ((sender_id = ${params.firstUserId} AND recipient_id = ${params.secondUserId})
            OR (sender_id = ${params.secondUserId} AND recipient_id = ${params.firstUserId}))
      `,
      sql`
        SELECT message.id, message.body, message.sent_at, message.edited_at, message.deleted_at,
               message.read_at, sender.id AS sender_id, sender.full_name AS sender_name,
               recipient.id AS recipient_id, recipient.full_name AS recipient_name,
               attachment.id AS attachment_id, attachment.file_name, attachment.mime_type, attachment.file_size
        FROM direct_messages message
        JOIN users sender ON sender.id = message.sender_id
        JOIN users recipient ON recipient.id = message.recipient_id
        LEFT JOIN message_attachments attachment ON attachment.id = message.attachment_id
        WHERE message.organization_id = ${req.auth.organizationId}
          AND ((message.sender_id = ${params.firstUserId} AND message.recipient_id = ${params.secondUserId})
            OR (message.sender_id = ${params.secondUserId} AND message.recipient_id = ${params.firstUserId}))
        ORDER BY message.sent_at DESC, message.id DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `
    ]);
    if (participants.length !== 2) return res.status(404).json({ error: "Conversation not found" });
    res.json({ participants, messages: messages.reverse(), total: countRows[0]?.total || 0, page, pageSize });
  } catch (error) { next(error); }
});

workspaceRouter.get("/admin/chat-history/channels/:channelId", async (req, res, next) => {
  try {
    if (!await isMainAdministrator(req, res)) return;
    const channelId = z.string().uuid().parse(req.params.channelId);
    const page = z.coerce.number().int().min(0).max(10000).default(0).parse(req.query.page);
    const pageSize = 100;
    const offset = page * pageSize;
    const [channels, countRows, messages] = await Promise.all([
      sql`
        SELECT channel.id, channel.name, channel.is_private,
               COALESCE(json_agg(json_build_object('id', member.id, 'name', member.full_name)
                 ORDER BY member.full_name) FILTER (WHERE member.id IS NOT NULL), '[]') AS participants
        FROM channels channel
        LEFT JOIN channel_members membership ON membership.channel_id = channel.id
        LEFT JOIN users member ON member.id = membership.user_id
        WHERE channel.id = ${channelId} AND channel.organization_id = ${req.auth.organizationId}
        GROUP BY channel.id
      `,
      sql`
        SELECT COUNT(message.id)::int AS total
        FROM channel_messages message
        JOIN channels channel ON channel.id = message.channel_id
        WHERE message.channel_id = ${channelId} AND channel.organization_id = ${req.auth.organizationId}
      `,
      sql`
        SELECT message.id, message.body, message.sent_at, message.edited_at, message.deleted_at,
               sender.id AS sender_id, sender.full_name AS sender_name,
               attachment.id AS attachment_id, attachment.file_name, attachment.mime_type, attachment.file_size
        FROM channel_messages message
        JOIN channels channel ON channel.id = message.channel_id
        JOIN users sender ON sender.id = message.sender_id
        LEFT JOIN message_attachments attachment ON attachment.id = message.attachment_id
        WHERE message.channel_id = ${channelId} AND channel.organization_id = ${req.auth.organizationId}
        ORDER BY message.sent_at DESC, message.id DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `
    ]);
    if (!channels[0]) return res.status(404).json({ error: "Group conversation not found" });
    res.json({ channel: channels[0], messages: messages.reverse(), total: countRows[0]?.total || 0, page, pageSize });
  } catch (error) { next(error); }
});

async function shareMeetingInvitation({ req, event, recipientIds, organizer, isCall = false }) {
  if (!recipientIds.length) return;
  const meetingUrl = `${config.appUrl}/?meeting=${event.id}`;
  const messageBody = `${isCall ? `${event.meeting_mode === "audio" ? "Voice" : "Video"} call` : "Meeting invitation"}: ${event.title}\n${meetingUrl}`;
  const messages = await sql`
    INSERT INTO direct_messages (organization_id, sender_id, recipient_id, body)
    SELECT ${req.auth.organizationId}, ${req.auth.userId}, recipient_id, ${messageBody}
    FROM unnest(${recipientIds}::uuid[]) AS recipient_id
    RETURNING id, recipient_id, body, sent_at
  `;
  for (const message of messages) {
    const realtimeMessage = {
      ...message,
      sender_id: req.auth.userId,
      sender_name: organizer.full_name,
      initials: organizer.initials,
      avatar_color: organizer.avatar_color
    };
    req.app.get("io")?.to(`user:${message.recipient_id}`).emit("direct:message", realtimeMessage);
    if (isCall) {
      req.app.get("io")?.to(`user:${message.recipient_id}`).emit("call:incoming", {
        meeting: event,
        caller: organizer,
        mode: event.meeting_mode
      });
    }
    sendPushToUser(message.recipient_id, {
      title: isCall
        ? `Incoming ${event.meeting_mode === "audio" ? "voice" : "video"} call from ${organizer.full_name}`
        : `Meeting invitation from ${organizer.full_name}`,
      body: event.title,
      tag: `${isCall ? "call" : "meeting-invite"}-${event.id}`,
      url: `/?meeting=${event.id}`,
      ...(isCall ? {
        type: "call",
        meetingId: event.id,
        mode: event.meeting_mode
      } : {})
    }).catch(console.error);
  }
}

workspaceRouter.post("/channels", async (req, res, next) => {
  try {
    const input = z.object({
      name: z.string().trim().min(2, "Group name must contain at least 2 letters or numbers").max(60, "Group name must be 60 characters or fewer").regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Group name can only contain letters, numbers, and single hyphens"),
      description: z.string().trim().max(300).default(""),
      memberIds: z.array(z.string().uuid()).default([]),
      isPrivate: z.boolean().default(false)
    }).parse(req.body);
    const initialMemberIds = [...new Set([req.auth.userId, ...input.memberIds])];
    const validUsers = await sql`
      SELECT id FROM users WHERE organization_id = ${req.auth.organizationId}
        AND employment_status = 'active' AND id = ANY(${initialMemberIds}::uuid[])
    `;
    if (validUsers.length !== initialMemberIds.length) return res.status(400).json({ error: "One or more employees are not available" });
    const [channel] = await sql`
      INSERT INTO channels (organization_id, name, description, is_private, created_by)
      VALUES (${req.auth.organizationId}, ${input.name}, ${input.description}, ${input.isPrivate}, ${req.auth.userId})
      RETURNING *
    `;
    await sql`
      INSERT INTO channel_members (channel_id, user_id)
      SELECT ${channel.id}, member_id FROM unnest(${initialMemberIds}::uuid[]) AS member_id
      ON CONFLICT DO NOTHING
    `;
    invalidateCache("channel-memberships:", "socket-memberships:");
    res.status(201).json(channel);
  } catch (error) {
    if (error?.code === "23505") return res.status(409).json({ error: "A group with this name already exists" });
    next(error);
  }
});

workspaceRouter.get("/channels/:id/members", async (req, res, next) => {
  try {
    const [membership] = await sql`
      SELECT 1 FROM channel_members cm
      JOIN channels c ON c.id = cm.channel_id
      WHERE cm.channel_id = ${req.params.id} AND cm.user_id = ${req.auth.userId}
        AND c.organization_id = ${req.auth.organizationId}
    `;
    if (!membership) return res.status(403).json({ error: "You are not a member of this group" });
    const members = await sql`
      SELECT u.id, u.employee_id, CASE WHEN u.hide_full_name THEN COALESCE(NULLIF(u.display_name, ''), 'Team member') ELSE u.full_name END AS full_name,
             u.title, u.department, u.initials, u.avatar_color, u.presence
      FROM channel_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.channel_id = ${req.params.id}
      ORDER BY u.full_name
    `;
    res.json({ members });
  } catch (error) { next(error); }
});

workspaceRouter.put("/channels/:id/members", async (req, res, next) => {
  try {
    const role = await currentRole(req.auth.userId);
    const { memberIds } = z.object({ memberIds: z.array(z.string().uuid()).max(500) }).parse(req.body);
    const [channel] = await sql`
      SELECT id, created_by FROM channels WHERE id = ${req.params.id} AND organization_id = ${req.auth.organizationId}
    `;
    if (!channel) return res.status(404).json({ error: "Group not found" });
    if (!groupRoles.has(role) && channel.created_by !== req.auth.userId) {
      return res.status(403).json({ error: "Only the group creator or a team manager can manage group members" });
    }
    const requested = [...new Set([req.auth.userId, ...memberIds])];
    const validUsers = await sql`
      SELECT id FROM users WHERE organization_id = ${req.auth.organizationId}
        AND id = ANY(${requested}::uuid[])
    `;
    if (validUsers.length !== requested.length) return res.status(400).json({ error: "One or more employees are not available" });
    const previousMembers = await sql`SELECT user_id FROM channel_members WHERE channel_id = ${req.params.id}`;
    await sql`DELETE FROM channel_members WHERE channel_id = ${req.params.id} AND user_id <> ALL(${requested}::uuid[])`;
    await sql`
      INSERT INTO channel_members (channel_id, user_id)
      SELECT ${req.params.id}, member_id FROM unnest(${requested}::uuid[]) AS member_id
      ON CONFLICT DO NOTHING
    `;
    const removedIds = previousMembers.map((member) => member.user_id).filter((id) => !requested.includes(id));
    const addedIds = requested.filter((id) => !previousMembers.some((member) => member.user_id === id));
    for (const removedId of removedIds) {
      req.app.get("io")?.in(`user:${removedId}`).socketsLeave(`channel:${req.params.id}`);
      req.app.get("io")?.to(`user:${removedId}`).emit("channel:membership-updated", { channel_id: req.params.id, action: "removed" });
    }
    for (const addedId of addedIds) {
      req.app.get("io")?.in(`user:${addedId}`).socketsJoin(`channel:${req.params.id}`);
      req.app.get("io")?.to(`user:${addedId}`).emit("channel:membership-updated", { channel_id: req.params.id, action: "added" });
    }
    invalidateCache("channel-memberships:", "socket-memberships:");
    const members = await sql`
      SELECT u.id, u.employee_id, CASE WHEN u.hide_full_name THEN COALESCE(NULLIF(u.display_name, ''), 'Team member') ELSE u.full_name END AS full_name,
             u.title, u.department, u.initials, u.avatar_color, u.presence
      FROM channel_members cm JOIN users u ON u.id = cm.user_id
      WHERE cm.channel_id = ${req.params.id} ORDER BY u.full_name
    `;
    res.json({ members, message: "Group members updated" });
  } catch (error) { next(error); }
});

workspaceRouter.patch("/channels/:id/preferences", async (req, res, next) => {
  try {
    const { muted } = z.object({ muted: z.boolean() }).parse(req.body);
    const [membership] = await sql`
      UPDATE channel_members cm
      SET muted = ${muted}
      FROM channels c
      WHERE cm.channel_id = ${req.params.id} AND cm.user_id = ${req.auth.userId}
        AND c.id = cm.channel_id AND c.organization_id = ${req.auth.organizationId}
      RETURNING cm.muted
    `;
    if (!membership) return res.status(404).json({ error: "Group membership not found" });
    invalidateCache(`channel-memberships:${req.auth.organizationId}`, `socket-memberships:${req.auth.organizationId}`);
    res.json({ muted: membership.muted, message: muted ? "Group notifications muted" : "Group notifications enabled" });
  } catch (error) { next(error); }
});

workspaceRouter.delete("/channels/:id", async (req, res, next) => {
  try {
    const role = await currentRole(req.auth.userId);
    const [channel] = await sql`
      SELECT id, name, created_by FROM channels
      WHERE id = ${req.params.id} AND organization_id = ${req.auth.organizationId}
    `;
    if (!channel) return res.status(404).json({ error: "Group not found" });
    const canDelete = ["hr", "senior_leader"].includes(role) || channel.created_by === req.auth.userId;
    if (!canDelete) return res.status(403).json({ error: "Only the group creator, HR, or a senior leader can delete this group" });
    await sql`
      DELETE FROM message_attachments a
      WHERE a.id IN (SELECT attachment_id FROM channel_messages WHERE channel_id = ${channel.id} AND attachment_id IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM direct_messages dm WHERE dm.attachment_id = a.id)
        AND NOT EXISTS (SELECT 1 FROM channel_messages cm WHERE cm.attachment_id = a.id AND cm.channel_id <> ${channel.id})
    `;
    await sql`DELETE FROM channels WHERE id = ${channel.id}`;
    invalidateCache("channel-memberships:", "socket-memberships:");
    req.app.get("io")?.to(`channel:${channel.id}`).emit("channel:deleted", { channel_id: channel.id });
    req.app.get("io")?.in(`channel:${channel.id}`).socketsLeave(`channel:${channel.id}`);
    res.json({ message: `#${channel.name} was permanently deleted` });
  } catch (error) { next(error); }
});

workspaceRouter.post("/announcements", async (req, res, next) => {
  try {
    const role = await currentRole(req.auth.userId);
    if (!announcementRoles.has(role)) return res.status(403).json({ error: "Only HR and senior leaders can publish company announcements" });
    const input = z.object({
      title: z.string().trim().min(2).max(180),
      body: z.string().trim().min(2).max(5000),
      priority: z.enum(["normal", "important"]).default("normal")
    }).parse(req.body);
    const [announcement] = await sql`
      INSERT INTO announcements (organization_id, author_id, title, body, priority)
      VALUES (${req.auth.organizationId}, ${req.auth.userId}, ${input.title}, ${input.body}, ${input.priority})
      RETURNING *
    `;
    const [author] = await sql`SELECT full_name AS author_name FROM users WHERE id = ${req.auth.userId}`;
    invalidateCache(`announcements:${req.auth.organizationId}`);
    req.app.get("io")?.to(`org:${req.auth.organizationId}`).emit("announcement:new", { ...announcement, ...author });
    sendPushToOrganization(req.auth.organizationId, req.auth.userId, {
      title: `Company announcement: ${input.title}`,
      body: input.body.slice(0, 180),
      tag: `announcement-${announcement.id}`,
      url: "/"
    }).catch(console.error);
    res.status(201).json(announcement);
  } catch (error) { next(error); }
});

workspaceRouter.post("/invitations", async (req, res, next) => {
  try {
    const role = await currentRole(req.auth.userId);
    if (!inviteRoles.has(role)) return res.status(403).json({ error: "Only HR, managers, and senior leaders can invite employees" });
    const input = z.object({
      fullName: z.string().trim().min(2).max(120),
      employeeId: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,30}$/, "Employee ID must use letters, numbers, or hyphens").or(z.literal("")).default(""),
      email: z.string().email(),
      title: z.string().trim().min(2).max(120),
      role: z.enum(["employee", "team_lead", "manager", "hr"]).default("employee"),
      department: z.string().trim().min(2).max(100),
      phone: z.string().trim().max(40).default(""),
      location: z.string().trim().max(120).default(""),
      bio: z.string().trim().max(1000).default(""),
      managerId: z.union([z.string().uuid(), z.literal(""), z.null()]).default(""),
      joinedAt: z.string().date()
    }).parse(req.body);
    const [existing] = await sql`SELECT id FROM users WHERE lower(email) = lower(${input.email})`;
    if (existing) return res.status(409).json({ error: "An employee with this email already exists" });
    if (input.employeeId) {
      const [existingId] = await sql`SELECT id FROM users WHERE organization_id = ${req.auth.organizationId} AND employee_id = ${input.employeeId}`;
      if (existingId) return res.status(409).json({ error: "This employee ID is already assigned" });
    }
    if (input.managerId) {
      const [manager] = await sql`SELECT id FROM users WHERE id = ${input.managerId} AND organization_id = ${req.auth.organizationId}`;
      if (!manager) return res.status(400).json({ error: "The selected reporting manager is not available" });
    }

    const token = crypto.randomBytes(24).toString("hex");
    const temporaryPassword = `Ls!${crypto.randomBytes(9).toString("base64url")}7`;
    const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    let employeeId = input.employeeId;
    if (!employeeId) {
      const [{ next_id: nextId }] = await sql`
        SELECT GREATEST(
          COALESCE(MAX(NULLIF(regexp_replace(employee_id, '\\D', '', 'g'), '')::int), 1000) + 1,
          1001
        )::int AS next_id
        FROM users WHERE organization_id = ${req.auth.organizationId}
      `;
      employeeId = `LUX-${String(nextId).padStart(4, "0")}`;
    }
    const initials = input.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    const [employee] = await sql`
      INSERT INTO users (
        organization_id, employee_id, email, password_hash, full_name, title, department, role,
        initials, avatar_color, presence, phone, location, bio, manager_id, joined_at, must_change_password,
        onboarding_completed_at
      )
      VALUES (
        ${req.auth.organizationId}, ${employeeId}, ${input.email}, ${passwordHash}, ${input.fullName},
        ${input.title}, ${input.department}, ${input.role}, ${initials}, '#3768D8', 'offline',
        ${input.phone}, ${input.location}, ${input.bio}, ${input.managerId || null}, ${input.joinedAt}, TRUE, NULL
      )
      RETURNING id, employee_id, email, full_name, title, department, role, phone, location, bio, manager_id, joined_at
    `;
    await sql`
      INSERT INTO channel_members (channel_id, user_id)
      SELECT id, ${employee.id} FROM channels
      WHERE organization_id = ${req.auth.organizationId} AND is_private = FALSE
      ON CONFLICT DO NOTHING
    `;
    await sql`
      INSERT INTO invitations (organization_id, token, email, role, department, created_by, expires_at)
      VALUES (${req.auth.organizationId}, ${token}, ${input.email}, ${input.role}, ${input.department}, ${req.auth.userId}, NOW() + INTERVAL '1 day')
    `;
    try {
      await sendEmployeeInvitation({
        to: input.email,
        fullName: input.fullName,
        temporaryPassword,
        employeeId,
        department: input.department,
        title: input.title
      });
    } catch (emailError) {
      await sql`DELETE FROM users WHERE id = ${employee.id}`;
      await sql`DELETE FROM invitations WHERE token = ${token}`;
      throw Object.assign(new Error("Employee email could not be delivered. No account was created."), { status: 502, cause: emailError });
    }
    invalidateCache(`people:${req.auth.organizationId}`, "channel-memberships:", "socket-memberships:");
    res.status(201).json({ employee, message: "Employee account created and invitation email sent" });
  } catch (error) {
    if (error?.code === "23505") return res.status(409).json({ error: "This email address or employee ID already exists" });
    next(error);
  }
});

workspaceRouter.patch("/employees/:id", async (req, res, next) => {
  try {
    const role = await currentRole(req.auth.userId);
    if (!inviteRoles.has(role)) return res.status(403).json({ error: "Only HR, managers, and senior leaders can edit employee details" });

    const employeeId = z.string().uuid().parse(req.params.id);
    const input = z.object({
      fullName: z.string().trim().min(2).max(120),
      employeeId: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,30}$/, "Employee ID must use letters, numbers, or hyphens"),
      email: z.string().trim().email(),
      title: z.string().trim().min(2).max(120),
      role: z.enum(["employee", "team_lead", "manager", "hr", "senior_leader"]),
      department: z.string().trim().min(2).max(100),
      phone: z.string().trim().max(40).default(""),
      location: z.string().trim().max(120).default(""),
      bio: z.string().trim().max(1000).default(""),
      managerId: z.union([z.string().uuid(), z.literal(""), z.null()]).default(""),
      joinedAt: z.string().date()
    }).parse(req.body);

    const [target] = await sql`
      SELECT id, role FROM users
      WHERE id = ${employeeId} AND organization_id = ${req.auth.organizationId}
    `;
    if (!target) return res.status(404).json({ error: "Employee not found" });
    if (role === "manager" && (["hr", "senior_leader"].includes(target.role) || ["hr", "senior_leader"].includes(input.role))) {
      return res.status(403).json({ error: "Managers cannot change HR or senior leader accounts" });
    }
    if (role === "hr" && (target.role === "senior_leader" || input.role === "senior_leader")) {
      return res.status(403).json({ error: "Only a senior leader can change senior leader accounts" });
    }
    if (input.managerId === employeeId) return res.status(400).json({ error: "An employee cannot be their own reporting manager" });
    if (input.managerId) {
      const [manager] = await sql`
        SELECT id FROM users WHERE id = ${input.managerId} AND organization_id = ${req.auth.organizationId}
      `;
      if (!manager) return res.status(400).json({ error: "The selected reporting manager is not available" });
    }

    const initials = input.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    const [employee] = await sql`
      UPDATE users
      SET employee_id = ${input.employeeId}, email = ${input.email}, full_name = ${input.fullName},
          title = ${input.title}, department = ${input.department}, role = ${input.role},
          phone = ${input.phone}, location = ${input.location}, bio = ${input.bio},
          manager_id = ${input.managerId || null}, joined_at = ${input.joinedAt}, initials = ${initials}
      WHERE id = ${employeeId} AND organization_id = ${req.auth.organizationId}
      RETURNING id, employee_id, email, full_name, title, department, role, phone, location,
                bio, manager_id, joined_at, initials, avatar_color, presence
    `;
    const [manager] = employee.manager_id
      ? await sql`SELECT full_name AS manager_name FROM users WHERE id = ${employee.manager_id}`
      : [];
    invalidateCache(`people:${req.auth.organizationId}`, "socket-memberships:");
    res.json({ employee: { ...employee, manager_name: manager?.manager_name || null }, message: "Employee details updated" });
  } catch (error) {
    if (error?.code === "23505") return res.status(409).json({ error: "This email address or employee ID already exists" });
    next(error);
  }
});

workspaceRouter.patch("/employees/:id/employment", async (req, res, next) => {
  try {
    const role = await currentRole(req.auth.userId);
    if (!workforceRoles.has(role)) return res.status(403).json({ error: "Only HR and senior administrators can manage employment status" });
    const employeeId = z.string().uuid().parse(req.params.id);
    const { status } = z.object({ status: z.enum(["active", "offboarded", "deleted"]) }).parse(req.body);
    if (employeeId === req.auth.userId) return res.status(400).json({ error: "You cannot change your own employment status" });
    const [target] = await sql`
      SELECT id, role, employment_status FROM users
      WHERE id = ${employeeId} AND organization_id = ${req.auth.organizationId}
    `;
    if (!target) return res.status(404).json({ error: "Employee not found" });
    if (target.role === "senior_leader" && role !== "senior_leader") {
      return res.status(403).json({ error: "Only a senior administrator can manage this account" });
    }
    const [employee] = await sql`
      UPDATE users
      SET employment_status = ${status},
          offboarded_at = CASE WHEN ${status} = 'offboarded' THEN NOW() ELSE NULL END,
          deleted_at = CASE WHEN ${status} = 'deleted' THEN NOW() ELSE NULL END,
          presence = CASE WHEN ${status} = 'active' THEN presence ELSE 'offline' END,
          availability_status = CASE WHEN ${status} = 'active' THEN availability_status ELSE 'offline' END
      WHERE id = ${employeeId} AND organization_id = ${req.auth.organizationId}
      RETURNING id, employee_id, email, full_name, title, department, role, initials, avatar_color,
                presence, availability_status, employment_status, offboarded_at, deleted_at
    `;
    if (status === "active") {
      await sql`
        INSERT INTO channel_members (channel_id, user_id)
        SELECT id, ${employeeId} FROM channels
        WHERE organization_id = ${req.auth.organizationId} AND is_private = FALSE
        ON CONFLICT DO NOTHING
      `;
    } else {
      req.app.get("io")?.in(`user:${employeeId}`).disconnectSockets(true);
    }
    invalidateCache(`people:${req.auth.organizationId}`, "socket-memberships:");
    req.app.get("io")?.to(`org:${req.auth.organizationId}`).emit("employee:status-updated", employee);
    const action = status === "active" ? "reactivated" : status === "offboarded" ? "offboarded" : "deleted";
    res.json({ employee, message: `${employee.full_name} has been ${action}` });
  } catch (error) { next(error); }
});

workspaceRouter.get("/channels/:id/messages", async (req, res, next) => {
  try {
    const receipt = await markChannelRead(req, req.params.id);
    if (!receipt) return res.status(403).json({ error: "You are not a member of this channel" });
    const messages = await sql`
      SELECT cm.id, cm.body, cm.sent_at, u.id AS sender_id,
             CASE WHEN u.hide_full_name THEN COALESCE(NULLIF(u.display_name, ''), 'Team member') ELSE u.full_name END AS sender_name,
             u.initials, u.avatar_color, u.title, a.id AS attachment_id, a.file_name,
             a.mime_type, a.file_size, cm.deleted_at, cm.reply_to_id, cm.forwarded_from_id,
             reply.body AS reply_body, CASE WHEN reply_user.hide_full_name THEN COALESCE(NULLIF(reply_user.display_name, ''), 'Team member') ELSE reply_user.full_name END AS reply_sender_name,
             reply.deleted_at AS reply_deleted_at,
             COALESCE((
               SELECT json_agg(json_build_object(
                 'emoji', grouped.emoji,
                 'count', grouped.reaction_count,
                 'reacted_by_me', grouped.reacted_by_me
               ) ORDER BY grouped.first_reaction)
               FROM (
                 SELECT reaction.emoji, COUNT(*)::int AS reaction_count,
                        BOOL_OR(reaction.user_id = ${req.auth.userId}) AS reacted_by_me,
                        MIN(reaction.reacted_at) AS first_reaction
                 FROM channel_message_reactions reaction
                 WHERE reaction.message_id = cm.id
                 GROUP BY reaction.emoji
               ) grouped
             ), '[]'::json) AS reactions,
             NOT EXISTS (
               SELECT 1 FROM channel_members reader
               WHERE reader.channel_id = cm.channel_id
                 AND reader.user_id <> cm.sender_id
                 AND (reader.last_read_at IS NULL OR reader.last_read_at < cm.sent_at)
             ) AS seen_by_all
      FROM channel_messages cm JOIN users u ON u.id = cm.sender_id
      LEFT JOIN message_attachments a ON a.id = cm.attachment_id
      LEFT JOIN channel_messages reply ON reply.id = cm.reply_to_id
      LEFT JOIN users reply_user ON reply_user.id = reply.sender_id
      JOIN channel_members member ON member.channel_id = cm.channel_id AND member.user_id = ${req.auth.userId}
      WHERE cm.channel_id = ${req.params.id}
        AND NOT EXISTS (
          SELECT 1 FROM channel_message_hidden hidden
          WHERE hidden.message_id = cm.id AND hidden.user_id = ${req.auth.userId}
        )
      ORDER BY cm.sent_at ASC LIMIT 200
    `;
    res.json({ messages });
  } catch (error) { next(error); }
});

workspaceRouter.post("/channels/:id/read", async (req, res, next) => {
  try {
    const receipt = await markChannelRead(req, req.params.id);
    if (!receipt) return res.status(403).json({ error: "You are not a member of this channel" });
    res.json(receipt);
  } catch (error) { next(error); }
});

workspaceRouter.post("/channels/:id/messages", async (req, res, next) => {
  try {
    const input = z.object({
      body: z.string().trim().max(5000).default(""),
      attachmentId: z.string().uuid().nullable().optional(),
      replyTo: z.string().uuid().nullable().optional(),
      forwardedFrom: z.string().uuid().nullable().optional()
    }).refine((value) => value.body || value.attachmentId || value.forwardedFrom, { message: "Enter a message or attach a file" }).parse(req.body);
    const [membership] = await sql`SELECT 1 FROM channel_members WHERE channel_id = ${req.params.id} AND user_id = ${req.auth.userId}`;
    if (!membership) return res.status(403).json({ error: "You are not a member of this channel" });
    const [message] = await sql`
      INSERT INTO channel_messages (channel_id, sender_id, body, attachment_id, reply_to_id, forwarded_from_id)
      SELECT ${req.params.id}, ${req.auth.userId}, ${input.body},
        COALESCE(a.id, (
          SELECT forwarded.attachment_id FROM channel_messages forwarded
          JOIN channel_members forwarded_access ON forwarded_access.channel_id = forwarded.channel_id
            AND forwarded_access.user_id = ${req.auth.userId}
          WHERE forwarded.id = ${input.forwardedFrom || null} AND forwarded.deleted_at IS NULL
        )),
        (SELECT reply.id FROM channel_messages reply
         WHERE reply.id = ${input.replyTo || null} AND reply.channel_id = ${req.params.id} AND reply.deleted_at IS NULL),
        (SELECT forwarded.id FROM channel_messages forwarded
         JOIN channel_members access ON access.channel_id = forwarded.channel_id AND access.user_id = ${req.auth.userId}
         WHERE forwarded.id = ${input.forwardedFrom || null} AND forwarded.deleted_at IS NULL)
      FROM (SELECT 1) seed
      LEFT JOIN message_attachments a ON a.id = ${input.attachmentId || null}
        AND a.organization_id = ${req.auth.organizationId} AND a.uploader_id = ${req.auth.userId}
      WHERE ${input.attachmentId || null}::uuid IS NULL OR a.id IS NOT NULL
      RETURNING id, body, sent_at, attachment_id, reply_to_id, forwarded_from_id
    `;
    if (!message) return res.status(400).json({ error: "The selected attachment is not available" });
    const [attachment] = message.attachment_id ? await sql`
      SELECT file_name, mime_type, file_size FROM message_attachments WHERE id = ${message.attachment_id}
    ` : [null];
    const [sender] = await sql`SELECT id AS sender_id, CASE WHEN hide_full_name THEN COALESCE(NULLIF(display_name, ''), 'Team member') ELSE full_name END AS sender_name, initials, avatar_color, title FROM users WHERE id = ${req.auth.userId}`;
    const [unreadMember] = await sql`
      SELECT 1 FROM channel_members
      WHERE channel_id = ${req.params.id}
        AND user_id <> ${req.auth.userId}
        AND (last_read_at IS NULL OR last_read_at < ${message.sent_at})
      LIMIT 1
    `;
    const [reply] = message.reply_to_id ? await sql`
      SELECT original.body AS reply_body, original.deleted_at AS reply_deleted_at,
             CASE WHEN author.hide_full_name THEN COALESCE(NULLIF(author.display_name, ''), 'Team member') ELSE author.full_name END AS reply_sender_name
      FROM channel_messages original
      JOIN users author ON author.id = original.sender_id
      WHERE original.id = ${message.reply_to_id}
    ` : [null];
    const result = {
      ...message,
      ...sender,
      ...attachment,
      ...reply,
      channel_id: req.params.id,
      seen_by_all: !unreadMember,
      reactions: []
    };
    req.app.get("io")?.to(`channel:${req.params.id}`).emit("channel:message", result);
    const [channel] = await sql`SELECT name FROM channels WHERE id = ${req.params.id}`;
    sendPushToChannel(req.params.id, req.auth.userId, {
      title: `${sender.sender_name} in #${channel?.name || "group"}`,
      body: (input.body || `Shared ${attachment?.file_name || "a file"}`).slice(0, 180),
      tag: `channel-${req.params.id}`,
      url: "/"
    }).catch(console.error);
    res.status(201).json(result);
  } catch (error) { next(error); }
});

workspaceRouter.delete("/channels/:channelId/messages/:messageId", async (req, res, next) => {
  try {
    const scope = z.enum(["me", "everyone"]).parse(req.query.scope || "me");
    const [membership] = await sql`
      SELECT 1 FROM channel_members
      WHERE channel_id = ${req.params.channelId} AND user_id = ${req.auth.userId}
    `;
    if (!membership) return res.status(403).json({ error: "You are not a member of this channel" });

    if (scope === "me") {
      const [hidden] = await sql`
        INSERT INTO channel_message_hidden (message_id, user_id)
        SELECT message.id, ${req.auth.userId}
        FROM channel_messages message
        WHERE message.id = ${req.params.messageId} AND message.channel_id = ${req.params.channelId}
        ON CONFLICT DO NOTHING
        RETURNING message_id
      `;
      if (!hidden) {
        const [existing] = await sql`
          SELECT 1 FROM channel_message_hidden
          WHERE message_id = ${req.params.messageId} AND user_id = ${req.auth.userId}
        `;
        if (!existing) return res.status(404).json({ error: "Message not found" });
      }
      return res.json({ id: req.params.messageId, scope });
    }

    const [deleted] = await sql`
      UPDATE channel_messages
      SET body = '', attachment_id = NULL, deleted_at = NOW(), deleted_by = ${req.auth.userId}
      WHERE id = ${req.params.messageId} AND channel_id = ${req.params.channelId}
        AND sender_id = ${req.auth.userId} AND deleted_at IS NULL
      RETURNING id, deleted_at
    `;
    if (!deleted) return res.status(403).json({ error: "Only the sender can delete this message for everyone" });
    await sql`DELETE FROM channel_message_reactions WHERE message_id = ${deleted.id}`;
    const result = { id: deleted.id, channelId: req.params.channelId, deleted_at: deleted.deleted_at, scope };
    req.app.get("io")?.to(`channel:${req.params.channelId}`).emit("channel:message-deleted", result);
    res.json(result);
  } catch (error) { next(error); }
});

workspaceRouter.patch("/channels/:channelId/messages/:messageId", async (req, res, next) => {
  try {
    const { body } = z.object({ body: z.string().trim().min(1).max(5000) }).parse(req.body);
    const [updated] = await sql`
      UPDATE channel_messages message
      SET body = ${body}, edited_at = NOW()
      FROM channel_members member
      WHERE message.id = ${req.params.messageId}
        AND message.channel_id = ${req.params.channelId}
        AND message.sender_id = ${req.auth.userId}
        AND message.deleted_at IS NULL
        AND member.channel_id = message.channel_id
        AND member.user_id = ${req.auth.userId}
      RETURNING message.id, message.body, message.edited_at
    `;
    if (!updated) return res.status(403).json({ error: "Only the sender can edit this message" });
    const result = { ...updated, channelId: req.params.channelId };
    req.app.get("io")?.to(`channel:${req.params.channelId}`).emit("channel:message-edited", result);
    res.json(result);
  } catch (error) { next(error); }
});

workspaceRouter.post("/channels/:channelId/messages/:messageId/reactions", async (req, res, next) => {
  try {
    const { emoji } = z.object({ emoji: z.string().trim().min(1).max(16) }).parse(req.body);
    const [message] = await sql`
      SELECT channel_message.id
      FROM channel_messages channel_message
      JOIN channel_members member ON member.channel_id = channel_message.channel_id
      WHERE channel_message.id = ${req.params.messageId}
        AND channel_message.channel_id = ${req.params.channelId}
        AND channel_message.deleted_at IS NULL
        AND member.user_id = ${req.auth.userId}
    `;
    if (!message) return res.status(404).json({ error: "Message not found" });
    const [existing] = await sql`
      SELECT emoji FROM channel_message_reactions
      WHERE message_id = ${req.params.messageId} AND user_id = ${req.auth.userId}
    `;
    const userEmoji = existing?.emoji === emoji ? null : emoji;
    if (!userEmoji) {
      await sql`
        DELETE FROM channel_message_reactions
        WHERE message_id = ${req.params.messageId} AND user_id = ${req.auth.userId}
      `;
    } else {
      await sql`
        INSERT INTO channel_message_reactions (message_id, user_id, emoji)
        VALUES (${req.params.messageId}, ${req.auth.userId}, ${emoji})
        ON CONFLICT (message_id, user_id) DO UPDATE
        SET emoji = EXCLUDED.emoji, reacted_at = NOW()
      `;
    }
    const reactions = await sql`
      SELECT reaction.emoji, COUNT(*)::int AS count,
             BOOL_OR(reaction.user_id = ${req.auth.userId}) AS reacted_by_me
      FROM channel_message_reactions reaction
      WHERE reaction.message_id = ${req.params.messageId}
      GROUP BY reaction.emoji
      ORDER BY MIN(reaction.reacted_at)
    `;
    const result = {
      id: req.params.messageId,
      channelId: req.params.channelId,
      actorId: req.auth.userId,
      userEmoji,
      reactions
    };
    req.app.get("io")?.to(`channel:${req.params.channelId}`).emit("channel:message-reaction", result);
    res.json(result);
  } catch (error) { next(error); }
});

workspaceRouter.get("/direct/:userId", async (req, res, next) => {
  try {
    const [colleague] = await sql`SELECT id FROM users WHERE id = ${req.params.userId} AND organization_id = ${req.auth.organizationId}`;
    if (!colleague) return res.status(404).json({ error: "Employee not found" });
    await sql`
      UPDATE direct_messages SET read_at = NOW()
      WHERE organization_id = ${req.auth.organizationId}
        AND sender_id = ${req.params.userId}
        AND recipient_id = ${req.auth.userId}
        AND read_at IS NULL
    `;
    const messages = await sql`
      SELECT dm.id, dm.body, dm.sent_at, u.id AS sender_id,
             CASE WHEN u.hide_full_name THEN COALESCE(NULLIF(u.display_name, ''), 'Team member') ELSE u.full_name END AS sender_name,
             u.initials, u.avatar_color,
             a.id AS attachment_id, a.file_name, a.mime_type, a.file_size,
             dm.deleted_at, dm.edited_at, dm.reply_to_id,
             reply.body AS reply_body, reply.deleted_at AS reply_deleted_at,
             CASE WHEN reply_user.hide_full_name THEN COALESCE(NULLIF(reply_user.display_name, ''), 'Team member') ELSE reply_user.full_name END AS reply_sender_name,
             COALESCE((
               SELECT json_agg(json_build_object(
                 'emoji', grouped.emoji,
                 'count', grouped.reaction_count,
                 'reacted_by_me', grouped.reacted_by_me
               ) ORDER BY grouped.first_reaction)
               FROM (
                 SELECT reaction.emoji, COUNT(*)::int AS reaction_count,
                        BOOL_OR(reaction.user_id = ${req.auth.userId}) AS reacted_by_me,
                        MIN(reaction.reacted_at) AS first_reaction
                 FROM direct_message_reactions reaction
                 WHERE reaction.message_id = dm.id
                 GROUP BY reaction.emoji
               ) grouped
             ), '[]'::json) AS reactions
      FROM direct_messages dm JOIN users u ON u.id = dm.sender_id
      LEFT JOIN message_attachments a ON a.id = dm.attachment_id
      LEFT JOIN direct_messages reply ON reply.id = dm.reply_to_id
      LEFT JOIN users reply_user ON reply_user.id = reply.sender_id
      WHERE dm.organization_id = ${req.auth.organizationId}
        AND ((dm.sender_id = ${req.auth.userId} AND dm.recipient_id = ${req.params.userId})
          OR (dm.sender_id = ${req.params.userId} AND dm.recipient_id = ${req.auth.userId}))
        AND NOT EXISTS (
          SELECT 1 FROM direct_message_hidden hidden
          WHERE hidden.message_id = dm.id AND hidden.user_id = ${req.auth.userId}
        )
      ORDER BY dm.sent_at ASC LIMIT 300
    `;
    res.json({ messages });
  } catch (error) { next(error); }
});

workspaceRouter.post("/direct/:userId/read", async (req, res, next) => {
  try {
    const result = await sql`
      UPDATE direct_messages SET read_at = NOW()
      WHERE organization_id = ${req.auth.organizationId}
        AND sender_id = ${req.params.userId}
        AND recipient_id = ${req.auth.userId}
        AND read_at IS NULL
      RETURNING id
    `;
    res.json({ userId: req.params.userId, readCount: result.length });
  } catch (error) { next(error); }
});

workspaceRouter.post("/direct/:userId", async (req, res, next) => {
  try {
    const input = z.object({
      body: z.string().trim().max(5000).default(""),
      attachmentId: z.string().uuid().nullable().optional(),
      replyTo: z.string().uuid().nullable().optional()
    }).refine((value) => value.body || value.attachmentId, { message: "Enter a message or attach a file" }).parse(req.body);
    const [colleague] = await sql`SELECT id FROM users WHERE id = ${req.params.userId} AND organization_id = ${req.auth.organizationId}`;
    if (!colleague || colleague.id === req.auth.userId) return res.status(400).json({ error: "Select another employee" });
    const [message] = await sql`
      INSERT INTO direct_messages (organization_id, sender_id, recipient_id, body, attachment_id, reply_to_id)
      SELECT ${req.auth.organizationId}, ${req.auth.userId}, ${req.params.userId}, ${input.body}, a.id,
        (SELECT reply.id FROM direct_messages reply
         WHERE reply.id = ${input.replyTo || null}
           AND reply.organization_id = ${req.auth.organizationId}
           AND ((reply.sender_id = ${req.auth.userId} AND reply.recipient_id = ${req.params.userId})
             OR (reply.sender_id = ${req.params.userId} AND reply.recipient_id = ${req.auth.userId}))
           AND reply.deleted_at IS NULL)
      FROM (SELECT 1) seed
      LEFT JOIN message_attachments a ON a.id = ${input.attachmentId || null}
        AND a.organization_id = ${req.auth.organizationId} AND a.uploader_id = ${req.auth.userId}
      WHERE ${input.attachmentId || null}::uuid IS NULL OR a.id IS NOT NULL
      RETURNING id, body, sent_at, attachment_id, reply_to_id
    `;
    if (!message) return res.status(400).json({ error: "The selected attachment is not available" });
    const [attachment] = message.attachment_id ? await sql`
      SELECT file_name, mime_type, file_size FROM message_attachments WHERE id = ${message.attachment_id}
    ` : [null];
    const [sender] = await sql`SELECT id AS sender_id, CASE WHEN hide_full_name THEN COALESCE(NULLIF(display_name, ''), 'Team member') ELSE full_name END AS sender_name, initials, avatar_color FROM users WHERE id = ${req.auth.userId}`;
    const [reply] = message.reply_to_id ? await sql`
      SELECT original.body AS reply_body, original.deleted_at AS reply_deleted_at,
             CASE WHEN author.hide_full_name THEN COALESCE(NULLIF(author.display_name, ''), 'Team member') ELSE author.full_name END AS reply_sender_name
      FROM direct_messages original JOIN users author ON author.id = original.sender_id
      WHERE original.id = ${message.reply_to_id}
    ` : [null];
    const result = { ...message, ...sender, ...attachment, ...reply, reactions: [] };
    req.app.get("io")?.to(`user:${req.params.userId}`).emit("direct:message", { ...result, recipient_id: req.params.userId });
    sendPushToUser(req.params.userId, {
      title: sender.sender_name,
      body: (input.body || `Shared ${attachment?.file_name || "a file"}`).slice(0, 180),
      tag: `direct-${req.auth.userId}`,
      url: "/"
    }).catch(console.error);
    res.status(201).json(result);
  } catch (error) { next(error); }
});

workspaceRouter.patch("/direct/:userId/messages/:messageId", async (req, res, next) => {
  try {
    const { body } = z.object({ body: z.string().trim().min(1).max(5000) }).parse(req.body);
    const [updated] = await sql`
      UPDATE direct_messages
      SET body = ${body}, edited_at = NOW()
      WHERE id = ${req.params.messageId}
        AND organization_id = ${req.auth.organizationId}
        AND sender_id = ${req.auth.userId}
        AND recipient_id = ${req.params.userId}
        AND deleted_at IS NULL
      RETURNING id, body, edited_at, sender_id, recipient_id
    `;
    if (!updated) return res.status(403).json({ error: "Only the sender can edit this message" });
    for (const userId of [updated.sender_id, updated.recipient_id]) {
      req.app.get("io")?.to(`user:${userId}`).emit("direct:message-edited", updated);
    }
    res.json(updated);
  } catch (error) { next(error); }
});

workspaceRouter.delete("/direct/:userId/messages/:messageId", async (req, res, next) => {
  try {
    const scope = z.enum(["me", "everyone"]).parse(req.query.scope || "me");
    const [message] = await sql`
      SELECT id, sender_id, recipient_id, deleted_at
      FROM direct_messages
      WHERE id = ${req.params.messageId} AND organization_id = ${req.auth.organizationId}
        AND ((sender_id = ${req.auth.userId} AND recipient_id = ${req.params.userId})
          OR (sender_id = ${req.params.userId} AND recipient_id = ${req.auth.userId}))
    `;
    if (!message) return res.status(404).json({ error: "Message not found" });
    if (scope === "me") {
      await sql`
        INSERT INTO direct_message_hidden (message_id, user_id)
        VALUES (${message.id}, ${req.auth.userId}) ON CONFLICT DO NOTHING
      `;
      return res.json({ id: message.id, scope });
    }
    if (message.sender_id !== req.auth.userId) return res.status(403).json({ error: "Only the sender can delete this message for everyone" });
    const [deleted] = await sql`
      UPDATE direct_messages
      SET body = '', attachment_id = NULL, deleted_at = NOW(), deleted_by = ${req.auth.userId}
      WHERE id = ${message.id} AND deleted_at IS NULL
      RETURNING id, deleted_at, sender_id, recipient_id
    `;
    if (!deleted) return res.status(400).json({ error: "This message is already deleted" });
    await sql`DELETE FROM direct_message_reactions WHERE message_id = ${deleted.id}`;
    const result = { ...deleted, scope };
    for (const userId of [deleted.sender_id, deleted.recipient_id]) {
      req.app.get("io")?.to(`user:${userId}`).emit("direct:message-deleted", result);
    }
    res.json(result);
  } catch (error) { next(error); }
});

workspaceRouter.post("/direct/:userId/messages/:messageId/reactions", async (req, res, next) => {
  try {
    const { emoji } = z.object({ emoji: z.string().trim().min(1).max(16) }).parse(req.body);
    const [message] = await sql`
      SELECT id, sender_id, recipient_id FROM direct_messages
      WHERE id = ${req.params.messageId} AND organization_id = ${req.auth.organizationId}
        AND deleted_at IS NULL
        AND ((sender_id = ${req.auth.userId} AND recipient_id = ${req.params.userId})
          OR (sender_id = ${req.params.userId} AND recipient_id = ${req.auth.userId}))
    `;
    if (!message) return res.status(404).json({ error: "Message not found" });
    const [existing] = await sql`
      SELECT emoji FROM direct_message_reactions
      WHERE message_id = ${message.id} AND user_id = ${req.auth.userId}
    `;
    const userEmoji = existing?.emoji === emoji ? null : emoji;
    if (!userEmoji) {
      await sql`DELETE FROM direct_message_reactions WHERE message_id = ${message.id} AND user_id = ${req.auth.userId}`;
    } else {
      await sql`
        INSERT INTO direct_message_reactions (message_id, user_id, emoji)
        VALUES (${message.id}, ${req.auth.userId}, ${emoji})
        ON CONFLICT (message_id, user_id) DO UPDATE SET emoji = EXCLUDED.emoji, reacted_at = NOW()
      `;
    }
    const reactions = await sql`
      SELECT emoji, COUNT(*)::int AS count,
             BOOL_OR(user_id = ${req.auth.userId}) AS reacted_by_me
      FROM direct_message_reactions WHERE message_id = ${message.id}
      GROUP BY emoji ORDER BY MIN(reacted_at)
    `;
    const result = { id: message.id, actorId: req.auth.userId, userEmoji, reactions, sender_id: message.sender_id, recipient_id: message.recipient_id };
    for (const userId of [message.sender_id, message.recipient_id]) {
      req.app.get("io")?.to(`user:${userId}`).emit("direct:message-reaction", result);
    }
    res.json(result);
  } catch (error) { next(error); }
});

workspaceRouter.post("/events", async (req, res, next) => {
  try {
    const input = z.object({
      title: z.string().trim().min(1).max(180),
      description: z.string().max(5000).default(""),
      location: z.string().max(255).default("LuxSyncspace meeting"),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
      attendeeIds: z.array(z.string().uuid()).default([])
    }).parse(req.body);
    if (new Date(input.endsAt) <= new Date(input.startsAt)) return res.status(400).json({ error: "End time must be after start time" });
    const selectedAttendees = [...new Set(input.attendeeIds)].filter((id) => id !== req.auth.userId);
    const validAttendees = selectedAttendees.length ? await sql`
      SELECT id FROM users WHERE organization_id = ${req.auth.organizationId} AND id = ANY(${selectedAttendees}::uuid[])
    ` : [];
    if (validAttendees.length !== selectedAttendees.length) return res.status(400).json({ error: "One or more selected employees are unavailable" });
    const [event] = await sql`
      INSERT INTO events (organization_id, organizer_id, title, description, location, starts_at, ends_at)
      VALUES (${req.auth.organizationId}, ${req.auth.userId}, ${input.title}, ${input.description}, ${input.location}, ${input.startsAt}, ${input.endsAt})
      RETURNING *
    `;
    const allAttendeeIds = [...new Set([req.auth.userId, ...input.attendeeIds])];
    await sql`
      INSERT INTO event_attendees (event_id, user_id, response)
      SELECT ${event.id}, attendee_id, 'accepted' FROM unnest(${allAttendeeIds}::uuid[]) AS attendee_id
      ON CONFLICT DO NOTHING
    `;
    const attendeeIds = selectedAttendees;
    const [organizer] = await sql`SELECT full_name, initials, avatar_color FROM users WHERE id = ${req.auth.userId}`;
    await shareMeetingInvitation({ req, event, recipientIds: attendeeIds, organizer });
    invalidateCache(`events:${req.auth.organizationId}`);
    res.status(201).json(event);
  } catch (error) { next(error); }
});

workspaceRouter.post("/events/:eventId/attendees", async (req, res, next) => {
  try {
    const eventId = z.string().uuid().parse(req.params.eventId);
    const input = z.object({ attendeeIds: z.array(z.string().uuid()).min(1).max(100) }).parse(req.body);
    const [event] = await sql`
      SELECT * FROM events
      WHERE id = ${eventId} AND organization_id = ${req.auth.organizationId}
    `;
    if (!event) return res.status(404).json({ error: "Event or meeting not found" });
    if (event.cancelled_at) return res.status(400).json({ error: "People cannot be added to a cancelled meeting" });

    const role = await currentRole(req.auth.userId);
    const canManage = event.organizer_id === req.auth.userId || ["hr", "senior_leader"].includes(role);
    if (!canManage) return res.status(403).json({ error: "Only the organizer, HR, or a senior leader can add people" });

    const requestedIds = [...new Set(input.attendeeIds)].filter((id) => id !== req.auth.userId);
    const validPeople = requestedIds.length ? await sql`
      SELECT id FROM users
      WHERE organization_id = ${req.auth.organizationId}
        AND id = ANY(${requestedIds}::uuid[])
        AND employment_status = 'active'
    ` : [];
    if (validPeople.length !== requestedIds.length) return res.status(400).json({ error: "One or more selected employees are unavailable" });

    const existing = requestedIds.length ? await sql`
      SELECT user_id FROM event_attendees
      WHERE event_id = ${eventId} AND user_id = ANY(${requestedIds}::uuid[])
    ` : [];
    const existingIds = new Set(existing.map((attendee) => attendee.user_id));
    const newAttendeeIds = requestedIds.filter((id) => !existingIds.has(id));
    if (!newAttendeeIds.length) return res.json({ added: 0, message: "Everyone selected is already invited" });

    await sql`
      INSERT INTO event_attendees (event_id, user_id, response)
      SELECT ${eventId}, attendee_id, 'accepted'
      FROM unnest(${newAttendeeIds}::uuid[]) AS attendee_id
      ON CONFLICT DO NOTHING
    `;
    const [organizer] = await sql`SELECT full_name, initials, avatar_color FROM users WHERE id = ${req.auth.userId}`;
    await shareMeetingInvitation({ req, event, recipientIds: newAttendeeIds, organizer });
    invalidateCache(`events:${req.auth.organizationId}`);
    res.json({ added: newAttendeeIds.length, message: `${newAttendeeIds.length} ${newAttendeeIds.length === 1 ? "person" : "people"} added and invited` });
  } catch (error) { next(error); }
});

workspaceRouter.post("/meetings/instant", async (req, res, next) => {
  try {
    const input = z.object({
      title: z.string().trim().min(2).max(180).default("Instant team meeting"),
      attendeeIds: z.array(z.string().uuid()).max(100).default([]),
      mode: z.enum(["audio", "video"]).default("video"),
      isCall: z.boolean().default(false)
    }).parse(req.body || {});
    const recipientIds = [...new Set(input.attendeeIds)].filter((id) => id !== req.auth.userId);
    const validRecipients = recipientIds.length ? await sql`
      SELECT id FROM users WHERE organization_id = ${req.auth.organizationId} AND id = ANY(${recipientIds}::uuid[])
    ` : [];
    if (validRecipients.length !== recipientIds.length) return res.status(400).json({ error: "One or more selected employees are unavailable" });
    const [event] = await sql`
      INSERT INTO events (organization_id, organizer_id, title, description, location, starts_at, ends_at, is_online, meeting_mode)
      VALUES (${req.auth.organizationId}, ${req.auth.userId}, ${input.title}, 'Instant LuxSyncspace meeting',
        'LuxSyncspace meeting', NOW(), NOW() + INTERVAL '1 hour', TRUE, ${input.mode})
      RETURNING *
    `;
    await sql`
      INSERT INTO event_attendees (event_id, user_id, response)
      SELECT ${event.id}, attendee_id, 'accepted'
      FROM unnest(${[req.auth.userId, ...recipientIds]}::uuid[]) AS attendee_id
      ON CONFLICT DO NOTHING
    `;
    const [organizer] = await sql`SELECT id, full_name, initials, avatar_color, title FROM users WHERE id = ${req.auth.userId}`;
    await shareMeetingInvitation({ req, event, recipientIds, organizer, isCall: input.isCall });
    invalidateCache(`events:${req.auth.organizationId}`);
    res.status(201).json(event);
  } catch (error) { next(error); }
});

workspaceRouter.post("/meetings/:eventId/end", async (req, res, next) => {
  try {
    const eventId = z.string().uuid().parse(req.params.eventId);
    const [meeting] = await sql`
      SELECT id, title, organizer_id, ended_at
      FROM events
      WHERE id = ${eventId} AND organization_id = ${req.auth.organizationId} AND is_online = TRUE
    `;
    if (!meeting) return res.status(404).json({ error: "Meeting not found" });
    if (meeting.organizer_id !== req.auth.userId) {
      return res.status(403).json({ error: "Only the meeting organizer can end the meeting for everyone" });
    }
    if (meeting.ended_at) return res.json({ meeting, message: "This meeting has already ended" });

    const [ended] = await sql`
      UPDATE events
      SET ended_at = NOW(), ended_by = ${req.auth.userId},
          ends_at = GREATEST(starts_at + INTERVAL '1 minute', LEAST(ends_at, NOW()))
      WHERE id = ${eventId} AND ended_at IS NULL
      RETURNING *
    `;
    const room = `meeting:${eventId}`;
    req.app.get("io")?.to(room).emit("meeting:ended", {
      event_id: eventId,
      message: `${meeting.title} was ended by the organizer.`
    });
    req.app.get("io")?.in(room).socketsLeave(room);
    invalidateCache(`events:${req.auth.organizationId}`);
    res.json({ meeting: ended, message: "Meeting ended for everyone" });
  } catch (error) { next(error); }
});

workspaceRouter.delete("/events/:eventId", async (req, res, next) => {
  try {
    const eventId = z.string().uuid().parse(req.params.eventId);
    const input = z.object({ reason: z.string().trim().max(500).default("") }).parse(req.body || {});
    const [event] = await sql`
      SELECT e.*, u.full_name AS organizer_name
      FROM events e JOIN users u ON u.id = e.organizer_id
      WHERE e.id = ${eventId} AND e.organization_id = ${req.auth.organizationId}
    `;
    if (!event) return res.status(404).json({ error: "Event or meeting not found" });
    const role = await currentRole(req.auth.userId);
    const canCancel = event.organizer_id === req.auth.userId || ["hr", "senior_leader"].includes(role);
    if (!canCancel) return res.status(403).json({ error: "Only the organizer, HR, or a senior leader can cancel this event" });
    if (event.cancelled_at) return res.json({ event, message: "This event is already cancelled" });

    const [cancelled] = await sql`
      UPDATE events
      SET cancelled_at = NOW(), cancelled_by = ${req.auth.userId}, cancellation_reason = ${input.reason}
      WHERE id = ${eventId}
      RETURNING *
    `;
    const attendees = await sql`
      SELECT ea.user_id FROM event_attendees ea
      WHERE ea.event_id = ${eventId} AND ea.user_id <> ${req.auth.userId}
    `;
    const [cancelledBy] = await sql`SELECT full_name, initials, avatar_color FROM users WHERE id = ${req.auth.userId}`;
    const title = `Cancelled: ${event.title}`;
    const body = `${cancelledBy.full_name} cancelled this ${event.is_online ? "meeting" : "event"}${input.reason ? `. Reason: ${input.reason}` : "."}`;
    const recipientIds = attendees.map((attendee) => attendee.user_id);
    if (recipientIds.length) {
      const cancellationMessages = await sql`
        INSERT INTO direct_messages (organization_id, sender_id, recipient_id, body)
        SELECT ${req.auth.organizationId}, ${req.auth.userId}, recipient_id,
          ${`Meeting cancelled: ${event.title}${input.reason ? `\nReason: ${input.reason}` : ""}`}
        FROM unnest(${recipientIds}::uuid[]) AS recipient_id
        RETURNING id, recipient_id, body, sent_at
      `;
      for (const message of cancellationMessages) {
        req.app.get("io")?.to(`user:${message.recipient_id}`).emit("direct:message", {
          ...message,
          sender_id: req.auth.userId,
          sender_name: cancelledBy.full_name,
          initials: cancelledBy.initials,
          avatar_color: cancelledBy.avatar_color
        });
      }
    }
    for (const attendee of attendees) {
      req.app.get("io")?.to(`user:${attendee.user_id}`).emit("event:cancelled", {
        event_id: eventId,
        title,
        body,
        tag: `event-cancelled-${eventId}`
      });
      sendPushToUser(attendee.user_id, {
        title,
        body,
        tag: `event-cancelled-${eventId}`,
        url: "/?view=calendar"
      }).catch(console.error);
    }
    req.app.get("io")?.to(`meeting:${eventId}`).emit("meeting:cancelled", { title, body });
    invalidateCache(`events:${req.auth.organizationId}`);
    res.json({ event: cancelled, message: "Event cancelled and attendees notified" });
  } catch (error) { next(error); }
});

workspaceRouter.get("/meetings/config", (_req, res) => {
  res.json({ iceServers: config.webrtcIceServers });
});

workspaceRouter.post("/support", async (req, res, next) => {
  try {
    const input = z.object({
      category: z.enum(["Technical issue", "Account access", "Feature request", "General help"]),
      subject: z.string().trim().min(3).max(180),
      message: z.string().trim().min(10).max(5000)
    }).parse(req.body);
    const [user] = await sql`
      SELECT id, employee_id, email, full_name, title, department, initials, avatar_color
      FROM users WHERE id = ${req.auth.userId}
    `;
    const [administrator] = await sql`
      SELECT id, email
      FROM users
      WHERE organization_id = ${req.auth.organizationId}
        AND id <> ${req.auth.userId}
        AND (lower(email) = lower(${config.adminEmail || ""}) OR role = 'senior_leader')
      ORDER BY CASE WHEN lower(email) = lower(${config.adminEmail || ""}) THEN 0 ELSE 1 END, created_at
      LIMIT 1
    `;

    await sql`
      INSERT INTO support_requests (organization_id, requester_id, category, subject, message)
      VALUES (${req.auth.organizationId}, ${req.auth.userId}, ${input.category}, ${input.subject}, ${input.message})
    `;

    let administratorMessage = null;
    if (administrator) {
      const supportBody = [
        `Support request · ${input.category}`,
        `Subject: ${input.subject}`,
        "",
        input.message,
        "",
        `Employee: ${user.full_name} (${user.employee_id || "No employee ID"})`,
        `Email: ${user.email}`,
        `Department: ${user.department}`,
        `Designation: ${user.title}`
      ].join("\n");
      [administratorMessage] = await sql`
        INSERT INTO direct_messages (organization_id, sender_id, recipient_id, body)
        VALUES (${req.auth.organizationId}, ${req.auth.userId}, ${administrator.id}, ${supportBody})
        RETURNING id, body, sent_at
      `;
      const realtimeMessage = {
        ...administratorMessage,
        sender_id: user.id,
        sender_name: user.full_name,
        initials: user.initials,
        avatar_color: user.avatar_color,
        recipient_id: administrator.id
      };
      req.app.get("io")?.to(`user:${administrator.id}`).emit("direct:message", realtimeMessage);
      sendPushToUser(administrator.id, {
        title: `Support request from ${user.full_name}`,
        body: `${input.category}: ${input.subject}`.slice(0, 180),
        tag: `support-${administratorMessage.id}`,
        url: "/?view=chat"
      }).catch(console.error);
    }

    try {
      await sendSupportRequest({ user, ...input });
    } catch (emailError) {
      console.error("Support request email delivery failed", emailError);
      if (!administratorMessage) throw emailError;
    }
    res.status(201).json({ message: "Your support request has been sent to the administrator" });
  } catch (error) {
    if (error?.name === "ZodError") return next(error);
    next(Object.assign(new Error("We could not send your support request. Please email support directly."), { status: 502, cause: error }));
  }
});

workspaceRouter.get("/support-requests", async (req, res, next) => {
  try {
    if (await currentRole(req.auth.userId) !== "senior_leader") {
      return res.status(403).json({ error: "Only the administrator can view support requests" });
    }
    const requests = await sql`
      SELECT request.id, request.category, request.subject, request.message, request.created_at,
             employee.id AS requester_id, employee.full_name, employee.employee_id, employee.email,
             employee.title, employee.department, employee.phone, employee.location
      FROM support_requests request
      JOIN users employee ON employee.id = request.requester_id
      WHERE request.organization_id = ${req.auth.organizationId}
      ORDER BY request.created_at DESC
      LIMIT 100
    `;
    res.json({ requests });
  } catch (error) { next(error); }
});

workspaceRouter.get("/push/config", (req, res) => {
  res.json({ publicKey: config.vapid.publicKey || "" });
});

workspaceRouter.post("/push/subscribe", async (req, res, next) => {
  try {
    const input = z.object({
      endpoint: z.string().url().max(2000),
      keys: z.object({
        p256dh: z.string().min(20).max(500),
        auth: z.string().min(8).max(500)
      })
    }).parse(req.body);
    await sql`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
      VALUES (${req.auth.userId}, ${input.endpoint}, ${input.keys.p256dh}, ${input.keys.auth})
      ON CONFLICT (endpoint) DO UPDATE
      SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
    `;
    res.status(201).json({ message: "This device is subscribed" });
  } catch (error) { next(error); }
});

workspaceRouter.delete("/push/subscribe", async (req, res, next) => {
  try {
    const { endpoint } = z.object({ endpoint: z.string().url().max(2000) }).parse(req.body);
    await sql`DELETE FROM push_subscriptions WHERE user_id = ${req.auth.userId} AND endpoint = ${endpoint}`;
    res.json({ message: "This device is unsubscribed" });
  } catch (error) { next(error); }
});

workspaceRouter.get("/search", async (req, res, next) => {
  try {
    const q = `%${String(req.query.q || "").slice(0, 80)}%`;
    const [people, channels] = await Promise.all([
      sql`SELECT id,
                 CASE WHEN hide_full_name AND id <> ${req.auth.userId} THEN COALESCE(NULLIF(display_name, ''), 'Team member') ELSE full_name END AS full_name,
                 CASE WHEN hide_email AND id <> ${req.auth.userId} THEN NULL ELSE email END AS email,
                 title, initials, avatar_color, presence, availability_status
          FROM users
          WHERE organization_id = ${req.auth.organizationId} AND employment_status = 'active'
            AND ((NOT hide_full_name AND full_name ILIKE ${q}) OR display_name ILIKE ${q}
              OR (NOT hide_email AND email ILIKE ${q}) OR title ILIKE ${q})
          LIMIT 8`,
      sql`SELECT id, name, description FROM channels
          WHERE organization_id = ${req.auth.organizationId} AND (name ILIKE ${q} OR description ILIKE ${q}) LIMIT 8`
    ]);
    res.json({ people, channels });
  } catch (error) { next(error); }
});
