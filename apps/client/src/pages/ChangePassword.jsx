import { useState } from "react";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, ShieldCheck, Sparkles } from "lucide-react";
import { api } from "../lib/api";

const passwordHint = "At least 8 characters with uppercase, lowercase, number, and special character.";

function passwordValidationError(password) {
  if (password.length < 8) return "New password must be at least 8 characters";
  if (!/[A-Z]/.test(password)) return "New password must include an uppercase letter";
  if (!/[a-z]/.test(password)) return "New password must include a lowercase letter";
  if (!/[0-9]/.test(password)) return "New password must include a number";
  if (!/[^A-Za-z0-9]/.test(password)) return "New password must include a special character";
  if (password.length > 128) return "New password must be 128 characters or fewer";
  return "";
}

export function ChangePassword({ user, onChanged, onLogout, onBack, required = false }) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [visible, setVisible] = useState({ current: false, next: false, confirm: false });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const toggleVisibility = (key) => setVisible((current) => ({ ...current, [key]: !current[key] }));

  async function submitChange(event) {
    event.preventDefault();
    setError("");
    if (form.newPassword !== form.confirmPassword) {
      setError("New passwords do not match");
      return;
    }
    const passwordError = passwordValidationError(form.newPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setBusy(true);
    try {
      await api("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: form.currentPassword,
          newPassword: form.newPassword,
          confirmPassword: form.confirmPassword
        })
      });
      if (required) onChanged();
      else setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const content = (
    <section className={`password-card ${required ? "" : "password-card-routed"}`}>
      <div className="login-brand invite-brand"><span className="logo-mark"><Sparkles size={20} /></span><span>LuxSyncspace</span></div>
      <span className="invite-check"><KeyRound size={24} /></span>
      <span className="eyebrow">{required ? "SECURITY REQUIRED" : "ACCOUNT SECURITY"}</span>
      <h1>{required ? "Create your private password" : "Change password"}</h1>
      <p>{required
        ? `Welcome, ${user.full_name}. Choose a new password to secure your account.`
        : "Update your account password using your current password."}</p>

      {saved ? (
        <div className="password-success" role="status">
          <CheckCircle2 size={24} />
          <p>Your password has been updated.</p>
          <button className="button button-primary" onClick={onBack}><ArrowLeft size={16} /> Back to profile</button>
        </div>
      ) : (
        <form className="event-form invite-form" onSubmit={submitChange}>
          <label><span>Old password</span><PasswordControl autoComplete="current-password" visible={visible.current} onToggle={() => toggleVisibility("current")} value={form.currentPassword} onChange={(event) => update("currentPassword", event.target.value)} minLength={8} /></label>
          <label><span>New password</span><PasswordControl autoComplete="new-password" visible={visible.next} onToggle={() => toggleVisibility("next")} value={form.newPassword} onChange={(event) => update("newPassword", event.target.value)} minLength={8} maxLength={128} /><small>{passwordHint}</small></label>
          <label><span>Re-enter new password</span><PasswordControl autoComplete="new-password" visible={visible.confirm} onToggle={() => toggleVisibility("confirm")} value={form.confirmPassword} onChange={(event) => update("confirmPassword", event.target.value)} minLength={8} maxLength={128} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary" disabled={busy}><ShieldCheck size={17} /> {busy ? "Saving…" : "Save password"}</button>
          {required && <button type="button" className="link-button password-logout" onClick={onLogout}>Sign in with another account</button>}
        </form>
      )}
      {!required && !saved && <button type="button" className="link-button password-page-back" onClick={onBack}><ArrowLeft size={15} /> Back to profile</button>}
    </section>
  );

  if (required) return <main className="password-page">{content}</main>;
  return <div className="page-pad password-route"><header className="page-header"><div><span className="eyebrow">MY PROFILE</span><h1>Change password</h1><p>Keep your account secure with a strong password.</p></div></header>{content}</div>;
}

function PasswordControl({ visible, onToggle, ...inputProps }) {
  return <div className="password-input"><input {...inputProps} type={visible ? "text" : "password"} required /><button type="button" onClick={onToggle} aria-label={visible ? "Hide password" : "Show password"}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>;
}
