import { useState } from "react";
import { ArrowRight, Ban, CalendarPlus, ChevronRight, Hash, Megaphone, MessageSquareText, Pencil, PhoneOff, Plus, Sparkles, Trash2, Users, Video } from "lucide-react";
import { Avatar } from "../components/Avatar";
import { CreateAnnouncement } from "../components/CreateAnnouncement";
import { Modal } from "../components/Modal";
import { api } from "../lib/api";
import { dateHeading, eventTime } from "../lib/format";

export function Home({ user, data, navigate, onNewEvent, onRefresh, onToast, onJoinMeeting, onStartMeeting }) {
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState(null);
  const [deletingAnnouncement, setDeletingAnnouncement] = useState(null);
  const [isDeletingAnnouncement, setIsDeletingAnnouncement] = useState(false);
  const [showAllAnnouncements, setShowAllAnnouncements] = useState(false);
  const announcements = data.announcements || [];
  const now = new Date();
  const upcomingEventCount = (data.events || []).filter((event) =>
    !event.cancelled_at && !event.ended_at && new Date(event.starts_at) >= now
  ).length;
  const nextEvents = (data.events || []).filter((event) => !event.cancelled_at && !event.ended_at).slice(0, 4);
  const online = data.people.filter((p) => p.presence === "online");
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const canAnnounce = ["hr", "senior_leader"].includes(user.role);

  async function publishAnnouncement(announcement) {
    try {
      await api("/announcements", { method: "POST", body: JSON.stringify(announcement) });
      await onRefresh();
      setAnnouncementOpen(false);
      onToast("Company announcement published");
    } catch (error) { onToast(error.message); }
  }

  async function updateAnnouncement(changes) {
    try {
      await api(`/announcements/${editingAnnouncement.id}`, { method: "PATCH", body: JSON.stringify(changes) });
      await onRefresh();
      setEditingAnnouncement(null);
      onToast("Company announcement updated");
    } catch (error) { onToast(error.message); }
  }

  async function deleteAnnouncement(announcement) {
    setIsDeletingAnnouncement(true);
    try {
      await api(`/announcements/${announcement.id}`, { method: "DELETE" });
      await onRefresh();
      if (announcements.length <= 4) setShowAllAnnouncements(false);
      setDeletingAnnouncement(null);
      onToast("Company announcement deleted");
    } catch (error) { onToast(error.message); }
    finally { setIsDeletingAnnouncement(false); }
  }

  return (
    <div className="home-page page-pad">
      <header className="welcome-header">
        <div><span className="eyebrow">{dateHeading(new Date()).toUpperCase()}</span><h1>{greeting}, {user.full_name.split(" ")[0]}.</h1><p>Here’s what needs your attention today.</p></div>
        <div className="header-actions"><button className="button button-secondary" onClick={onNewEvent}><CalendarPlus size={17} /> Schedule</button><button className="button button-secondary" onClick={() => onStartMeeting()}><Video size={17} /> Meet now</button><button className="button button-primary" onClick={() => navigate("chat")}><MessageSquareText size={18} /> Open chat</button></div>
      </header>
      <section className="metrics-grid">
        <button className="metric-card" onClick={() => navigate("calendar")}><span className="metric-icon purple"><CalendarPlus size={20} /></span><span><b>{upcomingEventCount}</b><small>Events coming up</small></span><ChevronRight size={18} /></button>
        <button className="metric-card" onClick={() => navigate("chat")}><span className="metric-icon green"><MessageSquareText size={20} /></span><span><b>{data.channels.length}</b><small>Active channels</small></span><ChevronRight size={18} /></button>
        <button className="metric-card" onClick={() => navigate("people")}><span className="metric-icon orange"><Users size={20} /></span><span><b>{online.length}</b><small>Colleagues online</small></span><ChevronRight size={18} /></button>
      </section>
      <div className="home-columns">
        <section className="panel priority-panel">
          <header className="panel-header"><div><h2>Team channels</h2><p>Continue the conversations your team is working on</p></div><button className="link-button" onClick={() => navigate("chat")}>Open chat <ArrowRight size={15} /></button></header>
          <div className="priority-list channel-home-list">
            {data.channels.map((channel, index) => (
              <button key={channel.id} onClick={() => navigate("chat", { channel: channel.id })}>
                <span className={`metric-icon ${index % 2 ? "purple" : "blue"}`}><Hash size={19} /></span>
                <span className="channel-summary"><b>#{channel.name}</b><strong>{channel.description}</strong><small>{channel.message_count} messages in this channel</small></span>
                <ChevronRight size={17} />
              </button>
            ))}
          </div>
        </section>
        <section className="panel schedule-panel">
          <header className="panel-header"><div><h2>Today’s schedule</h2><p>{dateHeading(new Date())}</p></div><button className="icon-button" onClick={onNewEvent}><Plus size={19} /></button></header>
          <div className="schedule-list">
            {nextEvents.map((event) => {
              const isCall = event.meeting_mode === "audio" || (event.title || "").toLowerCase().includes("call") || (event.title || "").includes(" and ");
              const endedLabel = isCall ? "Call Ended" : "Meeting Ended";
              return (
                <div className="schedule-item" key={event.id} style={{ "--event": event.color }}>
                  <time>{eventTime(event.starts_at)}</time>
                  <span><b>{event.title}</b><small>{event.location}</small></span>
                  {event.is_online && !event.ended_at && !event.cancelled_at && <button className="join-button" onClick={() => onJoinMeeting(event)}><Video size={14} /> Join</button>}
                  {event.ended_at && <span className="meeting-ended-chip"><PhoneOff size={11} /> {endedLabel}</span>}

                </div>
              );
            })}
            {!nextEvents.length && <div className="empty-compact"><Sparkles size={20} /><span>Your calendar is clear.</span></div>}
          </div>
          <button className="full-link" onClick={() => navigate("calendar")}>Open calendar <ArrowRight size={15} /></button>
        </section>
      </div>
      <section className="panel announcements-panel">
        <header className="panel-header">
          <div><h2>Company announcements ({announcements.length})</h2><p>Official updates from leadership and People Operations</p></div>
          <div className="announcement-header-actions">
            {announcements.length > 3 && <button className="link-button announcement-toggle" aria-expanded={showAllAnnouncements} aria-controls="home-announcements-list" onClick={() => setShowAllAnnouncements((expanded) => !expanded)}>{showAllAnnouncements ? "View Less" : "View All"}</button>}
            {canAnnounce && <button className="button button-secondary button-small" onClick={() => setAnnouncementOpen(true)}><Megaphone size={15} /> New announcement</button>}
          </div>
        </header>
        <div id="home-announcements-list" className={`announcements-list${showAllAnnouncements ? " expanded" : ""}`}>
          {(showAllAnnouncements ? announcements : announcements.slice(0, 3)).map((announcement) => (
            <article key={announcement.id} className={announcement.priority === "important" ? "important" : ""}>
              <span className="announcement-icon"><Megaphone size={18} /></span>
              <div className="announcement-content">
                <span><b>{announcement.title}</b>{announcement.priority === "important" && <em>IMPORTANT</em>}</span>
                <p>{announcement.body}</p>
                <small>{announcement.author_name} · {new Date(announcement.published_at).toLocaleDateString()}</small>
              </div>
              {canAnnounce && <div className="announcement-card-actions">
                <button className="icon-button" title="Edit announcement" aria-label={`Edit ${announcement.title}`} onClick={() => setEditingAnnouncement(announcement)}><Pencil size={14} /></button>
                <button className="icon-button danger" title="Delete announcement" aria-label={`Delete ${announcement.title}`} onClick={() => setDeletingAnnouncement(announcement)}><Trash2 size={14} /></button>
              </div>}
            </article>
          ))}
        </div>
      </section>
      <section className="panel team-pulse">
        <header className="panel-header"><div><h2>Team pulse</h2><p>People available right now</p></div><button className="link-button" onClick={() => navigate("people")}>View directory <ArrowRight size={15} /></button></header>
        <div className="people-strip">
          {online.slice(0, 5).map((person) => <button key={person.id} onClick={() => navigate("people")}><Avatar person={person} size="lg" showPresence /><span><b>{person.full_name}</b><small>{person.title}</small></span></button>)}
        </div>
      </section>
      {announcementOpen && <CreateAnnouncement onCreate={publishAnnouncement} onClose={() => setAnnouncementOpen(false)} />}
      {editingAnnouncement && <CreateAnnouncement announcement={editingAnnouncement} onUpdate={updateAnnouncement} onClose={() => setEditingAnnouncement(null)} />}
      {deletingAnnouncement && <Modal title="Delete Announcement?" onClose={() => !isDeletingAnnouncement && setDeletingAnnouncement(null)}>
        <div className="delete-confirm announcement-delete-confirm">
          <span><Trash2 size={22} /></span>
          <p>Are you sure you want to delete this announcement?</p>
          <div className="modal-actions">
            <button className="button button-secondary" onClick={() => setDeletingAnnouncement(null)} disabled={isDeletingAnnouncement}>Cancel</button>
            <button className="button button-danger" onClick={() => deleteAnnouncement(deletingAnnouncement)} disabled={isDeletingAnnouncement}>Delete</button>
          </div>
        </div>
      </Modal>}
    </div>
  );
}
