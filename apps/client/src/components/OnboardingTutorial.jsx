import { useEffect, useState } from "react";
import { BellRing, CalendarPlus, Check, ChevronLeft, ChevronRight, MessageSquareText, Sparkles, Users, X } from "lucide-react";
import { api } from "../lib/api";
import { enableNotifications, notificationsEnabled, notificationsSupported } from "../lib/notifications";

const steps = [
  {
    icon: Sparkles,
    eyebrow: "WELCOME TO LUXSYNCSPACE",
    title: "Your workspace is ready",
    description: "Chat with coworkers, join group conversations, schedule meetings, and receive important updates in one place.",
    points: ["Find coworkers in People", "Use Chat for private and group messages", "Keep your availability status updated"]
  },
  {
    icon: MessageSquareText,
    eyebrow: "MESSAGES",
    title: "Send your first message",
    description: "Open Chat, choose an employee or channel, type your message, and tap the blue send button. Unread numbers show conversations you have not opened.",
    action: "Open Chat",
    view: "chat",
    points: ["Attach documents and images", "Reply, react, and forward channel messages", "Older conversations are grouped by date"]
  },
  {
    icon: BellRing,
    eyebrow: "NOTIFICATIONS",
    title: "Never miss an update",
    description: "Enable notifications to receive message, meeting, and call alerts even when LuxSyncspace is running in the background.",
    notificationAction: true,
    points: ["Tap the bell to see recent alerts", "Unread messages remain numbered until opened", "You can change notification settings later"]
  },
  {
    icon: CalendarPlus,
    eyebrow: "CALENDAR & MEETINGS",
    title: "Schedule and join meetings",
    description: "Use Calendar or Meetings to invite coworkers, choose the date and time, and create an online meeting.",
    action: "Open Calendar",
    view: "calendar",
    points: ["Start instant audio or video calls", "Receive meeting reminders", "Use meeting chat without leaving the call"]
  }
];

export function OnboardingTutorial({ user, onComplete, onClose, onNavigate, onToast }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const current = steps[step];
  const Icon = current.icon;

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        handleExit();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  async function enableAlerts() {
    try {
      await enableNotifications();
      onToast("Notifications enabled");
    } catch (error) { onToast(error.message); }
  }

  function handleExit() {
    if (onClose) onClose();
    else onComplete?.(user?.onboarding_completed_at || new Date().toISOString());
  }

  async function handleSkip() {
    setBusy(true);
    try {
      const result = await api("/onboarding/complete", { method: "POST" });
      onComplete?.(result?.onboarding_completed_at || new Date().toISOString());
    } catch {
      onComplete?.(user?.onboarding_completed_at || new Date().toISOString());
    } finally {
      setBusy(false);
      if (onClose) onClose();
    }
  }

  async function finish(view) {
    setBusy(true);
    try {
      const result = await api("/onboarding/complete", { method: "POST" });
      onComplete?.(result?.onboarding_completed_at || new Date().toISOString());
      if (view) onNavigate?.(view);
    } catch (error) {
      onComplete?.(user?.onboarding_completed_at || new Date().toISOString());
      if (view) onNavigate?.(view);
    } finally {
      setBusy(false);
      if (onClose) onClose();
    }
  }

  function useAction() {
    if (current.view) finish(current.view);
  }

  return (
    <div
      className="onboarding-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleExit();
      }}
    >
      <section className="onboarding-card">
        <button
          type="button"
          className="onboarding-close-button"
          onClick={handleExit}
          title="Exit tutorial"
          aria-label="Exit tutorial"
        >
          <X size={15} />
          <span>Exit</span>
        </button>
        <aside className="onboarding-rail">
          <span className="onboarding-logo"><Sparkles size={21} /></span>
          <div><b>Welcome, {user.display_name || user.full_name}</b><small>Let’s get you comfortable with your new workspace.</small></div>
          <nav>{steps.map((item, index) => <span className={index === step ? "active" : index < step ? "complete" : ""} key={item.title}>{index < step ? <Check size={13} /> : index + 1}<small>{item.eyebrow.split(" ")[0]}</small></span>)}</nav>
        </aside>
        <main className="onboarding-content">
          <span className="onboarding-step-icon"><Icon size={29} /></span>
          <span className="eyebrow">{current.eyebrow}</span>
          <h1 id="onboarding-title">{current.title}</h1>
          <p>{current.description}</p>
          <div className="onboarding-points">{current.points.map((point) => <div key={point}><Check size={15} /><span>{point}</span></div>)}</div>
          {current.notificationAction && <button className="button button-primary onboarding-action" onClick={enableAlerts} disabled={!notificationsSupported() || notificationsEnabled()}><BellRing size={16} /> {notificationsEnabled() ? "Notifications enabled" : "Enable notifications"}</button>}
          {current.action && <button className="button button-secondary onboarding-action" onClick={useAction} disabled={busy}>{current.action}</button>}
          <footer>
            <button type="button" className="tutorial-skip" onClick={handleSkip} disabled={busy}>Skip tutorial</button>
            <span><button type="button" className="button button-secondary" onClick={() => setStep((value) => value - 1)} disabled={step === 0 || busy}><ChevronLeft size={16} /> Back</button>{step < steps.length - 1 ? <button type="button" className="button button-primary" onClick={() => setStep((value) => value + 1)}>Next <ChevronRight size={16} /></button> : <button type="button" className="button button-primary" onClick={() => finish()} disabled={busy}><Users size={16} /> {busy ? "Finishing…" : "Start working"}</button>}</span>
          </footer>
        </main>
      </section>
    </div>
  );
}
