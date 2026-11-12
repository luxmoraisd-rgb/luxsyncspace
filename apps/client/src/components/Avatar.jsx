export function Avatar({ person, size = "md", showPresence = false }) {
  const name = person?.full_name || person?.sender_name;
  const initials = name?.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()
    || person?.initials || person?.sender_initials || "?";
  const color = person?.avatar_color || person?.sender_color || "#596579";
  const status = person?.availability_status || person?.presence;
  const statusLabel = { online: "Online", break: "On a break", lunch: "At lunch", unavailable: "Unavailable", meeting: "In a meeting", busy: "Busy", away: "Away", offline: "Offline" }[status];
  return (
    <span className={`avatar avatar-${size}`} style={{ "--avatar": color }} aria-label={person?.full_name || person?.sender_name}>
      {initials}
      {showPresence && status && <i className={`presence presence-${status}`} title={statusLabel} aria-label={statusLabel} />}
    </span>
  );
}
