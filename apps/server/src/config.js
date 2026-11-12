import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

function parseIceServers(value) {
  const defaults = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ];
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) && parsed.length ? parsed : defaults;
  } catch {
    return defaults;
  }
}

function normalizeVapidSubject(value) {
  const subject = String(value || "").trim();
  if (!subject) return `mailto:${process.env.SMTP_FROM_EMAIL || "support@localhost"}`;
  if (/^(mailto:|https:\/\/)/i.test(subject)) return subject;
  return `mailto:${subject}`;
}

function normalizeOrigin(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: [path.join(root, ".env.local"), path.join(root, ".env")] });

const configuredClientUrls = (process.env.CLIENT_URLS || process.env.CLIENT_URL || "")
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);
const clientUrls = [...new Set([
  "http://localhost:5173",
  "https://luxsyncspace.vercel.app",
  ...configuredClientUrls
])];

export const config = {
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || "development-only-secret",
  clientUrl: configuredClientUrls[0] || "http://localhost:5173",
  clientUrls,
  allowVercelPreviews: process.env.ALLOW_VERCEL_PREVIEWS === "true",
  redisUrl: process.env.REDIS_URL,
  appName: process.env.APP_NAME || "LuxSyncspace",
  appUrl: process.env.APP_URL || process.env.CLIENT_URL || "http://localhost:5173",
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    fromEmail: process.env.SMTP_FROM_EMAIL
  },
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  provisioning: {
    token: process.env.HRMS_PROVISIONING_TOKEN || "",
    organizationId: process.env.HRMS_PROVISIONING_ORGANIZATION_ID || "",
  },
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: normalizeVapidSubject(process.env.VAPID_SUBJECT || process.env.SMTP_FROM_EMAIL)
  },
  webrtcIceServers: parseIceServers(process.env.WEBRTC_ICE_SERVERS_JSON),
  root,
};

if (!config.databaseUrl) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env.");
}
