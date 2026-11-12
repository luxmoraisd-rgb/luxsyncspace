import { addDays, addWeeks, format, isSameDay, isSameMonth, startOfWeek, subWeeks } from "date-fns";
import { Ban, CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin, Plus, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { eventTime } from "../lib/format";
import { Avatar } from "../components/Avatar";

function layoutDayEvents(events, day, startHour, hoursCount) {
  const rangeStart = startHour * 60;
  const rangeEnd = (startHour + hoursCount) * 60;
  const dayEvents = events
    .filter((event) => isSameDay(new Date(event.starts_at), day))
    .map((event) => {
      const start = new Date(event.starts_at);
      const end = new Date(event.ends_at);
      const startMinute = start.getHours() * 60 + start.getMinutes();
      const durationMinutes = Math.max(30, (end.getTime() - start.getTime()) / 60000);
      return {
        event,
        startMinute: Math.max(rangeStart, startMinute),
        endMinute: Math.min(rangeEnd, startMinute + durationMinutes)
      };
    })
    .filter((item) => item.endMinute > item.startMinute)
    .sort((first, second) => first.startMinute - second.startMinute || second.endMinute - first.endMinute);

  const laidOutEvents = [];
  let cluster = [];
  let clusterEnd = -Infinity;

  function placeCluster() {
    const laneEnds = [];
    for (const item of cluster) {
      let lane = laneEnds.findIndex((end) => end <= item.startMinute);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(item.endMinute);
      } else {
        laneEnds[lane] = item.endMinute;
      }
      item.lane = lane;
    }
    for (const item of cluster) {
      laidOutEvents.push({ ...item, laneCount: laneEnds.length });
    }
    cluster = [];
    clusterEnd = -Infinity;
  }

  for (const item of dayEvents) {
    if (cluster.length && item.startMinute >= clusterEnd) placeCluster();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMinute);
  }
  if (cluster.length) placeCluster();

  return laidOutEvents;
}

export function Calendar({ events, onNewEvent, onJoinMeeting }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [rangeMode, setRangeMode] = useState("all");
  const gridRef = useRef(null);

  const startHour = rangeMode === "work" ? 8 : 0;
  const hoursCount = rangeMode === "work" ? 13 : 24; // 8 AM to 8 PM (work) or 0 to 23 (24h)
  const hours = Array.from({ length: hoursCount }, (_, index) => index + startHour);

  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const weekEnd = days[days.length - 1];
  const weekLabel = isSameMonth(weekStart, weekEnd)
    ? format(weekStart, "MMMM yyyy")
    : `${format(weekStart, "MMM yyyy")} – ${format(weekEnd, "MMM yyyy")}`;
  const upcomingEvents = events
    .filter((event) => new Date(event.ends_at) > new Date())
    .slice(0, 5);

  function showToday() {
    setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));
  }

  useEffect(() => {
    if (gridRef.current) {
      // Auto-scroll so 8 AM (or 1 hour before current time) is in view
      const now = new Date();
      const currentHour = now.getHours();
      const targetHour = rangeMode === "all" ? Math.max(7, Math.min(currentHour - 1, 14)) : 0;
      gridRef.current.scrollTop = targetHour * 64;
    }
  }, [rangeMode, weekStart]);

  function handleSlotClick(day, hour, minute = 0) {
    const start = new Date(day);
    start.setHours(hour, minute, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    onNewEvent({
      startsAt: start.toISOString(),
      endsAt: end.toISOString()
    });
  }

  const now = new Date();
  const nowOffsetMinutes = (now.getHours() - startHour) * 60 + now.getMinutes();
  const nowTop = (nowOffsetMinutes / 60) * 64;
  const isNowInRange = now.getHours() >= startHour && now.getHours() < startHour + hoursCount;

  return (
    <div className="calendar-page page-pad">
      <header className="page-header">
        <div><span className="eyebrow">CALENDAR</span><h1>Your week</h1><p>Plan focused time and stay in sync with your team.</p></div>
        <button className="button button-primary" onClick={() => onNewEvent(true)}><Plus size={18} /> New event</button>
      </header>
      <div className="calendar-layout">
        <section className="calendar-main panel">
          <header className="calendar-toolbar">
            <div>
              <button className="button button-secondary button-small calendar-today" onClick={showToday}>Today</button>
              <button className="icon-button" onClick={() => setWeekStart((current) => subWeeks(current, 1))} aria-label="Previous week" title="Previous week"><ChevronLeft size={19} /></button>
              <button className="icon-button" onClick={() => setWeekStart((current) => addWeeks(current, 1))} aria-label="Next week" title="Next week"><ChevronRight size={19} /></button>
              <h2>{weekLabel}</h2>
            </div>
            <div className="calendar-toolbar-controls">
              <select
                className="calendar-range-select"
                value={rangeMode}
                onChange={(e) => setRangeMode(e.target.value)}
                aria-label="Hours view range"
              >
                <option value="all">24 Hours (Full day)</option>
                <option value="work">Work hours (8 AM – 8 PM)</option>
              </select>
              <div className="view-select">Week</div>
            </div>
          </header>
          <div className="week-grid" ref={gridRef} style={{ "--calendar-hours": hoursCount }}>
            <div className="time-head" />
            {days.map((day) => (
              <div className={`day-head ${isSameDay(day, new Date()) ? "today" : ""}`} key={day.toISOString()}>
                <span>{format(day, "EEE").toUpperCase()}</span>
                <b>{format(day, "d")}</b>
              </div>
            ))}
            <div className="time-column">
              {hours.map((hour) => (
                <span key={hour}>
                  {format(new Date().setHours(hour, 0), "h a")}
                </span>
              ))}
            </div>
            {days.map((day) => (
              <div className={`day-column ${isSameDay(day, new Date()) ? "today-col" : ""}`} key={day.toISOString()}>
                {hours.map((hour) => (
                  <div className="hour-cell" key={hour}>
                    <button
                      type="button"
                      className="slot-half slot-top"
                      onClick={() => handleSlotClick(day, hour, 0)}
                      title={`Schedule at ${format(new Date().setHours(hour, 0), "h:mm a")}`}
                      aria-label={`Schedule at ${format(new Date().setHours(hour, 0), "h:mm a")}`}
                    />
                    <button
                      type="button"
                      className="slot-half slot-bottom"
                      onClick={() => handleSlotClick(day, hour, 30)}
                      title={`Schedule at ${format(new Date().setHours(hour, 30), "h:mm a")}`}
                      aria-label={`Schedule at ${format(new Date().setHours(hour, 30), "h:mm a")}`}
                    />
                  </div>
                ))}
                {isSameDay(day, now) && isNowInRange && (
                  <div className="calendar-now-indicator" style={{ top: `${nowTop}px` }}>
                    <span className="calendar-now-dot" />
                  </div>
                )}
                {layoutDayEvents(events, day, startHour, hoursCount)
                  .map(({ event, startMinute, endMinute, lane, laneCount }) => {
                    const unavailable = Boolean(event.cancelled_at || event.ended_at);
                    const top = ((startMinute - startHour * 60) / 60) * 64;
                    const height = ((endMinute - startMinute) / 60) * 64;
                    return (
                      <button
                        className={`calendar-event ${event.cancelled_at ? "cancelled" : event.ended_at ? "ended" : ""}`}
                        disabled={unavailable}
                        onClick={() => onJoinMeeting(event)}
                        key={event.id}
                        style={{
                          top,
                          height,
                          left: `calc(${(lane * 100) / laneCount}% + 4px)`,
                          width: `calc(${100 / laneCount}% - 8px)`,
                          "--event": event.color
                        }}
                      >
                        <b>{event.cancelled_at ? `Cancelled: ${event.title}` : event.ended_at ? `Ended: ${event.title}` : event.title}</b>
                        <small>{event.cancelled_at ? event.cancellation_reason || "Cancelled by organizer" : event.ended_at ? "Ended by organizer" : eventTime(event.starts_at)}</small>
                      </button>
                    );
                  })}
              </div>
            ))}
          </div>
          <div className="mobile-calendar-days">
            {days.map((day) => {
              const dayEvents = events.filter((event) => isSameDay(new Date(event.starts_at), day));
              return (
                <section className={isSameDay(day, new Date()) ? "today" : ""} key={day.toISOString()}>
                  <header><span>{format(day, "EEE")}</span><b>{format(day, "d")}</b><small>{format(day, "MMMM")}</small></header>
                  <div>
                    {dayEvents.map((event) => (
                      <button
                        className={event.cancelled_at ? "cancelled" : event.ended_at ? "ended" : ""}
                        disabled={Boolean(event.cancelled_at || event.ended_at)}
                        onClick={() => onJoinMeeting(event)}
                        key={event.id}
                        style={{ "--event": event.color }}
                      >
                        <time>{eventTime(event.starts_at)}</time>
                        <span>
                          <b>{event.cancelled_at ? `Cancelled: ${event.title}` : event.ended_at ? `Ended: ${event.title}` : event.title}</b>
                          <small>{event.cancelled_at ? event.cancellation_reason || "Cancelled by organizer" : event.ended_at ? "Ended by organizer" : event.location || (event.is_online ? "LuxSyncspace meeting" : "No location")}</small>
                        </span>
                        {event.cancelled_at || event.ended_at ? <span className="calendar-cancelled-mark">×</span> : event.is_online && <Video size={17} />}
                      </button>
                    ))}
                    {!dayEvents.length && <p>No events scheduled</p>}
                  </div>
                </section>
              );
            })}
          </div>
        </section>
        <aside className="agenda-panel panel">
          <header><span className="metric-icon blue"><CalendarDays size={19} /></span><div><h2>Up next</h2><p>{format(new Date(), "EEEE, MMMM d")}</p></div></header>
          <div className="agenda-list">
            {upcomingEvents.map((event) => {
              const unavailable = Boolean(event.cancelled_at || event.ended_at);
              return (
                <article className={event.cancelled_at ? "cancelled" : event.ended_at ? "ended" : ""} key={event.id} style={{ "--event": event.color }}>
                  <span className="agenda-time">{eventTime(event.starts_at)}</span>
                  <div>
                    {unavailable && <span className="agenda-status"><Ban size={12} /> {event.cancelled_at ? "Cancelled" : "Ended"}</span>}
                    <h3>{event.title}</h3>
                    <p><Clock size={14} /> {eventTime(event.starts_at)} – {eventTime(event.ends_at)}</p>
                    <p><MapPin size={14} /> {event.cancelled_at ? event.cancellation_reason || "Cancelled by organizer" : event.ended_at ? "Ended by organizer" : event.location}</p>
                    <div className="attendee-stack">{event.attendees?.slice(0, 4).map((person) => <Avatar person={{ initials: person.initials, avatar_color: person.color }} size="xxs" key={person.id} />)}<small>{event.attendees?.length || 0} attending</small></div>
                    {event.is_online && !unavailable && <button className="button button-primary button-small" onClick={() => onJoinMeeting(event)}><Video size={15} /> Join meeting</button>}
                  </div>
                </article>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
