import { useState } from "react";
import { Check, Lock, Search, Users } from "lucide-react";
import { Modal } from "./Modal";

function toChannelName(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function CreateGroup({ people, onCreate, onClose }) {
  const [form, setForm] = useState({ name: "", description: "", memberIds: [], isPrivate: false });
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const filteredPeople = people.filter((person) => `${person.full_name} ${person.title} ${person.department}`.toLowerCase().includes(search.toLowerCase()));
  const allFilteredSelected = filteredPeople.length > 0 && filteredPeople.every((person) => form.memberIds.includes(person.id));
  const toggleMember = (personId) => update("memberIds", form.memberIds.includes(personId) ? form.memberIds.filter((id) => id !== personId) : [...form.memberIds, personId]);
  function toggleFilteredPeople() {
    const filteredIds = new Set(filteredPeople.map((person) => person.id));
    setForm((current) => {
      const allSelected = filteredIds.size > 0 && [...filteredIds].every((id) => current.memberIds.includes(id));
      return {
        ...current,
        memberIds: allSelected
          ? current.memberIds.filter((id) => !filteredIds.has(id))
          : [...new Set([...current.memberIds, ...filteredIds])]
      };
    });
  }
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try { await onCreate({ ...form, name: toChannelName(form.name) }); }
    finally { setBusy(false); }
  }
  return (
    <Modal title="Create a group" subtitle="Bring a project, department, or working team together" onClose={onClose} closeOnBackdrop={false}>
      <form className="event-form" onSubmit={submit}>
        <label><span>Group name</span><input value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="e.g. Mobile engineering" maxLength={60} required /></label>
        <label className="group-description-field">
          <span>Description</span>
          <textarea value={form.description} onChange={(e) => update("description", e.target.value)} placeholder="What will this group work on?" maxLength={500} />
          <small className="group-description-counter" aria-live="polite">{form.description.length}/500</small>
        </label>
        <div className="group-members-field">
          <div className="group-members-label">
            <span>Add employees</span>
            <div className="group-members-selection">
              <button type="button" onClick={toggleFilteredPeople} disabled={!filteredPeople.length}>
                {allFilteredSelected ? "Deselect all" : "Select all"}
              </button>
              <small>{form.memberIds.length} selected</small>
            </div>
          </div>
          <label className="group-member-search"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search employees by name, role, or department" /></label>
          <div className="group-member-list">
            {filteredPeople.map((person) => {
              const checked = form.memberIds.includes(person.id);
              return <button type="button" className={checked ? "selected" : ""} onClick={() => toggleMember(person.id)} key={person.id}>
                <span className="group-person-avatar" style={{ "--person-color": person.avatar_color }}>{person.initials}</span>
                <span><b>{person.full_name}</b><small>{person.title} · {person.department}</small></span>
                <i>{checked && <Check size={14} />}</i>
              </button>;
            })}
            {!filteredPeople.length && <p className="group-no-results">No employees match your search.</p>}
          </div>
        </div>
        <button type="button" className={`private-group-toggle ${form.isPrivate ? "active" : ""}`} onClick={() => update("isPrivate", !form.isPrivate)}>
          <i>{form.isPrivate && <Check size={13} />}</i>
          <Lock size={18} />
          <span><b>Private group</b><small>Only invited employees can find and access this group.</small></span>
        </button>
        <footer className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}><Users size={17} /> {busy ? "Creating…" : "Create group"}</button></footer>
      </form>
    </Modal>
  );
}
