import { useState } from "react";
import { ArrowLeft, BookOpen, CheckCircle2, ChevronRight, ExternalLink, LifeBuoy, Mail, Send, ShieldCheck } from "lucide-react";
import { Modal } from "../components/Modal";
import { api } from "../lib/api";

const SUPPORT_EMAIL = "Luxmor.syncspace@luxmorai.com";

const QUICK_HELP_TOPICS = [
  {
    title: "Account Access",
    description: "Login assistance, password reset, account activation, and sign-in issues.",
    icon: LifeBuoy,
    sections: [
      { title: "Login assistance", text: "Sign in with the work email address registered by your administrator and the password provided for your account." },
      { title: "Password reset", text: "On the sign-in screen, choose Forgot password? and enter your registered work email. Use the six-digit verification code sent to your email to set a new password. If you cannot complete email verification, request an administrator reset." },
      { title: "Account activation", text: "Your administrator creates your account and sends a temporary password to your work email. Sign in with that password and replace it when prompted. If you have not received it, ask your administrator to check your account and resend the invitation." },
      { title: "Sign-in issues", text: "Check that you are using your registered work email and current password. If you have already replaced a temporary password, use the new one. Use Forgot password? to regain access, or contact your administrator if you remain unable to sign in." },
    ],
  },
  {
    title: "Using LuxSyncspace",
    description: "Guides for chat, meetings, calendar, people, workspace, and notifications.",
    icon: BookOpen,
    sections: [
      { title: "Chat", text: "Open Chat from the sidebar and select a direct conversation or group to read and send messages." },
      { title: "Meetings", text: "Open Meetings to review scheduled meetings, join an upcoming meeting, or schedule a meeting with coworkers." },
      { title: "Calendar", text: "Open Calendar to review your schedule or create an event and invite coworkers." },
      { title: "People", text: "Open People to find coworkers and view their profiles and contact details." },
      { title: "Workspace", text: "Use Home to catch up on workspace updates, and the sidebar to move between shared work areas." },
      { title: "Notifications", text: "Open the notification bell to review updates and go to the related area. Manage message notification preferences in Settings under App & notifications." },
    ],
  },
];

export function HelpSupport({ user, onToast }) {
  const [form, setForm] = useState({ category: "Technical issue", subject: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [activeHelp, setActiveHelp] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api("/support", { method: "POST", body: JSON.stringify(form) });
      setSent(true);
      setForm({ category: "Technical issue", subject: "", message: "" });
      onToast(result.message);
    } catch (error) { onToast(error.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="help-page page-pad">
      <header className="page-header">
        <div><span className="eyebrow">HELP CENTER</span><h1>How can we help?</h1><p>Get support with your account, conversations, meetings, or LuxSyncspace access.</p></div>
      </header>
      <div className="help-layout">
        <section className="panel support-form-panel">
          <header className="settings-section-head"><div><h2>Send a support request</h2><p>Your administrator will receive this request in their LuxSyncspace account with your employee details.</p></div></header>
          {sent ? <div className="support-success"><span><CheckCircle2 size={28} /></span><h2>Request sent</h2><p>We received your message and will reply to {user.email}.</p><button className="button button-secondary" onClick={() => setSent(false)}>Send another request</button></div> :
          <form className="event-form support-form" onSubmit={submit}>
            <label><span>What do you need help with?</span><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option>Technical issue</option><option>Account access</option><option>Feature request</option><option>General help</option></select></label>
            <label><span>Subject</span><input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Briefly describe the issue" required /></label>
            <label><span>Details</span><textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Tell us what happened, what you expected, and any steps that help us reproduce it…" required /></label>
            <div className="support-identity"><ShieldCheck size={17} /><span>Sending as <b>{user.full_name}</b> · {user.employee_id}</span></div>
            <button className="button button-primary" disabled={busy}><Send size={17} /> {busy ? "Sending request…" : "Send to administrator"}</button>
          </form>}
        </section>
        <aside className="help-side">
          <section className="panel support-contact-card">
            <span className="support-card-icon"><Mail size={22} /></span>
            <h2>Email support</h2>
            <p>You can also contact the LuxSyncspace support team directly.</p>
            <a href={`mailto:${SUPPORT_EMAIL}?subject=LuxSyncspace support request`}>{SUPPORT_EMAIL}<ExternalLink size={14} /></a>
          </section>
          <section className="panel quick-help-card">
            <h2>Quick help</h2>
            {QUICK_HELP_TOPICS.map(({ title, description, icon: Icon, ...topic }) => (
              <button key={title} type="button" className="quick-help-item" onClick={() => setActiveHelp({ title, description, ...topic })}>
                <Icon size={18} aria-hidden="true" />
                <span><b>{title}</b><small>{description}</small></span>
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            ))}
          </section>
        </aside>
      </div>
      {activeHelp && <Modal title={activeHelp.title} subtitle={activeHelp.description} onClose={() => setActiveHelp(null)}>
        <div className="quick-help-details">
          {activeHelp.sections.map((section) => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              <p>{section.text}</p>
            </section>
          ))}
          <button type="button" className="button button-secondary" onClick={() => setActiveHelp(null)}><ArrowLeft size={16} /> Back to Quick Help</button>
        </div>
      </Modal>}
    </div>
  );
}
