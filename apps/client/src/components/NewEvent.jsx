import { useRef, useState } from "react";
import { CalendarPlus, Check, Clock, MapPin, Search, Send } from "lucide-react";
import { Modal } from "./Modal";
import { Avatar } from "./Avatar";

const HOURS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
const MINUTES_PRESETS = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];

function getMinuteOptions(currentMinute) {
  if (!currentMinute || MINUTES_PRESETS.includes(currentMinute)) {
    return MINUTES_PRESETS;
  }
  return [...MINUTES_PRESETS, currentMinute].sort();
}

function toDateParts(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const dateStr = `${year}-${month}-${day}`;

  const hours24 = d.getHours();
  const rawMinutes = d.getMinutes();
  const period = hours24 >= 12 ? "PM" : "AM";
  let hours12 = hours24 % 12;
  if (hours12 === 0) hours12 = 12;

  const minuteStr = String(rawMinutes).padStart(2, "0");
  const hourStr = String(hours12).padStart(2, "0");

  return { date: dateStr, hour: hourStr, minute: minuteStr, period };
}

function fromDateParts({ date, hour, minute, period }) {
  if (!date) return new Date();
  const [year, month, day] = date.split("-").map(Number);
  let h = Number(hour);
  const m = Number(minute);
  if (period === "PM" && h < 12) h += 12;
  if (period === "AM" && h === 12) h = 0;
  return new Date(year, month - 1, day, h, m, 0);
}

function TimePicker12h({ value, onChange, label }) {
  const minuteOptions = getMinuteOptions(value.minute);

  return (
    <div className="time-picker-12h">
      <div className="time-select-group">
        <Clock size={14} className="time-clock-icon" />
        <select
          className="time-part-select hour-select"
          value={value.hour}
          onChange={(e) => onChange({ ...value, hour: e.target.value })}
          aria-label={`${label} hour`}
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>
        <span className="time-colon">:</span>
        <select
          className="time-part-select minute-select"
          value={value.minute}
          onChange={(e) => onChange({ ...value, minute: e.target.value })}
          aria-label={`${label} minute`}
        >
          {minuteOptions.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
      <div className="ampm-toggle" role="group" aria-label={`${label} AM or PM`}>
        <button
          type="button"
          className={`ampm-btn ${value.period === "AM" ? "active" : ""}`}
          onClick={() => onChange({ ...value, period: "AM" })}
        >
          AM
        </button>
        <button
          type="button"
          className={`ampm-btn ${value.period === "PM" ? "active" : ""}`}
          onClick={() => onChange({ ...value, period: "PM" })}
        >
          PM
        </button>
      </div>
    </div>
  );
}

export function NewEvent({ people, onSave, onClose, initialData }) {
  const getInitialStart = () => {
    if (initialData?.startsAt) return new Date(initialData.startsAt);
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d;
  };

  const getInitialEnd = (startDate) => {
    if (initialData?.endsAt) return new Date(initialData.endsAt);
    return new Date(startDate.getTime() + 60 * 60 * 1000);
  };

  const initStart = getInitialStart();
  const initEnd = getInitialEnd(initStart);

  const [startParts, setStartParts] = useState(() => toDateParts(initStart));
  const [endParts, setEndParts] = useState(() => toDateParts(initEnd));
  const [errorMessage, setErrorMessage] = useState("");

  const [form, setForm] = useState({
    title: "",
    description: "",
    location: "",
    attendeeIds: []
  });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [attendeeQuery, setAttendeeQuery] = useState("");

  const close = () => {
    if (!busyRef.current) onClose();
  };
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const filteredPeople = people.filter((person) =>
    `${person.full_name} ${person.title} ${person.department}`.toLowerCase().includes(attendeeQuery.toLowerCase())
  );
  const toggleAttendee = (personId) =>
    update(
      "attendeeIds",
      form.attendeeIds.includes(personId)
        ? form.attendeeIds.filter((id) => id !== personId)
        : [...form.attendeeIds, personId]
    );

  const handleStartChange = (nextStart) => {
    setStartParts(nextStart);
    setErrorMessage("");
    const newStartDate = fromDateParts(nextStart);
    const currentEndDate = fromDateParts(endParts);
    if (currentEndDate <= newStartDate) {
      const bumpedEnd = new Date(newStartDate.getTime() + 60 * 60 * 1000);
      setEndParts(toDateParts(bumpedEnd));
    } else if (nextStart.date !== startParts.date && startParts.date === endParts.date) {
      setEndParts((prev) => ({ ...prev, date: nextStart.date }));
    }
  };

  const handleEndChange = (nextEnd) => {
    setEndParts(nextEnd);
    setErrorMessage("");
    const currentStartDate = fromDateParts(startParts);
    const newEndDate = fromDateParts(nextEnd);
    if (newEndDate <= currentStartDate) {
      setErrorMessage("End time must be later than start time.");
    }
  };

  async function submit(event) {
    event.preventDefault();
    if (busyRef.current) return;
    const startsDate = fromDateParts(startParts);
    const endsDate = fromDateParts(endParts);

    if (endsDate <= startsDate) {
      setErrorMessage("Event end time must be after start time.");
      return;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      setErrorMessage("");
      await onSave({
        ...form,
        location: form.location.trim() || "LuxSyncspace meeting",
        startsAt: startsDate.toISOString(),
        endsAt: endsDate.toISOString()
      });
    } catch (error) {
      setErrorMessage(error.message || "Unable to schedule this event. Please try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal title="Schedule an event" subtitle="Bring the right people together" onClose={close} className="schedule-event-modal">
      <form className="event-form schedule-event-form" onSubmit={submit}>
        <label>
          <span>Event title</span>
          <input
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            placeholder="e.g. Project kickoff"
            required
          />
        </label>
        <div className="form-grid">
          <div className="datetime-field">
            <span className="datetime-label">Starts</span>
            <div className="datetime-controls">
              <input
                type="date"
                className="datetime-date-input"
                value={startParts.date}
                onChange={(e) => handleStartChange({ ...startParts, date: e.target.value })}
                required
              />
              <TimePicker12h
                label="Starts"
                value={startParts}
                onChange={handleStartChange}
              />
            </div>
          </div>
          <div className="datetime-field">
            <span className="datetime-label">Ends</span>
            <div className="datetime-controls">
              <input
                type="date"
                className="datetime-date-input"
                value={endParts.date}
                min={startParts.date}
                onChange={(e) => handleEndChange({ ...endParts, date: e.target.value })}
                required
              />
              <TimePicker12h
                label="Ends"
                value={endParts}
                onChange={handleEndChange}
              />
            </div>
          </div>
        </div>
        {errorMessage && <p className="event-form-error">{errorMessage}</p>}
        <label>
          <span>Location</span>
          <div className="input-icon">
            <MapPin size={17} />
            <input
              value={form.location}
              onChange={(e) => update("location", e.target.value)}
              placeholder="Event location"
            />
          </div>
        </label>
        <div className="group-members-field">
          <div className="group-members-label">
            <span>Invite employees</span>
            <small>{form.attendeeIds.length} selected</small>
          </div>
          <label className="group-member-search">
            <Search size={16} />
            <input
              value={attendeeQuery}
              onChange={(event) => setAttendeeQuery(event.target.value)}
              placeholder="Search employees"
            />
          </label>
          <div className="group-member-list meeting-attendee-list">
            {filteredPeople.map((person) => {
              const selected = form.attendeeIds.includes(person.id);
              return (
                <button
                  type="button"
                  className={selected ? "selected" : ""}
                  onClick={() => toggleAttendee(person.id)}
                  key={person.id}
                >
                  <Avatar person={person} size="xs" />
                  <span>
                    <b>{person.full_name}</b>
                    <small>{person.title} · {person.department}</small>
                  </span>
                  <i>{selected && <Check size={14} />}</i>
                </button>
              );
            })}
          </div>
          <div className="meeting-share-note">
            <Send size={15} />
            <span>Selected employees receive the meeting link in direct chat and as a notification.</span>
          </div>
        </div>
        <label>
          <span>Notes</span>
          <textarea
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder="Add an agenda or context…"
          />
        </label>
        <footer className="modal-actions">
          <button type="button" className="button button-secondary" onClick={close} disabled={busy}>Cancel</button>
          <button className="button button-primary" disabled={busy}>
            <CalendarPlus size={17} /> {busy ? "Scheduling…" : "Schedule event"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
