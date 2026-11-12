import bcrypt from "bcryptjs";
import { sql } from "./client.js";
import { config } from "../config.js";

if (!config.adminEmail || !config.adminPassword) {
  throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required");
}

console.log("Initializing LuxSyncspace organization...");

// Remove only the Northstar demo organization created by this project.
// Explicit ordering handles legacy restrictive sender/organizer foreign keys.
const [demoOrg] = await sql`SELECT id FROM organizations WHERE domain = 'northstar.example'`;
if (demoOrg) {
  await sql`DELETE FROM mail_threads WHERE organization_id = ${demoOrg.id}`;
  await sql`DELETE FROM channel_messages WHERE channel_id IN (SELECT id FROM channels WHERE organization_id = ${demoOrg.id})`;
  await sql`DELETE FROM channels WHERE organization_id = ${demoOrg.id}`;
  await sql`DELETE FROM event_attendees WHERE event_id IN (SELECT id FROM events WHERE organization_id = ${demoOrg.id})`;
  await sql`DELETE FROM events WHERE organization_id = ${demoOrg.id}`;
  await sql`DELETE FROM direct_messages WHERE organization_id = ${demoOrg.id}`;
  await sql`DELETE FROM announcements WHERE organization_id = ${demoOrg.id}`;
  await sql`DELETE FROM invitations WHERE organization_id = ${demoOrg.id}`;
  await sql`DELETE FROM users WHERE organization_id = ${demoOrg.id}`;
  await sql`DELETE FROM organizations WHERE id = ${demoOrg.id}`;
}

const [org] = await sql`
  INSERT INTO organizations (name, domain)
  VALUES ('Luxmor AI', 'luxmorai.com')
  ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name
  RETURNING id
`;

const passwordHash = await bcrypt.hash(config.adminPassword, 12);
let [admin] = await sql`
  SELECT id FROM users WHERE organization_id = ${org.id} AND employee_id = 'LUX-0001'
`;

if (admin) {
  [admin] = await sql`
    UPDATE users SET
      organization_id = ${org.id},
      email = ${config.adminEmail},
      password_hash = ${passwordHash},
      full_name = 'Luxmor Administrator',
      title = 'Workspace Administrator',
      department = 'Administration',
      role = 'senior_leader',
      initials = 'LA',
      avatar_color = '#2557D6',
      presence = 'online',
      phone = '',
      location = 'India',
      bio = 'LuxSyncspace organization administrator.',
      joined_at = CURRENT_DATE,
      must_change_password = FALSE
    WHERE id = ${admin.id}
    RETURNING id
  `;
} else {
  [admin] = await sql`
    INSERT INTO users (
      organization_id, employee_id, email, password_hash, full_name, title, department, role,
      initials, avatar_color, presence, phone, location, bio, joined_at, must_change_password
    )
    VALUES (
      ${org.id}, 'LUX-0001', ${config.adminEmail}, ${passwordHash}, 'Luxmor Administrator',
      'Workspace Administrator', 'Administration', 'senior_leader', 'LA', '#2557D6', 'online',
      '', 'India', 'LuxSyncspace organization administrator.', CURRENT_DATE, FALSE
    )
    RETURNING id
  `;
}

const defaultChannels = [
  ["general", "Company-wide conversation and collaboration"],
  ["company-announcements", "Official updates from HR and leadership"]
];

for (const [name, description] of defaultChannels) {
  const [channel] = await sql`
    INSERT INTO channels (organization_id, name, description, created_by)
    VALUES (${org.id}, ${name}, ${description}, ${admin.id})
    ON CONFLICT (organization_id, name) DO UPDATE SET description = EXCLUDED.description
    RETURNING id
  `;
  await sql`INSERT INTO channel_members (channel_id, user_id) VALUES (${channel.id}, ${admin.id}) ON CONFLICT DO NOTHING`;
}

console.log("LuxSyncspace is ready with one administrator account.");
