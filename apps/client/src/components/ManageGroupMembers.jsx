import { useMemo, useState } from "react";
import { Search, UserMinus, UserPlus, Users } from "lucide-react";
import { Avatar } from "./Avatar";
import { Modal } from "./Modal";

export function ManageGroupMembers({ channel, people, members, currentUserId, canManage = true, onSave, onClose }) {
  const initialIds = useMemo(() => members.map((person) => person.id), [members]);
  const [memberIds, setMemberIds] = useState(initialIds);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const filtered = useMemo(() => (canManage ? people : members).filter((person) =>
    `${person.full_name} ${person.title} ${person.department} ${person.employee_id}`.toLowerCase().includes(query.toLowerCase())
  ), [canManage, members, people, query]);
  const addedCount = memberIds.filter((id) => !initialIds.includes(id)).length;
  const removedCount = initialIds.filter((id) => !memberIds.includes(id)).length;

  function toggle(personId) {
    if (personId === currentUserId) return;
    setMemberIds((current) => current.includes(personId)
      ? current.filter((id) => id !== personId)
      : [...current, personId]);
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try { await onSave(memberIds); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      title={canManage ? "Manage group members" : "Group members"}
      subtitle={canManage ? `Add or remove employees from #${channel.name}` : `Members of #${channel.name}`}
      onClose={onClose}
      className="group-members-modal"
    >
      <form className="event-form" onSubmit={submit}>
        <div className="group-members-field">
          <div className="group-members-label"><span>{canManage ? "Employees" : "Group members"}</span><small>{canManage ? memberIds.length : members.length} members</small></div>
          {canManage && <div className="member-change-summary">
            <span><UserPlus size={14} /> {addedCount} to add</span>
            <span><UserMinus size={14} /> {removedCount} to remove</span>
          </div>}
          <label className="group-member-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search employees" /></label>
          <div className="group-member-list member-manager-list">
            {filtered.map((person) => {
              const checked = canManage ? memberIds.includes(person.id) : true;
              const isSelf = person.id === currentUserId;
              return <button type="button" className={checked ? "selected" : ""} disabled={!canManage || isSelf} onClick={() => toggle(person.id)} key={person.id}>
                <Avatar person={person} size="xs" />
                <span><b>{person.full_name}</b><small>{person.title} · {person.department}{isSelf ? " · You" : ""}</small></span>
                <em className={`member-action ${!canManage || isSelf ? "required" : checked ? "remove" : "add"}`}>
                  {!canManage ? "Member" : isSelf ? "Required" : checked ? <><UserMinus size={14} /> Remove</> : <><UserPlus size={14} /> Add</>}
                </em>
              </button>;
            })}
            {!filtered.length && <p className="group-no-results">No matching employees found.</p>}
          </div>
        </div>
        <footer className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>Cancel</button>
          {canManage && <button className="button button-primary" disabled={busy || (!addedCount && !removedCount)}><Users size={17} /> {busy ? "Saving…" : `Apply changes${addedCount || removedCount ? ` (${addedCount + removedCount})` : ""}`}</button>}
        </footer>
      </form>
    </Modal>
  );
}
