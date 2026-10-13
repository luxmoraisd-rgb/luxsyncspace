import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { sql } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";
import { invalidateCache } from "../services/cache.js";
import { sendPushToOrganization, sendPushToUser } from "../services/push.js";

export const adminAgentRouter = Router();
adminAgentRouter.use(requireAuth);

const actionNames = [
  "workspace_overview",
  "find_employee",
  "pending_requests",
  "recent_chat_activity",
  "hrms_overview",
  "publish_announcement",
  "send_direct_message",
  "unsupported"
];
const readOnlyActions = new Set(["workspace_overview", "find_employee", "pending_requests", "recent_chat_activity", "hrms_overview"]);
const planSchema = z.object({
  action: z.enum(actionNames),
  summary: z.string().trim().min(1).max(500),
  risk: z.enum(["low", "medium", "high"]),
  requires_confirmation: z.boolean(),
  arguments: z.object({
    query: z.string().max(500),
    title: z.string().max(180),
    body: z.string().max(5000),
    priority: z.enum(["normal", "important"]),
    recipient: z.string().max(200)
  })
});

async function requireMainAdministrator(req, res) {
  const [user] = await sql`
    SELECT id, full_name, role FROM users
    WHERE id = ${req.auth.userId} AND organization_id = ${req.auth.organizationId}
  `;
  if (user?.role === "senior_leader") return user;
  res.status(403).json({ error: "Only the main administrator can use the AI agent" });
  return null;
}

function emptyArguments(overrides = {}) {
  return { query: "", title: "", body: "", priority: "normal", recipient: "", ...overrides };
}

function builtInPlan(command) {
  const text = command.trim();
  const lower = text.toLowerCase();
  const messageMatch = text.match(/(?:send\s+(?:a\s+)?message|message)\s+to\s+([^:]+):\s*(.+)/i);
  if (messageMatch) return {
    action: "send_direct_message",
    summary: `Send a direct message to ${messageMatch[1].trim()}`,
    risk: "medium",
    requires_confirmation: true,
    arguments: emptyArguments({ recipient: messageMatch[1].trim(), body: messageMatch[2].trim() })
  };
  if (lower.includes("announcement")) {
    const content = text.includes(":") ? text.slice(text.indexOf(":") + 1).trim() : "";
    const [title = "", ...bodyParts] = content.split("|");
    const body = bodyParts.join("|").trim();
    if (title.trim() && body) return {
      action: "publish_announcement",
      summary: `Publish the announcement “${title.trim()}”`,
      risk: "high",
      requires_confirmation: true,
      arguments: emptyArguments({ title: title.trim(), body, priority: lower.includes("important") ? "important" : "normal" })
    };
  }
  if ((lower.includes("pending") || lower.includes("open")) && (lower.includes("support") || lower.includes("password") || lower.includes("request"))) return {
    action: "pending_requests", summary: "Show pending support and password-reset requests", risk: "low", requires_confirmation: false, arguments: emptyArguments()
  };
  if (lower.includes("chat") && (lower.includes("recent") || lower.includes("activity") || lower.includes("message"))) return {
    action: "recent_chat_activity", summary: "Show recent chat activity", risk: "low", requires_confirmation: false, arguments: emptyArguments()
  };
  if (lower.includes("hrms") || lower.includes("connect hr") || lower.includes("attendance") || lower.includes("leave request")) return {
    action: "hrms_overview", summary: "Show the current Connect HR overview", risk: "low", requires_confirmation: false, arguments: emptyArguments()
  };
  const employeeMatch = text.match(/(?:find|search|lookup|show)\s+(?:for\s+)?(?:employee\s+)?(.+)/i);
  if (employeeMatch && (lower.includes("employee") || lower.includes("find") || lower.includes("search") || lower.includes("lookup"))) return {
    action: "find_employee", summary: `Find employees matching “${employeeMatch[1].trim()}”`, risk: "low", requires_confirmation: false, arguments: emptyArguments({ query: employeeMatch[1].trim() })
  };
  if (["overview", "summary", "status", "workspace", "dashboard", "company"].some((word) => lower.includes(word))) return {
    action: "workspace_overview", summary: "Show a current workspace overview", risk: "low", requires_confirmation: false, arguments: emptyArguments()
  };
  return {
    action: "unsupported",
    summary: "This command is not supported yet. Try a workspace overview, employee search, pending requests, recent chat activity, an announcement, or a direct message.",
    risk: "low",
    requires_confirmation: false,
    arguments: emptyArguments()
  };
}

async function openAiPlan(command) {
  if (!config.ai.apiKey) return null;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.ai.apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      model: config.ai.model,
      store: false,
      instructions: [
        "You plan commands for a company administration assistant.",
        `Choose exactly one action from: ${actionNames.join(", ")}.`,
        "workspace_overview: organization counts and status.",
        "find_employee: search people; put the search phrase in arguments.query.",
        "pending_requests: pending support and password reset requests.",
        "recent_chat_activity: recent direct/group message activity, not message contents.",
        "hrms_overview: Connect HR employee, leave, and attendance overview.",
        "publish_announcement: arguments.title, body, and priority; always high risk and requires confirmation.",
        "send_direct_message: arguments.recipient and body; always medium risk and requires confirmation.",
        "Use unsupported if required information is missing or the requested operation is unavailable.",
        "Read-only actions are low risk and do not require confirmation. Never invent missing names or content."
      ].join("\n"),
      input: command,
      text: {
        format: {
          type: "json_schema",
          name: "administrator_agent_plan",
          strict: true,
          schema: {
            type: "object",
            properties: {
              action: { type: "string", enum: actionNames },
              summary: { type: "string" },
              risk: { type: "string", enum: ["low", "medium", "high"] },
              requires_confirmation: { type: "boolean" },
              arguments: {
                type: "object",
                properties: {
                  query: { type: "string" }, title: { type: "string" }, body: { type: "string" },
                  priority: { type: "string", enum: ["normal", "important"] }, recipient: { type: "string" }
                },
                required: ["query", "title", "body", "priority", "recipient"],
                additionalProperties: false
              }
            },
            required: ["action", "summary", "risk", "requires_confirmation", "arguments"],
            additionalProperties: false
          }
        }
      }
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || "AI planning request failed");
  const outputText = payload.output_text || payload.output
    ?.flatMap((item) => item.content || [])
    .find((item) => item.type === "output_text")?.text;
  if (!outputText) throw new Error("The AI planner returned no plan");
  const plan = planSchema.parse(JSON.parse(outputText));
  if (readOnlyActions.has(plan.action)) return { ...plan, risk: "low", requires_confirmation: false };
  if (["publish_announcement", "send_direct_message"].includes(plan.action)) return { ...plan, requires_confirmation: true };
  return plan;
}

async function planCommand(command) {
  if (config.ai.apiKey) {
    try { return { plan: await openAiPlan(command), planner: `openai:${config.ai.model}` }; }
    catch (error) { console.error("Administrator AI planning failed; using built-in planner:", error.message); }
  }
  return { plan: builtInPlan(command), planner: "built-in" };
}

async function performAction(task, req) {
  const args = task.arguments || {};
  if (task.action === "workspace_overview") {
    const [employees, channels, directMessages, groupMessages, support, resets, meetings] = await Promise.all([
      sql`SELECT COUNT(*)::int AS count FROM users WHERE organization_id = ${req.auth.organizationId} AND employment_status = 'active'`,
      sql`SELECT COUNT(*)::int AS count FROM channels WHERE organization_id = ${req.auth.organizationId}`,
      sql`SELECT COUNT(*)::int AS count FROM direct_messages WHERE organization_id = ${req.auth.organizationId}`,
      sql`SELECT COUNT(message.id)::int AS count FROM channel_messages message JOIN channels channel ON channel.id = message.channel_id WHERE channel.organization_id = ${req.auth.organizationId}`,
      sql`SELECT COUNT(*)::int AS count FROM support_requests WHERE organization_id = ${req.auth.organizationId}`,
      sql`SELECT COUNT(*)::int AS count FROM password_reset_requests WHERE organization_id = ${req.auth.organizationId} AND status = 'pending'`,
      sql`SELECT COUNT(*)::int AS count FROM events WHERE organization_id = ${req.auth.organizationId} AND starts_at >= NOW() AND cancelled_at IS NULL`
    ]);
    return { message: "Workspace overview is ready.", type: "metrics", data: {
      "Active employees": employees[0].count, "Channels": channels[0].count,
      "Direct messages": directMessages[0].count, "Group messages": groupMessages[0].count,
      "Support requests": support[0].count, "Pending password resets": resets[0].count,
      "Upcoming meetings": meetings[0].count
    } };
  }
  if (task.action === "find_employee") {
    const query = String(args.query || "").trim();
    if (!query) throw new Error("Tell me the employee name, email, ID, designation, or department to find");
    const matches = await sql`
      SELECT id, full_name, employee_id, email, title, department, employment_status
      FROM users WHERE organization_id = ${req.auth.organizationId}
        AND (full_name ILIKE ${`%${query}%`} OR email ILIKE ${`%${query}%`} OR employee_id ILIKE ${`%${query}%`}
          OR title ILIKE ${`%${query}%`} OR department ILIKE ${`%${query}%`})
      ORDER BY CASE WHEN employment_status = 'active' THEN 0 ELSE 1 END, full_name LIMIT 20
    `;
    return { message: matches.length ? `Found ${matches.length} matching employee${matches.length === 1 ? "" : "s"}.` : "No matching employees were found.", type: "employees", data: matches };
  }
  if (task.action === "pending_requests") {
    const [support, resets] = await Promise.all([
      sql`SELECT request.id, request.category, request.subject, request.created_at, employee.full_name, employee.employee_id
          FROM support_requests request JOIN users employee ON employee.id = request.requester_id
          WHERE request.organization_id = ${req.auth.organizationId} ORDER BY request.created_at DESC LIMIT 20`,
      sql`SELECT request.id, request.requested_at, employee.full_name, employee.employee_id, employee.email
          FROM password_reset_requests request JOIN users employee ON employee.id = request.user_id
          WHERE request.organization_id = ${req.auth.organizationId} AND request.status = 'pending'
          ORDER BY request.requested_at DESC LIMIT 20`
    ]);
    return { message: `There are ${support.length} recent support requests and ${resets.length} pending password resets.`, type: "requests", data: { support, password_resets: resets } };
  }
  if (task.action === "recent_chat_activity") {
    const activity = await sql`
      SELECT * FROM (
        SELECT 'direct' AS kind, CONCAT(sender.full_name, ' → ', recipient.full_name) AS conversation,
               message.sent_at AS latest_at
        FROM direct_messages message JOIN users sender ON sender.id = message.sender_id
        JOIN users recipient ON recipient.id = message.recipient_id
        WHERE message.organization_id = ${req.auth.organizationId}
        UNION ALL
        SELECT 'group' AS kind, CONCAT('#', channel.name) AS conversation, message.sent_at AS latest_at
        FROM channel_messages message JOIN channels channel ON channel.id = message.channel_id
        WHERE channel.organization_id = ${req.auth.organizationId}
      ) recent ORDER BY latest_at DESC LIMIT 20
    `;
    return { message: `Showing the ${activity.length} most recent chat events.`, type: "activity", data: activity };
  }
  if (task.action === "hrms_overview") {
    if (!config.hrms.agentUrl || !config.hrms.agentToken) throw new Error("The HRMS connector is not configured. Add HRMS_AGENT_URL and HRMS_AGENT_TOKEN to the server environment.");
    const response = await fetch(`${config.hrms.agentUrl}/api/integrations/central-agent/overview`, {
      headers: { Authorization: `Bearer ${config.hrms.agentToken}` },
      signal: AbortSignal.timeout(20_000)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HRMS request failed (${response.status})`);
    const overview = payload.data || {};
    return { message: "Connect HR overview is ready.", type: "metrics", data: {
      "HRMS employees": overview.activeEmployees || 0,
      "Pending leave": overview.pendingLeaveRequests || 0,
      "Pending regularizations": overview.pendingRegularizations || 0,
      "Pending permissions": overview.pendingPermissions || 0,
      "Present today": overview.attendance?.PRESENT || 0,
      "Late today": overview.attendance?.LATE || 0,
      "Absent today": overview.attendance?.ABSENT || 0,
      "Missing punch": overview.attendance?.MISSING_PUNCH || 0
    } };
  }
  if (task.action === "publish_announcement") {
    const input = z.object({ title: z.string().trim().min(2).max(180), body: z.string().trim().min(2).max(5000), priority: z.enum(["normal", "important"]) }).parse(args);
    const [announcement] = await sql`
      INSERT INTO announcements (organization_id, author_id, title, body, priority)
      VALUES (${req.auth.organizationId}, ${req.auth.userId}, ${input.title}, ${input.body}, ${input.priority}) RETURNING *
    `;
    invalidateCache(`announcements:${req.auth.organizationId}`);
    req.app.get("io")?.to(`org:${req.auth.organizationId}`).emit("announcement:new", { ...announcement, author_name: task.requester_name });
    sendPushToOrganization(req.auth.organizationId, req.auth.userId, { title: `Company announcement: ${input.title}`, body: input.body.slice(0, 180), tag: `announcement-${announcement.id}`, url: "/" }).catch(console.error);
    return { message: `Announcement “${input.title}” was published.`, type: "announcement", data: announcement };
  }
  if (task.action === "send_direct_message") {
    const input = z.object({ recipient: z.string().trim().min(2).max(200), body: z.string().trim().min(1).max(5000) }).parse(args);
    const candidates = await sql`
      SELECT id, full_name, employee_id, email, initials, avatar_color
      FROM users WHERE organization_id = ${req.auth.organizationId} AND employment_status = 'active'
        AND (LOWER(full_name) = LOWER(${input.recipient}) OR LOWER(email) = LOWER(${input.recipient})
          OR LOWER(COALESCE(employee_id, '')) = LOWER(${input.recipient}) OR full_name ILIKE ${`%${input.recipient}%`})
      ORDER BY CASE WHEN LOWER(full_name) = LOWER(${input.recipient}) OR LOWER(email) = LOWER(${input.recipient})
        OR LOWER(COALESCE(employee_id, '')) = LOWER(${input.recipient}) THEN 0 ELSE 1 END, full_name LIMIT 3
    `;
    if (!candidates.length) throw new Error(`No active employee matched “${input.recipient}”`);
    if (candidates.length > 1 && candidates[0].full_name.toLowerCase() !== input.recipient.toLowerCase()
      && candidates[0].email.toLowerCase() !== input.recipient.toLowerCase()
      && String(candidates[0].employee_id || "").toLowerCase() !== input.recipient.toLowerCase()) {
      throw new Error(`More than one employee matched “${input.recipient}”. Use the exact email or employee ID.`);
    }
    const recipient = candidates[0];
    if (recipient.id === req.auth.userId) throw new Error("Choose another employee as the recipient");
    const [message] = await sql`
      INSERT INTO direct_messages (organization_id, sender_id, recipient_id, body)
      VALUES (${req.auth.organizationId}, ${req.auth.userId}, ${recipient.id}, ${input.body})
      RETURNING id, body, sent_at, recipient_id
    `;
    const realtimeMessage = { ...message, sender_id: req.auth.userId, sender_name: task.requester_name };
    req.app.get("io")?.to(`user:${recipient.id}`).emit("direct:message", realtimeMessage);
    sendPushToUser(recipient.id, { title: task.requester_name, body: input.body.slice(0, 180), tag: `direct-${req.auth.userId}`, url: "/" }).catch(console.error);
    return { message: `Message sent to ${recipient.full_name}.`, type: "message", data: { id: message.id, recipient: recipient.full_name, sent_at: message.sent_at } };
  }
  return { message: task.summary, type: "unsupported", data: null };
}

async function executeTask(taskId, req) {
  const [task] = await sql`
    UPDATE admin_agent_tasks task SET status = 'running', started_at = NOW(), error = NULL
    FROM users requester
    WHERE task.id = ${taskId} AND task.organization_id = ${req.auth.organizationId}
      AND task.status = 'planned' AND requester.id = task.requested_by
    RETURNING task.*, requester.full_name AS requester_name
  `;
  if (!task) return null;
  try {
    const result = await performAction(task, req);
    const [completed] = await sql`
      UPDATE admin_agent_tasks SET status = 'completed', result = ${JSON.stringify(result)}::jsonb, completed_at = NOW()
      WHERE id = ${task.id} RETURNING *
    `;
    return completed;
  } catch (error) {
    const [failed] = await sql`
      UPDATE admin_agent_tasks SET status = 'failed', error = ${String(error.message || error).slice(0, 1000)}, completed_at = NOW()
      WHERE id = ${task.id} RETURNING *
    `;
    return failed;
  }
}

adminAgentRouter.get("/", async (req, res, next) => {
  try {
    if (!await requireMainAdministrator(req, res)) return;
    const tasks = await sql`
      SELECT task.*, requester.full_name AS requester_name
      FROM admin_agent_tasks task JOIN users requester ON requester.id = task.requested_by
      WHERE task.organization_id = ${req.auth.organizationId}
      ORDER BY task.created_at DESC LIMIT 50
    `;
    res.json({
      tasks,
      aiEnabled: Boolean(config.ai.apiKey),
      model: config.ai.apiKey ? config.ai.model : null,
      hrmsConnected: Boolean(config.hrms.agentUrl && config.hrms.agentToken)
    });
  } catch (error) { next(error); }
});

adminAgentRouter.post("/plan", async (req, res, next) => {
  try {
    if (!await requireMainAdministrator(req, res)) return;
    const { command } = z.object({ command: z.string().trim().min(3).max(2000) }).parse(req.body);
    const { plan, planner } = await planCommand(command);
    const [task] = await sql`
      INSERT INTO admin_agent_tasks (organization_id, requested_by, command, action, arguments, summary, risk, requires_confirmation, planner)
      VALUES (${req.auth.organizationId}, ${req.auth.userId}, ${command}, ${plan.action}, ${JSON.stringify(plan.arguments)}::jsonb,
        ${plan.summary}, ${plan.risk}, ${plan.requires_confirmation}, ${planner}) RETURNING *
    `;
    if (readOnlyActions.has(task.action) || task.action === "unsupported") {
      const completed = await executeTask(task.id, req);
      return res.status(201).json({ task: completed });
    }
    res.status(201).json({ task });
  } catch (error) { next(error); }
});

adminAgentRouter.post("/:id/execute", async (req, res, next) => {
  try {
    if (!await requireMainAdministrator(req, res)) return;
    const taskId = z.string().uuid().parse(req.params.id);
    const task = await executeTask(taskId, req);
    if (!task) return res.status(409).json({ error: "This task is unavailable or has already been handled" });
    res.json({ task });
  } catch (error) { next(error); }
});

adminAgentRouter.post("/:id/cancel", async (req, res, next) => {
  try {
    if (!await requireMainAdministrator(req, res)) return;
    const taskId = z.string().uuid().parse(req.params.id);
    const [task] = await sql`
      UPDATE admin_agent_tasks SET status = 'cancelled', completed_at = NOW()
      WHERE id = ${taskId} AND organization_id = ${req.auth.organizationId} AND status = 'planned' RETURNING *
    `;
    if (!task) return res.status(409).json({ error: "This task is unavailable or has already been handled" });
    res.json({ task });
  } catch (error) { next(error); }
});
