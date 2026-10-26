import "dotenv/config";
import "../apps/server/src/index.js";

const base = process.env.SMOKE_BASE || "http://localhost:4000/api";
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

try {
  await wait(900);
  const health = await fetch(`${base}/health`).then((response) => response.json());
  if (health.status !== "ok") throw new Error("Health endpoint failed");

  const loginResponse = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })
  });
  if (!loginResponse.ok) throw new Error(`Login failed with ${loginResponse.status}`);
  const login = await loginResponse.json();

  const workspaceResponse = await fetch(`${base}/bootstrap`, {
    headers: { Authorization: `Bearer ${login.token}` }
  });
  if (!workspaceResponse.ok) throw new Error(`Bootstrap failed with ${workspaceResponse.status}`);
  const workspace = await workspaceResponse.json();

  for (const collection of ["people", "channels", "events", "announcements"]) {
    if (!Array.isArray(workspace[collection])) throw new Error(`Missing ${collection} collection`);
  }
  if (!workspace.directConversationTimes || Array.isArray(workspace.directConversationTimes) || typeof workspace.directConversationTimes !== "object") {
    throw new Error("Missing direct conversation timestamps");
  }
  if (!login.user.employee_id || !login.user.role) throw new Error("Employee profile fields are missing");
  const duplicateInvite = await fetch(`${base}/invitations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` },
    body: JSON.stringify({
      fullName: "Duplicate Administrator",
      email: process.env.ADMIN_EMAIL,
      title: "Administrator",
      department: "Administration",
      role: "employee",
      phone: "",
      location: "India",
      managerId: "",
      joinedAt: new Date().toISOString().slice(0, 10),
      bio: ""
    })
  });
  if (duplicateInvite.status !== 409) throw new Error(`Duplicate invitation guard returned ${duplicateInvite.status}`);
  const colleague = workspace.people.find((person) => person.id !== login.user.id);
  if (colleague) {
    const directResponse = await fetch(`${base}/direct/${colleague.id}`, {
      headers: { Authorization: `Bearer ${login.token}` }
    });
    if (!directResponse.ok) throw new Error(`Direct conversation failed with ${directResponse.status}`);
  }

  console.log("Smoke test passed:", {
    user: login.user.full_name,
    people: workspace.people.length,
    channels: workspace.channels.length,
    events: workspace.events.length,
    announcements: workspace.announcements.length,
    role: login.user.role
  });
  process.exit(0);
} catch (error) {
  console.error("Smoke test failed:", error);
  process.exit(1);
}
