import "dotenv/config";
import "../apps/server/src/index.js";
import jwt from "jsonwebtoken";
import { sql } from "../apps/server/src/db/client.js";
import { config } from "../apps/server/src/config.js";

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
  if (!login.user.employee_id || !login.user.role) throw new Error("Employee profile fields are missing");
  const nonAdministrator = (workspace.workforce || workspace.people).find((person) => person.role !== "senior_leader");
  if (nonAdministrator) {
    const nonAdminToken = jwt.sign({ userId: nonAdministrator.id, organizationId: login.user.organization_id, email: nonAdministrator.email }, config.jwtSecret, { expiresIn: "5m" });
    const forbiddenAgentResponse = await fetch(`${base}/admin/agent`, { headers: { Authorization: `Bearer ${nonAdminToken}` } });
    if (forbiddenAgentResponse.status !== 403) throw new Error(`Administrator AI access guard returned ${forbiddenAgentResponse.status}`);
  }
  if (login.user.role === "senior_leader") {
    const agentResponse = await fetch(`${base}/admin/agent`, {
      headers: { Authorization: `Bearer ${login.token}` }
    });
    if (!agentResponse.ok) throw new Error(`Administrator AI agent failed with ${agentResponse.status}`);
    const agent = await agentResponse.json();
    if (!Array.isArray(agent.tasks)) throw new Error("Administrator AI audit history is missing");
    const overviewResponse = await fetch(`${base}/admin/agent/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` },
      body: JSON.stringify({ command: "Show workspace overview" })
    });
    if (!overviewResponse.ok) throw new Error(`Administrator AI read command failed with ${overviewResponse.status}`);
    const overview = await overviewResponse.json();
    if (overview.task?.status !== "completed" || overview.task?.result?.type !== "metrics") throw new Error("Administrator AI overview did not complete");
    await sql`DELETE FROM admin_agent_tasks WHERE id = ${overview.task.id}`;

    const writePlanResponse = await fetch(`${base}/admin/agent/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${login.token}` },
      body: JSON.stringify({ command: `Send a message to ${process.env.ADMIN_EMAIL}: Smoke test only` })
    });
    if (!writePlanResponse.ok) throw new Error(`Administrator AI write plan failed with ${writePlanResponse.status}`);
    const writePlan = await writePlanResponse.json();
    if (writePlan.task?.status !== "planned" || !writePlan.task?.requires_confirmation) throw new Error("Administrator AI write command bypassed confirmation");
    const cancelResponse = await fetch(`${base}/admin/agent/${writePlan.task.id}/cancel`, {
      method: "POST", headers: { Authorization: `Bearer ${login.token}` }
    });
    if (!cancelResponse.ok) throw new Error(`Administrator AI cancellation failed with ${cancelResponse.status}`);
    await sql`DELETE FROM admin_agent_tasks WHERE id = ${writePlan.task.id}`;
    const historyResponse = await fetch(`${base}/admin/chat-history/conversations`, {
      headers: { Authorization: `Bearer ${login.token}` }
    });
    if (!historyResponse.ok) throw new Error(`Administrator chat history failed with ${historyResponse.status}`);
    const history = await historyResponse.json();
    if (!Array.isArray(history.conversations)) throw new Error("Chat history conversation list is missing");
    const conversation = history.conversations[0];
    if (conversation) {
      const historyPath = conversation.kind === "direct"
        ? `/admin/chat-history/direct/${conversation.first_user_id}/${conversation.second_user_id}`
        : `/admin/chat-history/channels/${conversation.channel_id}`;
      const messagesResponse = await fetch(`${base}${historyPath}`, {
        headers: { Authorization: `Bearer ${login.token}` }
      });
      if (!messagesResponse.ok) throw new Error(`Administrator message history failed with ${messagesResponse.status}`);
      const messages = await messagesResponse.json();
      if (!Array.isArray(messages.messages)) throw new Error("Chat history messages are missing");
    }
  }
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
