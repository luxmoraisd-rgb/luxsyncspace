import http from "node:http";
import crypto from "node:crypto";
import path from "node:path";
import express from "express";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";
import morgan from "morgan";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { authRouter } from "./routes/auth.js";
import { workspaceRouter } from "./routes/workspace.js";
import { provisioningRouter } from "./routes/provisioning.js";
import { startEventReminderScheduler } from "./services/eventReminders.js";
import { sql } from "./db/client.js";
import { cached, invalidateCache } from "./services/cache.js";

const app = express();
const server = http.createServer(app);
function allowOrigin(origin, callback) {
  const normalizedOrigin = String(origin || "").replace(/\/+$/, "");
  const allowed = !origin
    || config.clientUrls.includes(normalizedOrigin)
    || (config.allowVercelPreviews && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(normalizedOrigin));
  callback(null, allowed);
}

const corsOptions = {
  origin: allowOrigin,
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"]
};
const io = new Server(server, { cors: corsOptions });
if (config.redisUrl) {
  const redisOptions = { maxRetriesPerRequest: null, enableReadyCheck: false };
  const pubClient = new Redis(config.redisUrl, redisOptions);
  const subClient = pubClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));
  pubClient.on("error", (error) => console.error("Redis publisher error", error.message));
  subClient.on("error", (error) => console.error("Redis subscriber error", error.message));
}
app.set("io", io);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors(corsOptions));
app.use(compression());
app.use(express.json({ limit: "1mb" }));
if (process.env.NODE_ENV !== "production") app.use(morgan("dev"));

app.get("/api/health", (_req, res) => res.json({
  status: "ok",
  service: "luxsyncspace-api",
  realtime: config.redisUrl ? "redis-coordinated" : "single-instance"
}));
app.use("/api/provisioning", provisioningRouter);
app.use("/api/auth", authRouter);
app.use("/api", workspaceRouter);

io.use(async (socket, next) => {
  try {
    socket.auth = jwt.verify(socket.handshake.auth.token, config.jwtSecret);
    const [account] = await sql`SELECT employment_status FROM users WHERE id = ${socket.auth.userId}`;
    if (!account || (account.employment_status || "active") !== "active") return next(new Error("account_inactive"));
    next();
  } catch {
    next(new Error("unauthorized"));
  }
});
io.on("connection", (socket) => {
  socket.join(`user:${socket.auth.userId}`);
  socket.join(`org:${socket.auth.organizationId}`);
  cached(`socket-memberships:${socket.auth.organizationId}`, 10_000, () =>
    sql`SELECT user_id, channel_id FROM channel_members cm
        JOIN channels c ON c.id = cm.channel_id
        WHERE c.organization_id = ${socket.auth.organizationId}`
  )
    .then((memberships) => socket.join(
      memberships
        .filter((membership) => membership.user_id === socket.auth.userId)
        .map((membership) => `channel:${membership.channel_id}`)
    ))
    .catch((error) => console.error("Could not join channel rooms", error));
  socket.on("channel:join", async (channelId) => {
    const [membership] = await sql`
      SELECT 1 FROM channel_members cm
      JOIN channels c ON c.id = cm.channel_id
      WHERE cm.channel_id = ${channelId} AND cm.user_id = ${socket.auth.userId}
        AND c.organization_id = ${socket.auth.organizationId}
    `;
    if (membership) socket.join(`channel:${channelId}`);
  });
  socket.on("channel:leave", (channelId) => socket.leave(`channel:${channelId}`));

  socket.on("meeting:presence", async ({ roomId }, acknowledge = () => {}) => {
    try {
      const [meeting] = await sql`
        SELECT id, cancelled_at, ended_at FROM events
        WHERE id = ${roomId}
          AND organization_id = ${socket.auth.organizationId}
          AND is_online = TRUE
      `;
      if (!meeting) return acknowledge({ ok: false, error: "Meeting not found or access denied" });
      if (meeting.cancelled_at) return acknowledge({ ok: false, error: "This meeting was cancelled", cancelled: true });
      if (meeting.ended_at) return acknowledge({ ok: false, error: "This call has ended", ended: true });

      const participants = await io.in(`meeting:${meeting.id}`).fetchSockets();
      acknowledge({
        ok: true,
        participants: participants
          .filter((participant) => participant.data.meetingProfile)
          .map((participant) => participant.data.meetingProfile)
      });
    } catch (error) {
      console.error("Meeting presence lookup failed", error);
      acknowledge({ ok: false, error: "Could not check meeting participants" });
    }
  });

  socket.on("meeting:join", async ({ roomId }, acknowledge = () => {}) => {
    try {
      const [joinData] = await sql`
        SELECT
          event.id AS meeting_id,
          event.title AS meeting_title,
          event.organizer_id,
          event.starts_at,
          event.ends_at,
          event.cancelled_at,
          event.ended_at,
          profile.id AS profile_id,
          CASE WHEN profile.hide_full_name
              THEN COALESCE(NULLIF(profile.display_name, ''), 'Team member')
              ELSE profile.full_name
          END AS profile_full_name,
          profile.title AS profile_title,
          profile.initials AS profile_initials,
          profile.avatar_color AS profile_avatar_color
        FROM events AS event
        JOIN users AS profile ON profile.id = ${socket.auth.userId}
        WHERE event.id = ${roomId}
          AND event.organization_id = ${socket.auth.organizationId}
          AND event.is_online = TRUE
      `;
      if (!joinData) return acknowledge({ ok: false, error: "Meeting not found or access denied" });
      if (joinData.cancelled_at) return acknowledge({ ok: false, error: "This meeting was cancelled", cancelled: true });
      if (joinData.ended_at) return acknowledge({ ok: false, error: "This call has ended", ended: true });
      const meeting = {
        id: joinData.meeting_id,
        title: joinData.meeting_title,
        organizer_id: joinData.organizer_id,
        starts_at: joinData.starts_at,
        ends_at: joinData.ends_at
      };
      const profile = {
        id: joinData.profile_id,
        full_name: joinData.profile_full_name,
        title: joinData.profile_title,
        initials: joinData.profile_initials,
        avatar_color: joinData.profile_avatar_color
      };
      if (socket.meetingRoom) {
        socket.leave(socket.meetingRoom);
        socket.to(socket.meetingRoom).emit("meeting:user-left", { socketId: socket.id });
      }
      const room = `meeting:${meeting.id}`;
      const existingSockets = await io.in(room).fetchSockets();
      const attendeeRows = await sql`
        SELECT user_id FROM event_attendees
        WHERE event_id = ${meeting.id} AND user_id <> ${meeting.organizer_id}
      `;
      const attendeeIds = new Set(attendeeRows.map((attendee) => attendee.user_id));
      socket.meetingRoom = room;
      socket.data.meetingProfile = profile;
      socket.join(room);
      acknowledge({
        ok: true,
        meeting,
        participants: existingSockets.map((participant) => ({
          socketId: participant.id,
          user: participant.data.meetingProfile
        })).filter((participant) => participant.user)
      });
      socket.to(room).emit("meeting:user-joined", { socketId: socket.id, user: profile });
      const roomSockets = await io.in(room).fetchSockets();
      const roomProfiles = roomSockets
        .map((participant) => participant.data.meetingProfile)
        .filter(Boolean);
      const organizerPresent = roomProfiles.some((participant) => participant.id === meeting.organizer_id);
      const inviteePresent = roomProfiles.some((participant) => attendeeIds.has(participant.id));
      if (organizerPresent && inviteePresent) {
        const notifiedUserIds = new Set([meeting.organizer_id, ...attendeeIds]);
        for (const userId of notifiedUserIds) {
          io.to(`user:${userId}`).emit("call:answered", {
            meetingId: meeting.id,
            participant: profile
          });
        }
      }
    } catch (error) {
      console.error("Meeting join failed", error);
      acknowledge({ ok: false, error: "Could not join this meeting" });
    }
  });

  socket.on("meeting:signal", async ({ target, signal }) => {
    const [targetSocket] = await io.in(target).fetchSockets();
    if (!socket.meetingRoom || !targetSocket?.rooms.has(socket.meetingRoom)) return;
    io.to(target).emit("meeting:signal", { from: socket.id, signal, user: socket.data.meetingProfile });
  });

  socket.on("meeting:chat", ({ body }) => {
    const message = String(body || "").trim().slice(0, 2000);
    if (!socket.meetingRoom || !message) return;
    io.to(socket.meetingRoom).emit("meeting:chat", {
      id: crypto.randomUUID(),
      body: message,
      sender_id: socket.auth.userId,
      sender_name: socket.data.meetingProfile?.full_name || "Participant",
      sent_at: new Date().toISOString()
    });
  });

  socket.on("meeting:hand", ({ raised }) => {
    if (socket.meetingRoom) socket.to(socket.meetingRoom).emit("meeting:hand", { socketId: socket.id, raised: Boolean(raised) });
  });

  async function handleMeetingExit() {
    if (!socket.meetingRoom) return;
    const room = socket.meetingRoom;
    socket.to(room).emit("meeting:user-left", { socketId: socket.id });
    socket.leave(room);
    socket.meetingRoom = null;
    socket.data.meetingProfile = null;

    try {
      const roomId = room.replace("meeting:", "");
      const remainingSockets = await io.in(room).fetchSockets();
      const remainingProfiles = remainingSockets.filter((s) => s.data.meetingProfile);
      const [event] = await sql`
        SELECT id, title, organizer_id, meeting_mode, organization_id, ended_at, cancelled_at
        FROM events WHERE id = ${roomId}
      `;
      if (!event || event.ended_at || event.cancelled_at) return;

      const attendeeRows = await sql`
        SELECT user_id FROM event_attendees
        WHERE event_id = ${roomId} AND user_id <> ${event.organizer_id}
      `;
      const isDirectCall = (event.title && event.title.includes(" and ")) || attendeeRows.length === 1;

      // If room is completely empty, or if it was a 1-on-1 direct call and one person leaves
      if (remainingProfiles.length === 0 || (isDirectCall && remainingProfiles.length <= 1)) {
        const [ended] = await sql`
          UPDATE events
          SET ended_at = NOW(),
              ends_at = GREATEST(starts_at + INTERVAL '1 minute', LEAST(ends_at, NOW()))
          WHERE id = ${roomId} AND ended_at IS NULL
          RETURNING id, title, meeting_mode, organization_id, ended_at
        `;
        if (ended) {
          const isCall = ended.meeting_mode === "audio" || (ended.title || "").toLowerCase().includes("call") || (ended.title || "").includes(" and ");
          const endMessage = isCall ? "Call ended." : "Meeting ended.";
          io.to(room).emit("meeting:ended", {
            event_id: ended.id,
            message: endMessage,
            isCall
          });
          io.in(room).socketsLeave(room);
          io.to(`org:${ended.organization_id}`).emit("event:ended", {
            event_id: ended.id,
            ended_at: ended.ended_at,
            title: ended.title,
            isCall
          });
          invalidateCache(`events:${ended.organization_id}`);
        }
      }
    } catch (err) {
      console.error("Meeting exit auto-end error:", err.message);
    }
  }

  socket.on("meeting:leave", handleMeetingExit);
  socket.on("disconnecting", handleMeetingExit);
});
startEventReminderScheduler(io);

if (!process.env.VERCEL) {
  const clientDist = path.join(config.root, "apps/client/dist");
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(clientDist, "index.html"), (error) => error && next());
  });
}

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error?.name === "ZodError") return res.status(400).json({ error: error.issues[0]?.message || "Invalid request" });
  res.status(error.status || 500).json({
    error: error.status || process.env.NODE_ENV !== "production" ? error.message : "Something went wrong. Please try again."
  });
});

if (!process.env.VERCEL) {
  server.listen(config.port, () => console.log(`LuxSyncspace API listening on http://localhost:${config.port}`));
}

export default server;
