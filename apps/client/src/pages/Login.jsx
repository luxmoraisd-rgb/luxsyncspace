import { useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, CircleCheck, Eye, EyeOff, LockKeyhole, MessageSquareText } from "lucide-react";
import { api } from "../lib/api";

function passwordValidationError(password) {
  if (password.length < 8) return "New password must be at least 8 characters";
  if (!/[A-Z]/.test(password)) return "New password must include an uppercase letter";
  if (!/[a-z]/.test(password)) return "New password must include a lowercase letter";
  if (!/[0-9]/.test(password)) return "New password must include a number";
  if (!/[^A-Za-z0-9]/.test(password)) return "New password must include a special character";
  if (password.length > 128) return "New password must be 128 characters or fewer";
  return "";
}

export function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  // const [email, setEmail] = useState("Luxmor@syncspace.com");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotStep, setForgotStep] = useState("request");
  const [resetMessage, setResetMessage] = useState("");
  const [resetDone, setResetDone] = useState(false);
  const [resetKind, setResetKind] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try { await onLogin(email, password); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function requestOtp(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await api("/auth/password-reset-otp", { method: "POST", body: JSON.stringify({ email }) });
      setResetMessage(result.message);
      setForgotStep("verify");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function resetPassword(event) {
    event.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) return setError("New passwords do not match");
    const passwordError = passwordValidationError(newPassword);
    if (passwordError) return setError(passwordError);
    setBusy(true);
    try {
      const result = await api("/auth/reset-password-otp", {
        method: "POST",
        body: JSON.stringify({ email, code, newPassword, confirmPassword })
      });
      setResetMessage(result.message);
      setResetDone(true);
      setResetKind("password");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function requestAdminReset() {
    setError("");
    setBusy(true);
    try {
      const result = await api("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
      setResetMessage(result.message);
      setResetDone(true);
      setResetKind("administrator");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <main className="login-page">
      <section className="login-brand-panel">
        <div className="login-brand"><img className="brand-logo-login" src="/luxmor-logo.jpeg" alt="Luxmor AI Technologies" /></div>
        <div className="login-story">
          <span className="eyebrow eyebrow-light">WORK FLOWS BETTER TOGETHER</span>
          <h1>One place for your people, conversations, and work.</h1>
          <p>Move from conversation to meeting to decision without losing context. LuxSyncspace keeps your company connected and focused.</p>
          <div className="login-features">
            <div><MessageSquareText size={19} /><span><b>Connected conversations</b><small>Direct messages and team channels in one secure workspace</small></span></div>
            <div><CalendarDays size={19} /><span><b>Time that works</b><small>Shared calendars, focused agendas, effortless meetings</small></span></div>
            <div><LockKeyhole size={19} /><span><b>Built for business</b><small>Organization-based access and protected company data</small></span></div>
          </div>
        </div>
        <p className="login-quote">“The best work happens when communication feels effortless.”</p>
      </section>
      <section className="login-form-panel">
        <div className="login-card">
          <span className="mobile-logo"><img src="/luxmor-logo.jpeg" alt="Luxmor AI Technologies" /></span>
          <span className="eyebrow">{forgotMode ? "ACCOUNT RECOVERY" : "WELCOME BACK"}</span>
          <h2>{forgotMode ? forgotStep === "request" ? "Reset your password" : "Verify your email" : "Sign in to your workspace"}</h2>
          <p className="login-hint">{forgotMode ? forgotStep === "request" ? "We’ll send a one-time verification code to your registered work email." : `Enter the code sent to ${email} and choose a new password.` : "Use your company account to continue."}</p>
          {forgotMode && resetDone ? (
            <div className="reset-request-success"><CircleCheck size={28} /><b>{resetKind === "password" ? "Password reset" : "Request sent"}</b><p>{resetMessage}</p><button type="button" className="button button-primary" onClick={() => { setForgotMode(false); setForgotStep("request"); setResetDone(false); setResetMessage(""); setResetKind(""); setError(""); }}>Back to sign in</button></div>
          ) : (
            <form onSubmit={forgotMode ? forgotStep === "request" ? requestOtp : resetPassword : submit}>
              {(!forgotMode || forgotStep === "request") && <label><span>Work email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>}
              {forgotMode && forgotStep === "verify" && <>
                {resetMessage && <p className="password-inline-success" role="status">{resetMessage}</p>}
                <label><span>Verification code</span><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required /></label>
                <label><span>New password</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required /><small>At least 8 characters with uppercase, lowercase, number, and special character.</small></label>
                <label><span>Re-enter new password</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required /></label>
              </>}
              {!forgotMode && <label><span>Password</span><div className="password-input"><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" minLength={8} required /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>}
              {!forgotMode && <div className="login-options"><label className="check-label"><input type="checkbox" defaultChecked /><span><Check size={12} /></span> Keep me signed in</label><button type="button" className="link-button" onClick={() => { setForgotMode(true); setError(""); }}>Forgot password?</button></div>}
              {error && <p className="form-error">{error}</p>}
              <button className="button button-primary login-submit" disabled={busy}>{busy ? (forgotMode ? forgotStep === "request" ? "Sending code…" : "Resetting password…" : "Signing in…") : (forgotMode ? forgotStep === "request" ? "Send verification code" : "Verify code and reset password" : "Sign in")} <ArrowRight size={18} /></button>
              {forgotMode && forgotStep === "request" && <button type="button" className="link-button reset-back" disabled={busy} onClick={requestAdminReset}>Request an administrator reset instead</button>}
              {forgotMode && forgotStep === "verify" && <button type="button" className="link-button reset-back" disabled={busy} onClick={() => { setForgotStep("request"); setError(""); setResetMessage(""); }}>Send a new code</button>}
              {forgotMode && <button type="button" className="link-button reset-back" onClick={() => { setForgotMode(false); setForgotStep("request"); setError(""); setResetMessage(""); }}> <ArrowLeft size={15} /> Back to sign in</button>}
            </form>
          )}
          {!forgotMode && <div className="demo-note"><span>Luxmor AI workspace</span><p>Use the administrator credentials or the temporary password sent to your work email.</p></div>}
          <p className="legal">By continuing, you agree to your organization’s acceptable use and privacy policies.</p>
        </div>
      </section>
    </main>
  );
}
