import { useEffect, useState } from "react";
import { AlertTriangle, Bot, CheckCircle2, Clock3, RefreshCw, Send, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import { api } from "../lib/api";

const examples = [
  "Show workspace overview",
  "Find employee Kishore",
  "Show pending support requests",
  "Show recent chat activity",
  "Show Connect HR overview"
];

export function AdminAgent({ onToast }) {
  const [tasks, setTasks] = useState([]);
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [handlingId, setHandlingId] = useState(null);
  const [agentInfo, setAgentInfo] = useState({ aiEnabled: false, model: null, hrmsConnected: false });

  useEffect(() => { loadTasks(); }, []);

  async function loadTasks() {
    try {
      const result = await api("/admin/agent");
      setTasks(result.tasks || []);
      setAgentInfo({ aiEnabled: result.aiEnabled, model: result.model, hrmsConnected: result.hrmsConnected });
    } catch (error) { onToast(error.message); }
  }

  function replaceTask(task) {
    setTasks((current) => [task, ...current.filter((item) => item.id !== task.id)].sort((left, right) => new Date(right.created_at) - new Date(left.created_at)));
  }

  async function submitCommand(event) {
    event.preventDefault();
    if (!command.trim() || busy) return;
    setBusy(true);
    try {
      const result = await api("/admin/agent/plan", { method: "POST", body: JSON.stringify({ command }) });
      replaceTask(result.task);
      setCommand("");
      onToast(result.task.status === "planned" ? "Command planned. Review and confirm it below." : result.task.result?.message || "Command completed");
    } catch (error) { onToast(error.message); }
    finally { setBusy(false); }
  }

  async function handleTask(task, operation) {
    setHandlingId(task.id);
    try {
      const result = await api(`/admin/agent/${task.id}/${operation}`, { method: "POST" });
      replaceTask(result.task);
      onToast(result.task.result?.message || (operation === "cancel" ? "Command cancelled" : "Command handled"));
    } catch (error) { onToast(error.message); }
    finally { setHandlingId(null); }
  }

  return <div className="admin-agent">
    <header className="settings-section-head admin-agent-head">
      <div><h2>Administrator AI agent</h2><p>Give secure commands from desktop or mobile and review every action.</p></div>
      <span className={agentInfo.aiEnabled ? "connected" : "built-in"}><Sparkles size={14} /> {agentInfo.aiEnabled ? `AI connected · ${agentInfo.model}` : "Built-in command mode"}</span>
      <span className={agentInfo.hrmsConnected ? "connected" : "built-in"}><ShieldCheck size={14} /> {agentInfo.hrmsConnected ? "Connect HR linked" : "Connect HR not linked"}</span>
    </header>
    <section className="admin-agent-hero">
      <div className="admin-agent-mark"><Bot size={30} /></div>
      <div><h3>What should I do?</h3><p>I can inspect this workspace immediately. Any command that sends or publishes content waits for your confirmation.</p></div>
      <div className="admin-agent-security"><ShieldCheck size={16} /> Main administrator only</div>
    </section>
    <form className="admin-agent-command" onSubmit={submitCommand}>
      <textarea value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Example: Send a message to employee@company.com: Please submit your missing documents today." maxLength={2000} />
      <button className="button button-primary" disabled={busy || command.trim().length < 3}><Send size={17} /> {busy ? "Planning..." : "Run command"}</button>
    </form>
    <div className="admin-agent-examples">
      {examples.map((example) => <button key={example} onClick={() => setCommand(example)}>{example}</button>)}
    </div>
    {!agentInfo.aiEnabled && <div className="admin-agent-note"><AlertTriangle size={17} /><span><b>Natural-language AI is not configured yet</b><small>The secure built-in commands above work now. Add OPENAI_API_KEY on the server for more flexible wording.</small></span></div>}
    <div className="admin-agent-history-head"><div><h3>Command history</h3><p>Plans, confirmations, results, and failures are retained for auditing.</p></div><button className="button button-secondary" onClick={loadTasks}><RefreshCw size={15} /> Refresh</button></div>
    <div className="admin-agent-tasks">
      {!tasks.length && <div className="admin-agent-empty"><Bot size={28} /><b>No commands yet</b><span>Enter a command above to begin.</span></div>}
      {tasks.map((task) => <article className={`admin-agent-task task-${task.status}`} key={task.id}>
        <header>
          <StatusIcon status={task.status} />
          <div><h4>{task.command}</h4><p>{task.summary}</p></div>
          <span className={`agent-risk risk-${task.risk}`}>{task.risk} risk</span>
        </header>
        {task.status === "planned" && <div className="admin-agent-confirm">
          <AlertTriangle size={18} /><span><b>Confirmation required</b><small>{describeAction(task)}</small></span>
          <button className="button button-secondary" disabled={handlingId === task.id} onClick={() => handleTask(task, "cancel")}>Cancel</button>
          <button className="button button-primary" disabled={handlingId === task.id} onClick={() => handleTask(task, "execute")}>{handlingId === task.id ? "Working..." : "Confirm & run"}</button>
        </div>}
        {task.status === "failed" && <div className="admin-agent-error">{task.error || "The command could not be completed."}</div>}
        {task.result && <AgentResult result={task.result} />}
        <footer><span>{task.status}</span><time>{new Date(task.created_at).toLocaleString()}</time><small>{task.planner?.startsWith("openai:") ? "AI planned" : "Built-in planner"}</small></footer>
      </article>)}
    </div>
  </div>;
}

function StatusIcon({ status }) {
  if (status === "completed") return <span className="agent-status status-completed"><CheckCircle2 size={19} /></span>;
  if (status === "failed" || status === "cancelled") return <span className="agent-status status-failed"><XCircle size={19} /></span>;
  return <span className="agent-status status-pending"><Clock3 size={19} /></span>;
}

function describeAction(task) {
  if (task.action === "publish_announcement") return `Publish “${task.arguments?.title}” to the organization (${task.arguments?.priority} priority).`;
  if (task.action === "send_direct_message") return `Send this message to ${task.arguments?.recipient}: “${task.arguments?.body}”`;
  return task.summary;
}

function AgentResult({ result }) {
  if (result.type === "metrics") return <div className="agent-result"><p>{result.message}</p><div className="agent-metrics">{Object.entries(result.data || {}).map(([label, value]) => <span key={label}><b>{value}</b><small>{label}</small></span>)}</div></div>;
  if (result.type === "employees") return <div className="agent-result"><p>{result.message}</p><div className="agent-result-list">{(result.data || []).map((employee) => <span key={employee.id}><b>{employee.full_name}</b><small>{employee.employee_id || "No ID"} · {employee.title} · {employee.department} · {employee.email}</small></span>)}</div></div>;
  if (result.type === "requests") return <div className="agent-result"><p>{result.message}</p><div className="agent-result-list">{[...(result.data?.support || []).map((item) => ({ ...item, label: `Support · ${item.subject}`, date: item.created_at })), ...(result.data?.password_resets || []).map((item) => ({ ...item, label: "Password reset", date: item.requested_at }))].map((item) => <span key={`${item.label}-${item.id}`}><b>{item.label}</b><small>{item.full_name} · {item.employee_id || "No ID"} · {new Date(item.date).toLocaleString()}</small></span>)}</div></div>;
  if (result.type === "activity") return <div className="agent-result"><p>{result.message}</p><div className="agent-result-list">{(result.data || []).map((item, index) => <span key={`${item.latest_at}-${index}`}><b>{item.conversation}</b><small>{item.kind} · {new Date(item.latest_at).toLocaleString()}</small></span>)}</div></div>;
  return <div className="agent-result agent-result-message"><CheckCircle2 size={16} /><p>{result.message}</p></div>;
}
