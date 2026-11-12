import webpush from "web-push";
import { config } from "../config.js";
import { sql } from "../db/client.js";

const configured = Boolean(config.vapid.publicKey && config.vapid.privateKey);

if (configured) {
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
}

async function deliver(rows, payload) {
  if (!configured || rows.length === 0) return;
  for (let offset = 0; offset < rows.length; offset += 25) {
    const batch = rows.slice(offset, offset + 25);
    await Promise.allSettled(batch.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify(payload),
          {
            TTL: payload.type === "call" ? 45 : 60 * 60,
            urgency: payload.type === "call" ? "high" : "normal",
            topic: payload.type === "call" ? `call-${payload.meetingId}`.slice(0, 32) : undefined
          }
        );
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await sql`DELETE FROM push_subscriptions WHERE endpoint = ${row.endpoint}`;
          return;
        }
        throw error;
      }
    }));
  }
}

export async function sendPushToUser(userId, payload) {
  const rows = await sql`
    SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ${userId}
  `;
  return deliver(rows, payload);
}

export async function sendPushToChannel(channelId, excludeUserId, payload, additionalExcludedUserIds = []) {
  const excludedUserIds = [excludeUserId, ...additionalExcludedUserIds];
  const rows = await sql`
    SELECT DISTINCT ps.endpoint, ps.p256dh, ps.auth
    FROM push_subscriptions ps
    JOIN channel_members cm ON cm.user_id = ps.user_id
    WHERE cm.channel_id = ${channelId} AND cm.muted = FALSE
      AND NOT (ps.user_id = ANY(${excludedUserIds}::uuid[]))
  `;
  return deliver(rows, payload);
}

export async function sendPushToOrganization(organizationId, excludeUserId, payload) {
  const rows = await sql`
    SELECT DISTINCT ps.endpoint, ps.p256dh, ps.auth
    FROM push_subscriptions ps
    JOIN users u ON u.id = ps.user_id
    WHERE u.organization_id = ${organizationId} AND u.id <> ${excludeUserId}
  `;
  return deliver(rows, payload);
}
