import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell, CalendarDays, Check, CheckCheck, ChevronDown, CircleHelp, LayoutDashboard,
  Menu, MessageSquareText, Search, Settings, Users, Video, X
} from "lucide-react";
import { Avatar } from "./Avatar";
import { api } from "../lib/api";

const nav = [
  ["home", "Home", LayoutDashboard],
  ["chat", "Chat", MessageSquareText],
  ["meetings", "Meetings", Video],
  ["calendar", "Calendar", CalendarDays],
  ["people", "People", Users]
];

const availabilityOptions = [
  ["online", "Online"],
  ["break", "On a break"],
  ["lunch", "At lunch"],
  ["unavailable", "Unavailable"],
  ["meeting", "In a meeting"],
  ["offline", "Appear offline"]
];

export function Shell({ user, active, setActive, children, onLogout, onStatusChange, notifications = [], unreadChatCount = 0, onNotificationsRead, onNotificationRead, onNotificationOpen }) {
  const unreadNotificationCount = notifications.filter((item) => item.unread).length;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const searchRef = useRef();
  const searchContainerRef = useRef();
  const notificationsMenuRef = useRef();
  const notificationsBtnRef = useRef();
  const statusMenuRef = useRef();
  const statusBtnRef = useRef();
  const profileMenuRef = useRef();
  const profileBtnRef = useRef();

  useEffect(() => {
    function handleClickOutside(event) {
      if (
        results &&
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target)
      ) {
        setResults(null);
      }
      if (
        notificationsOpen &&
        notificationsMenuRef.current &&
        !notificationsMenuRef.current.contains(event.target) &&
        notificationsBtnRef.current &&
        !notificationsBtnRef.current.contains(event.target)
      ) {
        setNotificationsOpen(false);
      }
      if (
        statusOpen &&
        statusMenuRef.current &&
        !statusMenuRef.current.contains(event.target) &&
        statusBtnRef.current &&
        !statusBtnRef.current.contains(event.target)
      ) {
        setStatusOpen(false);
      }
      if (
        profileOpen &&
        profileMenuRef.current &&
        !profileMenuRef.current.contains(event.target) &&
        profileBtnRef.current &&
        !profileBtnRef.current.contains(event.target)
      ) {
        setProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [notificationsOpen, statusOpen, profileOpen, results]);

  const executeSearch = useCallback((searchTerm) => {
    const q = (searchTerm !== undefined ? searchTerm : query).trim();
    if (!q) {
      setResults(null);
      return;
    }
    api(`/search?q=${encodeURIComponent(q)}`)
      .then((data) => setResults(data || { people: [], channels: [] }))
      .catch(() => setResults({ people: [], channels: [] }));
  }, [query]);

  useEffect(() => {
    if (query.trim().length < 2) { setResults(null); return; }
    const timer = setTimeout(() => executeSearch(query), 250);
    return () => clearTimeout(timer);
  }, [query, executeSearch]);

  useEffect(() => {
    const handle = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault(); searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  function navigate(view, options) {
    setActive(view, options);
    setMobileOpen(false);
    setQuery("");
    setResults(null);
    setNotificationsOpen(false);
    setStatusOpen(false);
  }

  function toggleNotifications() {
    setProfileOpen(false);
    setStatusOpen(false);
    setNotificationsOpen((open) => !open);
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand"><img className="brand-logo-shell" src="/luxmor-logo.jpeg" alt="Luxmor AI Technologies" /><button className="mobile-close" onClick={() => setMobileOpen(false)}><X /></button></div>
        <nav className="primary-nav">
          <span className="nav-label">WORKSPACE</span>
          {nav.map(([id, label, Icon]) => (
            <button className={active === id ? "active" : ""} onClick={() => navigate(id)} key={id}>
              <Icon size={20} strokeWidth={1.8} /><span>{label}</span>{id === "chat" && unreadChatCount > 0 && <b className="nav-badge">{unreadChatCount > 99 ? "99+" : unreadChatCount}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <nav className="secondary-nav">
          <button className={active === "settings" ? "active" : ""} onClick={() => navigate("settings")}><Settings size={19} /><span>Settings</span></button>
          <button className={active === "help" ? "active" : ""} onClick={() => navigate("help")}><CircleHelp size={19} /><span>Help & support</span></button>
        </nav>
        <div className="sidebar-user">
          <Avatar person={user} showPresence />
          <span><b>{user.full_name}</b><small>{user.title}</small></span>
        </div>
      </aside>
      <div className="shell-main">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileOpen(true)}><Menu size={22} /></button>
          <form
            ref={searchContainerRef}
            className="global-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              executeSearch();
            }}
          >
            <Search size={18} />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  executeSearch();
                } else if (e.key === "Escape") {
                  setResults(null);
                }
              }}
              placeholder="Search people, messages, and channels"
            />
            {results && (
              <SearchResults
                results={results}
                onNavigate={(view, opts) => {
                  navigate(view, opts);
                  setResults(null);
                }}
                onClose={() => {
                  setQuery("");
                  setResults(null);
                }}
              />
            )}
          </form>
          <div className="top-actions">
            <button ref={statusBtnRef} className="availability-button" onClick={() => { setNotificationsOpen(false); setProfileOpen(false); setStatusOpen((open) => !open); }} title="Change your status" aria-label="Change your status" aria-expanded={statusOpen}>
              <i className={`availability-dot status-${user.availability_status || user.presence || "offline"}`} /><span>{availabilityOptions.find(([value]) => value === (user.availability_status || user.presence))?.[1] || "Offline"}</span><ChevronDown size={14} />
            </button>
            <button ref={notificationsBtnRef} className="icon-button notification-button" onClick={toggleNotifications} title="Notifications" aria-label="Open notifications" aria-expanded={notificationsOpen}>
              <Bell size={20} />
              {unreadNotificationCount > 0 && (
                <span className="notification-badge">
                  {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                </span>
              )}
            </button>
            <button ref={profileBtnRef} className="top-user" onClick={() => { setNotificationsOpen(false); setStatusOpen(false); setProfileOpen(!profileOpen); }}><Avatar person={user} size="sm" /><ChevronDown size={15} /></button>
          </div>
          {statusOpen && <div ref={statusMenuRef} className="availability-menu">
            <header><b>Set your status</b><small>Let coworkers know when you are available.</small></header>
            {availabilityOptions.map(([value, label]) => <button key={value} onClick={async () => { await onStatusChange?.(value); setStatusOpen(false); }}>
              <i className={`availability-dot status-${value}`} /><span>{label}</span>{(user.availability_status || user.presence) === value && <Check size={15} />}
            </button>)}
          </div>}
          {notificationsOpen && (
            <div ref={notificationsMenuRef} className="notification-menu">
              <header>
                <div>
                  <b>Notifications</b>
                  <small>
                    {unreadNotificationCount > 0
                      ? `${unreadNotificationCount} unread`
                      : notifications.length
                      ? `${notifications.length} recent`
                      : "You’re all caught up"}
                  </small>
                </div>
                {unreadNotificationCount > 0 ? (
                  <button
                    type="button"
                    className="notification-mark-all"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNotificationsRead?.();
                    }}
                    title="Mark all notifications as read"
                  >
                    <CheckCheck size={14} /> Mark all read
                  </button>
                ) : (
                  notifications.length > 0 && (
                    <span className="notification-all-read">
                      <CheckCheck size={14} /> All read
                    </span>
                  )
                )}
              </header>
              <div className="notification-menu-list">
                {notifications.map((item) => (
                  <div
                    key={item.id || item.tag || `${item.receivedAt}-${item.title}`}
                    className={`notification-menu-item ${item.unread ? "unread" : "read"}`}
                    onClick={() => {
                      onNotificationOpen?.(item);
                      setNotificationsOpen(false);
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onNotificationOpen?.(item);
                        setNotificationsOpen(false);
                      }
                    }}
                  >
                    <span className={`notification-menu-icon notification-${item.sound || "message"}`}>
                      <Bell size={16} />
                    </span>
                    <span className="notification-menu-content">
                      <span className="notification-menu-title-row">
                        <b>{item.title}</b>
                        {item.unread && <i className="notification-unread-dot" />}
                      </span>
                      <small>{item.body}</small>
                      <time>
                        {item.receivedAt
                          ? new Date(item.receivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                          : ""}
                      </time>
                    </span>
                    <span className="notification-menu-action">
                      {item.unread ? (
                        <button
                          type="button"
                          className="notification-read-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            onNotificationRead?.(item);
                          }}
                          title="Mark as read"
                          aria-label={`Mark ${item.title} as read`}
                        >
                          <Check size={12} /> Read
                        </button>
                      ) : (
                        <span className="notification-read-status" title="Read">
                          <CheckCheck size={14} />
                        </span>
                      )}
                    </span>
                  </div>
                ))}
                {!notifications.length && (
                  <div className="notification-menu-empty">
                    <Bell size={24} />
                    <b>No notifications yet</b>
                    <p>New messages, meetings, and announcements will appear here.</p>
                  </div>
                )}
              </div>
            </div>
          )}
          {profileOpen && (
            <div ref={profileMenuRef} className="profile-menu">
              <div><Avatar person={user} /><span><b>{user.full_name}</b><small>{user.email}</small></span></div>
              <button className="profile-link" onClick={() => { navigate("settings"); setProfileOpen(false); }}>View profile & settings</button>
              <button onClick={onLogout}>Sign out</button>
            </div>
          )}
        </header>
        <main className="workspace">{children}</main>
        <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
          {[...nav, ["settings", "Settings", Settings]].map(([id, label, Icon]) => (
            <button className={active === id ? "active" : ""} onClick={() => navigate(id)} key={id}><Icon size={20} /><span>{label}</span>{id === "chat" && unreadChatCount > 0 && <b className="mobile-nav-badge">{unreadChatCount > 99 ? "99+" : unreadChatCount}</b>}</button>
          ))}
        </nav>
      </div>
      {mobileOpen && <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}
    </div>
  );
}

function SearchResults({ results, onNavigate, onClose }) {
  const people = results.people || [];
  const channels = results.channels || [];
  const empty = !people.length && !channels.length;
  return (
    <div className="search-results">
      <div className="search-results-head"><span>Search results</span><button type="button" onClick={onClose}><X size={15} /></button></div>
      {empty && <p className="search-empty">No results found. Try another phrase.</p>}
      {!!people.length && <section><small>PEOPLE</small>{people.map((p) => <button type="button" onClick={() => onNavigate("chat", { direct: p.id })} key={p.id}><Avatar person={p} size="xs" /><span><b>{p.full_name}</b><em>{p.title}</em></span></button>)}</section>}
      {!!channels.length && <section><small>CHANNELS</small>{channels.map((c) => <button type="button" onClick={() => onNavigate("chat", { channel: c.id })} key={c.id}><MessageSquareText size={17} /><span><b># {c.name}</b><em>{c.description}</em></span></button>)}</section>}
    </div>
  );
}
