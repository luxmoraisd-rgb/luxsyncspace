import { useRef, useState } from "react";
import { Ban, CalendarClock, Check, Clock, Copy, Mic, PhoneOff, Plus, Search, Send, UserPlus, Users, Video, X } from "lucide-react";
import { format } from "date-fns";
import { Avatar } from "../components/Avatar";
import { copyTextToClipboard } from "../lib/clipboard";
import { Modal } from "../components/Modal";

export function Meetings({ user, events, people, onJoinMeeting, onStartMeeting, onScheduleMeeting, onCancelEvent, onAddAttendees, onToast }) {
  const [instantOpen, setInstantOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [peopleTarget, setPeopleTarget] = useState(null);
  const cancelDialogRef = useRef(null);
  const scheduled = events.filter((event) => event.cancelled_at || event.ended_at || new Date(event.ends_at) > new Date());
  const upcoming = scheduled.filter((event) => !event.cancelled_at && !event.ended_at);

  async function copyLink(event) {
    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set("meeting", event.id);
    const success = await copyTextToClipboard(url.toString());
    if (success) {
      onToast("Meeting link copied to clipboard");
    } else {
      onToast("Could not copy meeting link");
    }
  }

  function openCancelDialog(event) {
    setCancelTarget(event);
    const dialog = cancelDialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }

  return (
    <div className="meetings-page page-pad">
      <header className="page-header meeting-page-header">
        <div><span className="eyebrow">LUXSYNCSPACE MEETINGS</span><h1>Meetings</h1><p>Start secure internal calls and manage your scheduled meetings.</p></div>
        <div className="header-actions"><button className="button button-secondary" onClick={onScheduleMeeting}><CalendarClock size={17} /> Schedule meeting</button><button className="button button-primary" onClick={() => setInstantOpen(true)}><Video size={17} /> New instant meeting</button></div>
      </header>
      <section className="meeting-overview">
        <article><span className="metric-icon blue"><Video size={20} /></span><div><b>{upcoming.length}</b><small>Upcoming meetings</small></div></article>
        <article><span className="metric-icon green"><Users size={20} /></span><div><b>{people.length}</b><small>Available employees</small></div></article>
        <button onClick={() => onStartMeeting({ title: `${user.full_name}'s instant meeting`, attendeeIds: [], mode: "video" })}><Plus size={20} /><span><b>Meet now</b><small>Start a private room immediately</small></span></button>
      </section>
      <section className="panel meetings-list-panel">
        <header className="panel-header"><div><h2>Scheduled meetings</h2><p>Internal rooms and invitations from your workspace calendar</p></div></header>
        <div className="meetings-list">
          {scheduled.map((event) => {
            const cancelled = Boolean(event.cancelled_at);
            const ended = Boolean(event.ended_at);
            const isCall = event.meeting_mode === "audio" || (event.title || "").toLowerCase().includes("call") || (event.title || "").includes(" and ");
            const endedLabel = isCall ? "Call Ended" : "Meeting Ended";
            const canCancel = !cancelled && !ended && (event.organizer_id === user.id || ["hr", "senior_leader"].includes(user.role));
            return <article className={cancelled ? "cancelled" : ended ? "ended" : ""} key={event.id}>
              <div className="meeting-date"><b>{format(new Date(event.starts_at), "d")}</b><small>{format(new Date(event.starts_at), "MMM")}</small></div>
              <div className="meeting-list-main">{cancelled ? <span className="meeting-cancelled-chip"><Ban size={13} /> Cancelled</span> : ended ? <span className="meeting-ended-chip"><PhoneOff size={13} /> {endedLabel}</span> : <span className="meeting-mode-chip">{event.meeting_mode === "audio" ? <Mic size={13} /> : <Video size={13} />} {event.meeting_mode === "audio" ? "Voice" : "Video"}</span>}<h3>{event.title}</h3><p><Clock size={14} /> {format(new Date(event.starts_at), "EEE, MMM d · h:mm a")} – {format(new Date(event.ends_at), "h:mm a")}</p>{cancelled && event.cancellation_reason && <p className="cancellation-reason">Reason: {event.cancellation_reason}</p>}<button type="button" className="attendee-stack" onClick={() => setPeopleTarget(event)} aria-label={`View ${event.attendees?.length || 0} invited people`}>{event.attendees?.slice(0, 5).map((person) => <Avatar person={{ initials: person.initials, avatar_color: person.color, full_name: person.name }} size="xxs" key={person.id} />)}<small>{event.attendees?.length || 0} invited · View people</small></button></div>
              <div className="meeting-list-actions">{!cancelled && !ended && <><button className="button button-secondary button-small" onClick={() => copyLink(event)}><Copy size={14} /> Copy link</button><button className="button button-primary button-small" onClick={() => onJoinMeeting(event)}>{event.meeting_mode === "audio" ? <Mic size={14} /> : <Video size={14} />} Join</button></>}{ended && <span className="meeting-status-badge ended"><PhoneOff size={14} /> {endedLabel}</span>}{canCancel && <button type="button" className="button button-danger button-small" onClick={() => openCancelDialog(event)}><Ban size={14} /> Cancel</button>}</div>
            </article>;
          })}
          {!scheduled.length && <div className="empty-state"><CalendarClock size={30} /><h3>No scheduled meetings</h3><p>Schedule a meeting or start an instant room.</p></div>}
        </div>
      </section>
      {instantOpen && <InstantMeeting people={people.filter((person) => person.id !== user.id)} onClose={() => setInstantOpen(false)} onStart={async (details) => { await onStartMeeting(details); setInstantOpen(false); }} />}
      <dialog
        ref={cancelDialogRef}
        className="modal cancel-meeting-dialog"
        aria-labelledby="cancel-meeting-title"
        onMouseDown={(event) => event.target === event.currentTarget && event.currentTarget.close()}
        onClose={() => setCancelTarget(null)}
      >
        {cancelTarget && <CancelMeeting
          key={cancelTarget.id}
          event={cancelTarget}
          onClose={() => cancelDialogRef.current?.close()}
          onConfirm={(reason) => {
            onCancelEvent(cancelTarget, reason);
            cancelDialogRef.current?.close();
          }}
        />}
      </dialog>
      {peopleTarget && <InvitedPeople event={events.find((event) => event.id === peopleTarget.id) || peopleTarget} people={people} canAdd={!peopleTarget.cancelled_at && (peopleTarget.organizer_id === user.id || ["hr", "senior_leader"].includes(user.role))} onClose={() => setPeopleTarget(null)} onAdd={(ids) => onAddAttendees(peopleTarget, ids)} />}
    </div>
  );
}

function InvitedPeople({ event, people, canAdd, onClose, onAdd }) {
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const invitedIds = new Set((event.attendees || []).map((person) => person.id));
  const available = people.filter((person) => !invitedIds.has(person.id) && person.employment_status !== "offboarded" && `${person.full_name} ${person.title || ""} ${person.department || ""}`.toLowerCase().includes(query.toLowerCase()));
  const detailsFor = (attendee) => people.find((person) => person.id === attendee.id) || attendee;
  const toggle = (id) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  async function submit() {
    if (!selected.length) return;
    setBusy(true);
    setError("");
    try {
      await onAdd(selected);
      setSelected([]);
      setQuery("");
      setAdding(false);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return <Modal title="Invited people" subtitle={`${event.title} · ${event.attendees?.length || 0} invited`} onClose={onClose}>
    <div className="invited-people-modal">
      {!adding ? <>
        <div className="invited-people-list">{(event.attendees || []).map((attendee) => {
          const person = detailsFor(attendee);
          return <div key={attendee.id}><Avatar person={{ ...person, full_name: attendee.name || person.full_name, avatar_color: attendee.color || person.avatar_color }} size="sm" /><span><b>{attendee.name || person.full_name}</b><small>{attendee.id === event.organizer_id ? "Organizer" : [person.title, person.department].filter(Boolean).join(" · ") || "Invited"}</small></span><Check size={16} /></div>;
        })}</div>
        {canAdd && <button type="button" className="button button-secondary invited-add-button" onClick={() => setAdding(true)}><UserPlus size={16} /> Add people</button>}
      </> : <>
        <div className="group-members-field invited-add-panel">
          <div className="group-members-label"><span>Add people to this meeting</span><small>{selected.length} selected</small></div>
          <label className="group-member-search"><Search size={16} /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search employees" /></label>
          <div className="group-member-list meeting-attendee-list">{available.map((person) => {
            const isSelected = selected.includes(person.id);
            return <button type="button" className={isSelected ? "selected" : ""} onClick={() => toggle(person.id)} key={person.id}><Avatar person={person} size="xs" /><span><b>{person.full_name}</b><small>{[person.title, person.department].filter(Boolean).join(" · ")}</small></span><i>{isSelected && <Check size={14} />}</i></button>;
          })}{!available.length && <p className="invited-empty">No more employees found.</p>}</div>
          {error && <p className="form-error">{error}</p>}
        </div>
        <footer className="modal-actions"><button type="button" className="button button-secondary" onClick={() => { setAdding(false); setSelected([]); setError(""); }}>Back</button><button type="button" className="button button-primary" disabled={!selected.length || busy} onClick={submit}><UserPlus size={16} /> {busy ? "Adding..." : `Add ${selected.length || ""} ${selected.length === 1 ? "person" : "people"}`}</button></footer>
      </>}
    </div>
  </Modal>;
}

function CancelMeeting({ event, onClose, onConfirm }) {
  const [reason, setReason] = useState("");

  function submit(e) {
    e.preventDefault();
    onConfirm(reason);
  }

  return <>
    <header className="modal-header">
      <div><h2 id="cancel-meeting-title">Cancel event or meeting</h2><p>{event.title}</p></div>
      <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
    </header>
    <form className="cancel-meeting-form" onSubmit={submit}>
      <span className="cancel-meeting-icon"><Ban size={25} /></span>
      <h3>Notify all invited employees?</h3>
      <p>The event will remain in everyone’s calendar marked as cancelled. Invited employees will receive an in-app and push notification.</p>
      <label><span>Cancellation reason (optional)</span><textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="For example: Rescheduled to a later date" /></label>
      <footer className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Keep event</button><button className="button button-danger"><Ban size={16} /> Cancel and notify</button></footer>
    </form>
  </>;
}

function InstantMeeting({ people, onStart, onClose }) {
  const [title, setTitle] = useState("Instant team meeting");
  const [mode, setMode] = useState("video");
  const [attendeeIds, setAttendeeIds] = useState([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const filtered = people.filter((person) => `${person.full_name} ${person.title} ${person.department}`.toLowerCase().includes(query.toLowerCase()));
  const toggle = (id) => setAttendeeIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try { await onStart({ title, mode, attendeeIds }); }
    finally { setBusy(false); }
  }

  return <Modal title="New instant meeting" subtitle="Select employees and share the room immediately" onClose={onClose}>
    <form className="event-form" onSubmit={submit}>
      <label><span>Meeting title</span><input value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
      <div className="meeting-mode-select"><button type="button" className={mode === "video" ? "active" : ""} onClick={() => setMode("video")}><Video size={17} /><span><b>Video meeting</b><small>Camera and microphone</small></span></button><button type="button" className={mode === "audio" ? "active" : ""} onClick={() => setMode("audio")}><Mic size={17} /><span><b>Voice meeting</b><small>Microphone only</small></span></button></div>
      <div className="group-members-field">
        <div className="group-members-label"><span>Share with employees</span><small>{attendeeIds.length} selected</small></div>
        <label className="group-member-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search employees" /></label>
        <div className="group-member-list meeting-attendee-list">{filtered.map((person) => {
          const selected = attendeeIds.includes(person.id);
          return <button type="button" className={selected ? "selected" : ""} onClick={() => toggle(person.id)} key={person.id}><Avatar person={person} size="xs" /><span><b>{person.full_name}</b><small>{person.title} · {person.department}</small></span><i>{selected && <Check size={14} />}</i></button>;
        })}</div>
        <div className="meeting-share-note"><Send size={15} /><span>The meeting link will be sent to each selected employee’s direct chat with a notification.</span></div>
      </div>
      <footer className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{mode === "audio" ? <Mic size={17} /> : <Video size={17} />} {busy ? "Starting…" : "Start and share"}</button></footer>
    </form>
  </Modal>;
}
