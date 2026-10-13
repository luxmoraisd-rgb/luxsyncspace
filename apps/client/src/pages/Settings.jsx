import { useEffect, useState } from "react";
import { Badge, Bell, BookOpen, Bot, Building2, CalendarDays, Download, KeyRound, LifeBuoy, Mail, MapPin, MessagesSquare, MoreVertical, Paperclip, Pencil, Phone, PlusSquare, RefreshCw, Save, Search, Send, Share2, ShieldAlert, ShieldCheck, Smartphone, UserRound, Users, UserX, Volume2 } from "lucide-react";
import { api } from "../lib/api";
import { disableNotifications, enableNotifications, notificationsEnabled, notificationsSupported, playNotificationSound } from "../lib/notifications";
import { Avatar } from "../components/Avatar";
import { Modal } from "../components/Modal";
import { AdminAgent } from "../components/AdminAgent";

const emptyInvite = () => ({
  fullName: "",
  employeeId: "",
  email: "",
  title: "",
  department: "Engineering",
  role: "employee",
  phone: "",
  location: "",
  managerId: "",
  joinedAt: new Date().toISOString().slice(0, 10),
  bio: ""
});

function getInstallEnvironment() {
  const userAgent = window.navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/i.test(userAgent) || (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
  const isAndroid = /Android/i.test(userAgent);
  const isMac = /Macintosh|Mac OS X/i.test(userAgent) && !isIOS;
  const isSafari = /Safari/i.test(userAgent) && !/Chrome|CriOS|Edg|OPR|Firefox|FxiOS/i.test(userAgent);
  return { isIOS, isAndroid, isMac, isSafari };
}

function appIsInstalled() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

export function Settings({ user, people, onToast, onRefresh, onUserUpdate, onStartTutorial }) {
  const [tab, setTab] = useState("profile");
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingReset, setPendingReset] = useState(null);
  const [resetRequests, setResetRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [supportRequests, setSupportRequests] = useState([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [invite, setInvite] = useState(emptyInvite);
  const [busy, setBusy] = useState(false);
  const [notificationsOn, setNotificationsOn] = useState(notificationsEnabled);
  const [installAvailable, setInstallAvailable] = useState(Boolean(window.__luxsyncspaceInstallPrompt));
  const [isInstalled, setIsInstalled] = useState(appIsInstalled);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [privacy, setPrivacy] = useState({ displayName: user.display_name || "", hideFullName: Boolean(user.hide_full_name), hideEmail: Boolean(user.hide_email) });
  const installEnvironment = getInstallEnvironment();
  const canInvite = ["hr", "manager", "senior_leader"].includes(user.role);
  const canDeleteEmployees = ["hr", "senior_leader"].includes(user.role);
  const isAdministrator = user.role === "senior_leader";
  const filtered = people.filter((person) => `${person.full_name} ${person.employee_id} ${person.title} ${person.department}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    const available = () => setInstallAvailable(true);
    const installed = () => { setIsInstalled(true); setInstallAvailable(false); setShowInstallHelp(false); };
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const updateDisplayMode = () => setIsInstalled(appIsInstalled());
    window.addEventListener("luxsyncspace:install-available", available);
    window.addEventListener("luxsyncspace:installed", installed);
    displayMode.addEventListener?.("change", updateDisplayMode);
    return () => {
      window.removeEventListener("luxsyncspace:install-available", available);
      window.removeEventListener("luxsyncspace:installed", installed);
      displayMode.removeEventListener?.("change", updateDisplayMode);
    };
  }, []);

  useEffect(() => {
    setPrivacy({ displayName: user.display_name || "", hideFullName: Boolean(user.hide_full_name), hideEmail: Boolean(user.hide_email) });
  }, [user.display_name, user.hide_full_name, user.hide_email]);

  useEffect(() => {
    if (tab !== "password-resets" || !isAdministrator) return;
    loadResetRequests();
  }, [tab, isAdministrator]);

  useEffect(() => {
    if (tab !== "support" || !isAdministrator) return;
    loadSupportRequests();
  }, [tab, isAdministrator]);

  async function loadResetRequests() {
    setRequestsLoading(true);
    try {
      const result = await api("/password-reset-requests");
      setResetRequests(result.requests || []);
    } catch (error) { onToast(error.message); }
    finally { setRequestsLoading(false); }
  }

  async function loadSupportRequests() {
    setSupportLoading(true);
    try {
      const result = await api("/support-requests");
      setSupportRequests(result.requests || []);
    } catch (error) { onToast(error.message); }
    finally { setSupportLoading(false); }
  }

  async function resetEmployeePassword() {
    if (!pendingReset) return;
    setBusy(true);
    try {
      const result = await api(`/employees/${pendingReset.user_id}/password-reset`, { method: "POST" });
      setPendingReset(null);
      await loadResetRequests();
      onToast(result.message);
    } catch (error) { onToast(error.message); }
    finally { setBusy(false); }
  }

  async function savePrivacy(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api("/profile/privacy", { method: "PATCH", body: JSON.stringify(privacy) });
      onUserUpdate?.(result.user);
      await onRefresh();
      window.dispatchEvent(new CustomEvent("luxsyncspace:self-updated", { detail: result.user }));
      onToast(result.message);
    } catch (error) { onToast(error.message); }
    finally { setBusy(false); }
  }

  async function turnOnNotifications() {
    try {
      await enableNotifications();
      setNotificationsOn(true);
      onToast("Notifications and the LuxSyncspace sound are enabled");
    } catch (error) { onToast(error.message); }
  }

  async function turnOffNotifications() {
    try {
      await disableNotifications();
      setNotificationsOn(false);
      onToast("Notifications disabled on this device");
    } catch (error) { onToast(error.message); }
  }

  async function installApp() {
    const prompt = window.__luxsyncspaceInstallPrompt;
    if (!prompt) {
      setShowInstallHelp(true);
      return;
    }
    await prompt.prompt();
    const choice = await prompt.userChoice;
    window.__luxsyncspaceInstallPrompt = null;
    setInstallAvailable(false);
    if (choice.outcome === "accepted") {
      onToast("LuxSyncspace installed");
    } else {
      onToast("Installation was cancelled. You can try again anytime.");
    }
  }

  async function createInvite(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api("/invitations", { method: "POST", body: JSON.stringify(invite) });
      await onRefresh();
      setInvite(emptyInvite());
      onToast(result.message || "Employee invitation email sent");
    } catch (error) { onToast(error.message); }
    finally { setBusy(false); }
  }

  function startEditing(person) {
    setEditing({
      fullName: person.full_name || "",
      employeeId: person.employee_id || "",
      email: person.email || "",
      title: person.title || "",
      department: person.department || "",
      role: person.role || "employee",
      phone: person.phone || "",
      location: person.location || "",
      managerId: person.manager_id || "",
      joinedAt: person.joined_at ? String(person.joined_at).slice(0, 10) : new Date().toISOString().slice(0, 10),
      bio: person.bio || ""
    });
  }

  async function updateEmployee(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api(`/employees/${selected.id}`, { method: "PATCH", body: JSON.stringify(editing) });
      setSelected(result.employee);
      setEditing(null);
      await onRefresh();
      onToast(result.message || "Employee details updated");
    } catch (error) { onToast(error.message); }
    finally { setBusy(false); }
  }

  async function deleteEmployee() {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      const result = await api(`/employees/${pendingDelete.id}/employment`, {
        method: "PATCH",
        body: JSON.stringify({ status: "deleted" })
      });
      setPendingDelete(null);
      setSelected(null);
      setEditing(null);
      await onRefresh();
      onToast(result.message || "Employee deleted");
    } catch (error) { onToast(error.message); }
    finally { setBusy(false); }
  }

  function canEditEmployee(person) {
    if (!canInvite) return false;
    if (user.role === "manager" && ["hr", "senior_leader"].includes(person.role)) return false;
    if (user.role === "hr" && person.role === "senior_leader") return false;
    return true;
  }

  function canDeleteEmployee(person) {
    if (!canDeleteEmployees || person.id === user.id) return false;
    if (person.role === "senior_leader" && user.role !== "senior_leader") return false;
    return (person.employment_status || "active") === "active";
  }

  return (
    <div className="settings-page page-pad">
      <header className="page-header"><div><span className="eyebrow">SETTINGS</span><h1>Profile & organization</h1><p>Review employee information and manage workspace access.</p></div></header>
      <div className="settings-layout">
        <aside className="settings-nav panel">
          <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}><UserRound size={18} /> My profile</button>
          <button className={tab === "employees" ? "active" : ""} onClick={() => setTab("employees")}><Users size={18} /> Employee profiles</button>
          {canInvite && <button className={tab === "invite" ? "active" : ""} onClick={() => setTab("invite")}><Send size={18} /> Invite employees</button>}
          {isAdministrator && <button className={tab === "password-resets" ? "active" : ""} onClick={() => setTab("password-resets")}><KeyRound size={18} /> Password resets</button>}
          {isAdministrator && <button className={tab === "support" ? "active" : ""} onClick={() => setTab("support")}><LifeBuoy size={18} /> Support requests</button>}
          {isAdministrator && <button className={tab === "ai-agent" ? "active" : ""} onClick={() => setTab("ai-agent")}><Bot size={18} /> AI agent</button>}
          {isAdministrator && <button className={tab === "chat-history" ? "active" : ""} onClick={() => setTab("chat-history")}><MessagesSquare size={18} /> Chat history</button>}
          <button className={tab === "app" ? "active" : ""} onClick={() => setTab("app")}><Smartphone size={18} /> App & notifications</button>
        </aside>
        <section className="settings-content panel">
          {tab === "profile" && <><ProfileDetails person={user} heading="My employee profile" />
            <form className="privacy-settings" onSubmit={savePrivacy}>
              <header><div><ShieldCheck size={19} /></div><span><h3>Directory privacy</h3><p>Control the identity coworkers see. HR and senior administrators can still view official account details.</p></span></header>
              <label className="privacy-toggle"><span><b>Use a display name</b><small>Hide your full legal name from the employee directory and show the name below instead.</small></span><input type="checkbox" checked={privacy.hideFullName} onChange={(event) => setPrivacy({ ...privacy, hideFullName: event.target.checked })} /></label>
              {privacy.hideFullName && <label className="privacy-display-name"><span>Display name shown to coworkers</span><input value={privacy.displayName} onChange={(event) => setPrivacy({ ...privacy, displayName: event.target.value })} placeholder="e.g. Abi R" minLength={2} maxLength={80} required /></label>}
              <label className="privacy-toggle"><span><b>Hide my work email</b><small>Coworkers will not see your email in People or search results.</small></span><input type="checkbox" checked={privacy.hideEmail} onChange={(event) => setPrivacy({ ...privacy, hideEmail: event.target.checked })} /></label>
              <button className="button button-primary" disabled={busy}><Save size={16} /> {busy ? "Saving…" : "Save privacy settings"}</button>
            </form>
          </>}
          {tab === "employees" && <>
            <header className="settings-section-head"><div><h2>Employee profiles</h2><p>View company identity, designation, team, and contact details.</p></div></header>
            <label className="section-search settings-search"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by employee ID, name, or designation" /></label>
            <div className="employee-profile-cards">
              {filtered.map((person) => <article className="employee-profile-card" key={person.id}>
                <div className="employee-card-head"><Avatar person={person} showPresence /><div><h3>{person.full_name}</h3><p>{person.employee_id || "Employee ID pending"}</p><small>{person.title} · {person.department}</small></div><span className={`role-chip role-${person.role}`}>{person.role.replace("_", " ")}</span></div>
                {(!person.phone || !person.location) && <div className="profile-missing-fields">{!person.phone && <span><Phone size={13} /> Phone not provided</span>}{!person.location && <span><MapPin size={13} /> Work location not provided</span>}</div>}
                <div className="employee-card-actions"><button className="button button-secondary" onClick={() => setSelected(person)}><Search size={15} /> View details</button>{canEditEmployee(person) && <button className="button button-primary" onClick={() => { setSelected(person); startEditing(person); }}><Pencil size={15} /> Edit</button>}</div>
              </article>)}
            </div>
          </>}
          {tab === "invite" && canInvite && <>
            <header className="settings-section-head"><div><h2>Invite a new employee</h2><p>Create the account and email a one-time temporary password through ZeptoMail.</p></div></header>
            <form className="invite-settings-form event-form" onSubmit={createInvite}>
              <div className="form-grid"><label><span>Employee name</span><input value={invite.fullName} onChange={(e) => setInvite({ ...invite, fullName: e.target.value })} placeholder="Full legal name" required /></label><label><span>Work email</span><input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="employee@company.com" required /></label></div>
              <label><span>Employee ID</span><input value={invite.employeeId} onChange={(e) => setInvite({ ...invite, employeeId: e.target.value.toUpperCase() })} placeholder="e.g. LUX-1002 (leave blank to generate automatically)" pattern="[A-Za-z0-9-]{3,30}" /></label>
              <label><span>Designation</span><input value={invite.title} onChange={(e) => setInvite({ ...invite, title: e.target.value })} placeholder="e.g. Software Engineer" required /></label>
              <div className="form-grid"><label><span>Department</span><input value={invite.department} onChange={(e) => setInvite({ ...invite, department: e.target.value })} required /></label><label><span>Access role</span><select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}><option value="employee">Employee</option><option value="team_lead">Team lead</option><option value="manager">Manager</option><option value="hr">HR</option></select></label></div>
              <div className="form-grid"><label><span>Phone number</span><input type="tel" value={invite.phone} onChange={(e) => setInvite({ ...invite, phone: e.target.value })} placeholder="+91 98765 43210" /></label><label><span>Work location</span><input value={invite.location} onChange={(e) => setInvite({ ...invite, location: e.target.value })} placeholder="e.g. Hyderabad, India" /></label></div>
              <div className="form-grid"><label><span>Reporting manager</span><select value={invite.managerId} onChange={(e) => setInvite({ ...invite, managerId: e.target.value })}><option value="">Not assigned</option>{people.map((person) => <option value={person.id} key={person.id}>{person.full_name} · {person.title}</option>)}</select></label><label><span>Joining date</span><input type="date" value={invite.joinedAt} onChange={(e) => setInvite({ ...invite, joinedAt: e.target.value })} required /></label></div>
              <label><span>Employee profile summary</span><textarea value={invite.bio} onChange={(e) => setInvite({ ...invite, bio: e.target.value })} placeholder="Add responsibilities, expertise, or a short professional introduction…" maxLength={1000} /></label>
              <div className="email-delivery-note"><ShieldCheck size={18} /><span><b>Secure email delivery</b><small>The employee will receive their email as username and a generated temporary password. They must replace it after signing in.</small></span></div>
              <button className="button button-primary" disabled={busy}><Send size={17} /> {busy ? "Creating account and sending…" : "Send employee invitation"}</button>
            </form>
          </>}
          {tab === "password-resets" && isAdministrator && <>
            <header className="settings-section-head reset-section-head"><div><h2>Password reset requests</h2><p>Administrator-only requests submitted from the sign-in page.</p></div><button className="button button-secondary" onClick={loadResetRequests} disabled={requestsLoading}><RefreshCw size={15} /> Refresh</button></header>
            <div className="reset-request-list">
              {requestsLoading && !resetRequests.length && <div className="reset-list-empty">Loading password reset requests…</div>}
              {!requestsLoading && !resetRequests.length && <div className="reset-list-empty"><KeyRound size={25} /><b>No password reset requests</b><p>New employee requests will appear here.</p></div>}
              {resetRequests.map((request) => <section className="reset-request-row" key={request.id}>
                <div className="reset-request-icon"><KeyRound size={18} /></div>
                <div><h3>{request.full_name}</h3><p>{request.employee_id} · {request.email}</p><small>Requested {new Date(request.requested_at).toLocaleString()}</small></div>
                <span className={`reset-status reset-status-${request.status}`}>{request.status}</span>
                {request.status === "pending" ? <button className="button button-primary" onClick={() => setPendingReset(request)}>Reset & email</button> : <small className="reset-completed-at">Completed {new Date(request.completed_at).toLocaleString()}</small>}
              </section>)}
            </div>
          </>}
          {tab === "support" && isAdministrator && <>
            <header className="settings-section-head reset-section-head"><div><h2>Support requests</h2><p>Employee requests submitted through the Help Center.</p></div><button className="button button-secondary" onClick={loadSupportRequests} disabled={supportLoading}><RefreshCw size={15} /> Refresh</button></header>
            <div className="support-request-list">
              {supportLoading && !supportRequests.length && <div className="reset-list-empty">Loading support requests…</div>}
              {!supportLoading && !supportRequests.length && <div className="reset-list-empty"><LifeBuoy size={25} /><b>No support requests</b><p>New employee requests will appear here.</p></div>}
              {supportRequests.map((request) => <section className="support-request-row" key={request.id}>
                <div className="reset-request-icon"><LifeBuoy size={18} /></div>
                <div><h3>{request.subject}</h3><p><b>{request.category}</b> · {request.full_name} ({request.employee_id || "No ID"})</p><small>{request.title} · {request.department} · {request.email}</small><p className="support-request-message">{request.message}</p><small>Submitted {new Date(request.created_at).toLocaleString()}</small></div>
              </section>)}
            </div>
          </>}
          {tab === "chat-history" && isAdministrator && <ChatHistoryAdmin onToast={onToast} />}
          {tab === "ai-agent" && isAdministrator && <AdminAgent onToast={onToast} />}
          {tab === "app" && <>
            <header className="settings-section-head"><div><h2>App & notifications</h2><p>Install LuxSyncspace and choose how you receive new-message alerts.</p></div></header>
            <div className="app-settings-list">
              <section>
                <span className="app-setting-icon"><Download size={21} /></span>
                <div><h3>Install LuxSyncspace</h3><p>Add the app to your phone home screen or desktop. It opens in its own app window and keeps essential files available offline.</p><small>{isInstalled ? "LuxSyncspace is installed on this device." : installAvailable ? "This device is ready to install." : installEnvironment.isIOS ? "On iPhone and iPad, install from Safari’s Share menu." : installEnvironment.isMac && installEnvironment.isSafari ? "On Safari, add this app to your Dock." : "Install from your browser menu using the guided steps."}</small></div>
                <button className="button button-secondary" onClick={installApp} disabled={isInstalled}>{isInstalled ? "Installed" : installAvailable ? "Install app" : "View install steps"}</button>
              </section>
              <section>
                <span className="app-setting-icon"><Bell size={21} /></span>
                <div><h3>Message notifications</h3><p>Receive alerts for direct messages, group messages, and company announcements on laptop and supported mobile devices.</p><small>{!notificationsSupported() ? "This browser does not support PWA notifications." : notificationsOn ? "Notifications are enabled." : "Permission is not enabled yet."}</small></div>
                <button className={`button ${notificationsOn ? "button-secondary" : "button-primary"}`} onClick={notificationsOn ? turnOffNotifications : turnOnNotifications}>{notificationsOn ? "Turn off" : "Enable"}</button>
              </section>
              <section>
                <span className="app-setting-icon"><Volume2 size={21} /></span>
                <div><h3>LuxSyncspace notification sounds</h3><p>Messages use the LuxSyncspace chime, meetings use a separate reminder tone, and incoming calls ring repeatedly until answered or declined. Background notifications use the sound permitted by your operating system.</p></div>
                <div className="sound-test-actions">
                  <button className="button button-secondary" onClick={() => { playNotificationSound("message"); onToast("Playing message sound"); }}>Test message</button>
                  <button className="button button-secondary" onClick={() => { playNotificationSound("meeting"); onToast("Playing meeting reminder sound"); }}>Test meeting</button>
                </div>
              </section>
              <section>
                <span className="app-setting-icon"><BookOpen size={21} /></span>
                <div><h3>App tutorial</h3><p>Replay the guided tour for chat, notifications, calendar scheduling, and meetings.</p></div>
                <button className="button button-secondary" onClick={onStartTutorial}>Start tutorial</button>
              </section>
            </div>
          </>}
        </section>
      </div>
      {selected && !editing && !pendingDelete && <Modal title="Employee profile" subtitle={selected.employee_id} onClose={() => setSelected(null)}><div className="profile-modal"><ProfileDetails person={selected} />{(canEditEmployee(selected) || canDeleteEmployee(selected)) && <div className="employee-profile-actions">{canDeleteEmployee(selected) && <button className="button button-danger" onClick={() => setPendingDelete(selected)}><UserX size={16} /> Delete employee</button>}{canEditEmployee(selected) && <button className="button button-primary" onClick={() => startEditing(selected)}><Pencil size={16} /> Edit details</button>}</div>}</div></Modal>}
      {selected && editing && <Modal title="Edit employee details" subtitle={selected.employee_id} onClose={() => setEditing(null)}>
        <form className="event-form" onSubmit={updateEmployee}>
          <div className="form-grid"><label><span>Employee name</span><input value={editing.fullName} onChange={(e) => setEditing({ ...editing, fullName: e.target.value })} required /></label><label><span>Work email</span><input type="email" value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} required /></label></div>
          <div className="form-grid"><label><span>Employee ID</span><input value={editing.employeeId} onChange={(e) => setEditing({ ...editing, employeeId: e.target.value.toUpperCase() })} pattern="[A-Za-z0-9-]{3,30}" required /></label><label><span>Designation</span><input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} required /></label></div>
          <div className="form-grid"><label><span>Department</span><input value={editing.department} onChange={(e) => setEditing({ ...editing, department: e.target.value })} required /></label><label><span>Access role</span><select value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })}><option value="employee">Employee</option><option value="team_lead">Team lead</option><option value="manager">Manager</option><option value="hr" disabled={user.role === "manager"}>HR</option>{user.role === "senior_leader" && <option value="senior_leader">Senior leader</option>}</select></label></div>
          <div className="form-grid"><label><span>Phone number</span><input type="tel" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></label><label><span>Work location</span><input value={editing.location} onChange={(e) => setEditing({ ...editing, location: e.target.value })} /></label></div>
          <div className="form-grid"><label><span>Reporting manager</span><select value={editing.managerId} onChange={(e) => setEditing({ ...editing, managerId: e.target.value })}><option value="">Not assigned</option>{people.filter((person) => person.id !== selected.id).map((person) => <option value={person.id} key={person.id}>{person.full_name} · {person.title}</option>)}</select></label><label><span>Joining date</span><input type="date" value={editing.joinedAt} onChange={(e) => setEditing({ ...editing, joinedAt: e.target.value })} required /></label></div>
          <label><span>Employee profile summary</span><textarea value={editing.bio} onChange={(e) => setEditing({ ...editing, bio: e.target.value })} maxLength={1000} /></label>
          <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setEditing(null)} disabled={busy}>Cancel</button><button className="button button-primary" disabled={busy}><Save size={16} /> {busy ? "Saving…" : "Save changes"}</button></div>
        </form>
      </Modal>}
      {pendingDelete && <Modal title={`Delete ${pendingDelete.full_name}?`} subtitle="Employee account management" onClose={() => !busy && setPendingDelete(null)}>
        <div className="employment-confirm">
          <UserX size={30} />
          <h3>Deactivate and mark as deleted</h3>
          <p>The employee will be signed out and will no longer be able to access the workspace. Existing conversations and records will be preserved.</p>
          <div className="modal-actions"><button className="button button-secondary" onClick={() => setPendingDelete(null)} disabled={busy}>Cancel</button><button className="button button-danger" onClick={deleteEmployee} disabled={busy}>{busy ? "Deleting…" : "Delete employee"}</button></div>
        </div>
      </Modal>}
      {pendingReset && <Modal title={`Reset ${pendingReset.full_name}'s password?`} subtitle="Administrator password reset" onClose={() => !busy && setPendingReset(null)}>
        <div className="employment-confirm password-reset-confirm">
          <KeyRound size={30} />
          <h3>Generate a temporary password</h3>
          <p>The employee’s current password will stop working. A temporary password will be emailed to <b>{pendingReset.email}</b>, and they must create a new password after signing in.</p>
          <div className="modal-actions"><button className="button button-secondary" onClick={() => setPendingReset(null)} disabled={busy}>Cancel</button><button className="button button-primary" onClick={resetEmployeePassword} disabled={busy}>{busy ? "Resetting and emailing…" : "Reset password & email"}</button></div>
        </div>
      </Modal>}
      {showInstallHelp && <InstallHelp environment={installEnvironment} onClose={() => setShowInstallHelp(false)} />}
    </div>
  );
}

function ChatHistoryAdmin({ onToast }) {
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [history, setHistory] = useState(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [page, setPage] = useState(0);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => { loadConversations(); }, []);

  useEffect(() => {
    if (!selectedConversation) {
      setHistory(null);
      return;
    }
    let active = true;
    setHistoryLoading(true);
    const path = selectedConversation.kind === "direct"
      ? `/admin/chat-history/direct/${selectedConversation.first_user_id}/${selectedConversation.second_user_id}?page=${page}`
      : `/admin/chat-history/channels/${selectedConversation.channel_id}?page=${page}`;
    api(path)
      .then((result) => { if (active) setHistory(result); })
      .catch((error) => { if (active) onToast(error.message); })
      .finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [selectedConversation, page, onToast]);

  async function loadConversations() {
    setConversationsLoading(true);
    try {
      const result = await api("/admin/chat-history/conversations");
      const items = result.conversations || [];
      setConversations(items);
      setSelectedConversation((current) => current && items.some((item) => item.id === current.id) ? current : items[0] || null);
    } catch (error) { onToast(error.message); }
    finally { setConversationsLoading(false); }
  }

  function chooseConversation(conversation) {
    setPage(0);
    setHistory(null);
    setSelectedConversation(conversation);
  }

  const visibleConversations = conversations.filter((conversation) => {
    if (kind !== "all" && conversation.kind !== kind) return false;
    const searchable = conversation.kind === "direct"
      ? `${conversation.first_user_name} ${conversation.second_user_name} ${conversation.first_employee_id || ""} ${conversation.second_employee_id || ""}`
      : conversation.name;
    return searchable.toLowerCase().includes(query.trim().toLowerCase());
  });
  const totalPages = history ? Math.max(1, Math.ceil(history.total / history.pageSize)) : 1;

  return <div className="chat-audit">
    <header className="settings-section-head reset-section-head">
      <div><h2>Chat history</h2><p>Main-administrator view of direct and group conversations in this organization.</p></div>
      <button className="button button-secondary" onClick={loadConversations} disabled={conversationsLoading}><RefreshCw size={15} /> Refresh</button>
    </header>
    <div className="chat-audit-warning"><ShieldAlert size={19} /><span><b>Restricted and confidential</b><small>Use message history only for authorized company administration, investigations, or compliance work.</small></span></div>
    <div className="chat-audit-layout">
      <aside className="chat-audit-sidebar">
        <label className="section-search chat-audit-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people or groups" /></label>
        <div className="chat-audit-filters">
          {[['all', 'All'], ['direct', 'Direct'], ['channel', 'Groups']].map(([value, label]) => <button key={value} className={kind === value ? "active" : ""} onClick={() => setKind(value)}>{label}</button>)}
        </div>
        <div className="chat-audit-conversations">
          {conversationsLoading && !conversations.length && <div className="chat-audit-empty">Loading conversations...</div>}
          {!conversationsLoading && !visibleConversations.length && <div className="chat-audit-empty">No conversations found.</div>}
          {visibleConversations.map((conversation) => {
            const title = conversation.kind === "direct" ? `${conversation.first_user_name} & ${conversation.second_user_name}` : conversation.name;
            const meta = conversation.kind === "direct" ? "Direct conversation" : `${conversation.participant_count} participants`;
            return <button key={conversation.id} className={selectedConversation?.id === conversation.id ? "active" : ""} onClick={() => chooseConversation(conversation)}>
              <span className={`chat-audit-type chat-audit-type-${conversation.kind}`}><MessagesSquare size={16} /></span>
              <span><b>{title}</b><small>{meta} · {conversation.message_count} messages</small><em>{conversation.last_message || "No text"}</em></span>
              <time>{new Date(conversation.latest_at).toLocaleDateString()}</time>
            </button>;
          })}
        </div>
      </aside>
      <section className="chat-audit-history">
        {!selectedConversation && <div className="chat-audit-empty chat-audit-empty-large"><MessagesSquare size={28} /><b>Select a conversation</b><span>The complete available history will appear here.</span></div>}
        {selectedConversation && <>
          <header>
            <div><h3>{selectedConversation.kind === "direct" ? `${selectedConversation.first_user_name} & ${selectedConversation.second_user_name}` : selectedConversation.name}</h3><p>{history?.total ?? selectedConversation.message_count} messages · {selectedConversation.kind === "direct" ? "Private chat" : "Group chat"}</p></div>
            <span>{page + 1} / {totalPages}</span>
          </header>
          <div className="chat-audit-messages">
            {historyLoading && <div className="chat-audit-empty">Loading message history...</div>}
            {!historyLoading && history && !history.messages.length && <div className="chat-audit-empty">No messages on this page.</div>}
            {!historyLoading && history?.messages.map((message) => <article className={message.deleted_at ? "deleted" : ""} key={message.id}>
              <div className="chat-audit-message-head"><b>{message.sender_name}</b>{message.recipient_name && <span>to {message.recipient_name}</span>}<time>{new Date(message.sent_at).toLocaleString()}</time></div>
              <p>{message.deleted_at ? "This message was deleted for everyone." : message.body || (message.file_name ? "Shared an attachment" : "Empty message")}</p>
              {message.file_name && !message.deleted_at && <div className="chat-audit-attachment"><Paperclip size={14} /> {message.file_name} <small>({Math.max(1, Math.round(message.file_size / 1024))} KB)</small></div>}
              <footer>{message.edited_at && <span>Edited</span>}{message.read_at && <span>Read {new Date(message.read_at).toLocaleString()}</span>}</footer>
            </article>)}
          </div>
          {history && history.total > history.pageSize && <footer className="chat-audit-pagination">
            <button className="button button-secondary" disabled={historyLoading || page === 0} onClick={() => setPage((value) => value - 1)}>Newer messages</button>
            <small>Showing {page * history.pageSize + 1}-{Math.min((page + 1) * history.pageSize, history.total)} of {history.total}</small>
            <button className="button button-secondary" disabled={historyLoading || page + 1 >= totalPages} onClick={() => setPage((value) => value + 1)}>Older messages</button>
          </footer>}
        </>}
      </section>
    </div>
  </div>;
}

function InstallHelp({ environment, onClose }) {
  let title = "Install on this device";
  let note = "Use a current version of Chrome or Edge for the simplest installation experience.";
  let steps = [
    [MoreVertical, "Open the browser menu", "Look for the three-dot menu near the address bar."],
    [Download, "Choose Install app", "It may also be named Add to Home screen or Apps > Install LuxSyncspace."],
    [Smartphone, "Confirm installation", "Launch LuxSyncspace from your home screen, desktop, or app list."]
  ];

  if (environment.isIOS) {
    title = "Install on iPhone or iPad";
    note = environment.isSafari ? "Keep this page open in Safari and follow these steps." : "Open this page in Safari first. Other iPhone and iPad browsers may not show Apple’s web-app installation controls.";
    steps = [
      [Share2, "Tap Share in Safari", "Use the Share button in Safari’s toolbar."],
      [PlusSquare, "Tap Add to Home Screen", "Scroll down if the option is not immediately visible."],
      [Smartphone, "Turn on Open as Web App", "Tap Add, then launch LuxSyncspace from your Home Screen."]
    ];
  } else if (environment.isMac && environment.isSafari) {
    title = "Install on Mac";
    note = "Safari web apps require macOS Sonoma 14 or later. Chrome and Edge can also install from their browser menus.";
    steps = [
      [Share2, "Open Safari’s Share menu", "You can also use File in the Mac menu bar."],
      [PlusSquare, "Choose Add to Dock", "Confirm the app name and icon."],
      [Smartphone, "Open from the Dock", "LuxSyncspace will run in its own app window."]
    ];
  } else if (environment.isAndroid) {
    title = "Install on Android";
    note = "For best results, open this page in a current version of Chrome, Edge, or Samsung Internet.";
  }

  return <Modal title={title} subtitle="LuxSyncspace web app" onClose={onClose}>
    <div className="install-help">
      <div className="install-help-note"><Smartphone size={19} /><p>{note}</p></div>
      <ol>{steps.map(([Icon, heading, description]) => <li key={heading}><span><Icon size={18} /></span><div><b>{heading}</b><small>{description}</small></div></li>)}</ol>
      <p className="install-secure-note">Installation is available only when the app is opened from its secure HTTPS address. Private browsing or device-management restrictions can hide installation options.</p>
      <div className="modal-actions"><button className="button button-primary" onClick={onClose}>Done</button></div>
    </div>
  </Modal>;
}

function ProfileDetails({ person, heading }) {
  const details = [
    [Badge, "Employee ID", person.employee_id || "Pending"],
    [Building2, "Department", person.department],
    [ShieldCheck, "Workspace role", person.role?.replace("_", " ")],
    [Mail, "Work email", person.email || "Hidden by employee"],
    [Phone, "Phone", person.phone || "Not provided"],
    [MapPin, "Location", person.location || "Not provided"],
    [UserRound, "Manager", person.manager_name || "Not assigned"],
    [CalendarDays, "Joined", person.joined_at ? new Date(person.joined_at).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : "Not available"]
  ];
  return <div className="profile-details">
    {heading && <header className="settings-section-head"><div><h2>{heading}</h2><p>Your official information in the company directory.</p></div></header>}
    <div className="profile-hero"><Avatar person={person} size="xl" showPresence /><div><h2>{person.full_name}</h2><p>{person.title}</p><span className={`role-chip role-${person.role}`}>{person.role?.replace("_", " ")}</span></div></div>
    {person.bio && <p className="profile-bio">{person.bio}</p>}
    <div className="profile-detail-grid">{details.map(([Icon, label, value]) => <div key={label}><Icon size={17} /><span><small>{label}</small><b>{value}</b></span></div>)}</div>
  </div>;
}
