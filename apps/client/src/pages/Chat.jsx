import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bell, BriefcaseBusiness, Check, CheckCheck, ChevronDown, ChevronRight, Download, FileText, Forward, Hash, Info, Lock, MapPin, MessageSquareText, MoreHorizontal, Paperclip, Pencil, Phone, Plus, Reply, Search, Send, Smile, Trash2, UserPlus, Users, Video, X } from "lucide-react";
import { io } from "socket.io-client";
import { api, apiUrl, authStore, SOCKET_URL, socketOptions } from "../lib/api";
import { Avatar } from "../components/Avatar";
import { CreateGroup } from "../components/CreateGroup";
import { ManageGroupMembers } from "../components/ManageGroupMembers";
import { Modal } from "../components/Modal";
import { eventTime } from "../lib/format";

const EMOJIS = ["😀", "😃", "😊", "😂", "😍", "🥳", "😎", "🤔", "👍", "👏", "🙌", "🙏", "💪", "✅", "🎉", "🔥", "⭐", "💡", "❤️", "🚀", "📌", "📅", "💼", "👋"];
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const ACCEPTED_FILES = ".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.csv,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx";

export function Chat({ user, channels, people, directUnreadCounts = {}, onConversationRead, onRefresh, onToast, initialChannelId, onStartCall }) {
  const [selected, setSelected] = useState(() => channels.some((channel) => channel.id === initialChannelId) ? initialChannelId : null);
  const [selectedPerson, setSelectedPerson] = useState(() => people.find((person) => person.id === new URLSearchParams(window.location.search).get("direct")) || null);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachment, setAttachment] = useState(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [createGroup, setCreateGroup] = useState(false);
  const [manageMembers, setManageMembers] = useState(false);
  const [channelMembers, setChannelMembers] = useState([]);
  const [channelMuted, setChannelMutedState] = useState(() => channels.find((channel) => channel.id === initialChannelId)?.muted || false);
  const [messageSearchOpen, setMessageSearchOpen] = useState(false);
  const [messageSearch, setMessageSearch] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [deleteGroupOpen, setDeleteGroupOpen] = useState(false);
  const [messageMenuId, setMessageMenuId] = useState(null);
  const [reactionMessageId, setReactionMessageId] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [forwardingMessage, setForwardingMessage] = useState(null);
  const endRef = useRef();
  const textareaRef = useRef();
  const fileInputRef = useRef();
  const socketRef = useRef();
  const selectedPersonRef = useRef(null);
  const selectedChannelRef = useRef(null);
  const activeChannel = channels.find((channel) => channel.id === selected);
  const canCreateGroup = Boolean(user?.id);
  const canManageGroup = activeChannel?.created_by === user.id || ["hr", "senior_leader", "manager", "team_lead"].includes(user.role);

  function openChannel(channelId) {
    setSelected(channelId);
    setSelectedPerson(null);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "chat");
    url.searchParams.set("channel", channelId);
    url.searchParams.delete("direct");
    window.history.pushState({ luxsyncspace: true, view: "chat", conversation: "channel" }, "", url);
  }

  function openPerson(person) {
    setSelected(null);
    setSelectedPerson(person);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "chat");
    url.searchParams.set("direct", person.id);
    url.searchParams.delete("channel");
    window.history.pushState({ luxsyncspace: true, view: "chat", conversation: "direct" }, "", url);
  }

  function closeConversation(useHistory = true) {
    const params = new URLSearchParams(window.location.search);
    if (useHistory && (params.has("channel") || params.has("direct"))) return window.history.back();
    setSelected(null);
    setSelectedPerson(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("channel");
    url.searchParams.delete("direct");
    window.history.replaceState({ luxsyncspace: true, view: "chat" }, "", url);
  }
  const filteredPeople = useMemo(() => people.filter((person) =>
    `${person.full_name} ${person.title} ${person.department} ${person.employee_id}`.toLowerCase().includes(query.toLowerCase())
  ), [people, query]);
  const visibleMessages = useMemo(() => {
    const term = messageSearch.trim().toLowerCase();
    if (!term) return messages;
    return messages.filter((item) => `${item.sender_name} ${item.body} ${item.file_name || ""}`.toLowerCase().includes(term));
  }, [messages, messageSearch]);

  useEffect(() => {
    setChannelMutedState(channels.find((channel) => channel.id === selected)?.muted || false);
    setMessageSearch("");
    setMessageSearchOpen(false);
    setMoreOpen(false);
    setMessageMenuId(null);
    setReactionMessageId(null);
    setReplyingTo(null);
    setEditingMessage(null);
  }, [selected, selectedPerson?.id]);

  useEffect(() => {
    if (selected) setChannelMutedState(Boolean(activeChannel?.muted));
  }, [activeChannel?.muted]);

  useEffect(() => {
    socketRef.current = io(SOCKET_URL, socketOptions());
    socketRef.current.on("channel:message", (incoming) => {
      if (selectedChannelRef.current !== incoming.channel_id) return;
      setMessages((current) => current.some((item) => item.id === incoming.id) ? current : [...current, incoming]);
      if (document.visibilityState === "visible") {
        api(`/channels/${incoming.channel_id}/read`, { method: "POST" })
          .then(() => onConversationRead?.("channel", incoming.channel_id))
          .catch(() => {});
      }
    });
    socketRef.current.on("channel:read", (receipt) => {
      if (selectedChannelRef.current !== receipt.channelId || !receipt.seenMessageIds?.length) return;
      const seenIds = new Set(receipt.seenMessageIds);
      setMessages((current) => current.map((item) => seenIds.has(item.id) ? { ...item, seen_by_all: true } : item));
    });
    socketRef.current.on("channel:message-deleted", (deleted) => {
      if (selectedChannelRef.current !== deleted.channelId) return;
      setMessages((current) => current.map((item) => {
        if (item.id === deleted.id) return {
          ...item,
          body: "",
          attachment_id: null,
          deleted_at: deleted.deleted_at,
          reactions: []
        };
        return item.reply_to_id === deleted.id ? { ...item, reply_deleted_at: deleted.deleted_at } : item;
      }));
    });
    socketRef.current.on("channel:message-edited", (updated) => {
      if (selectedChannelRef.current !== updated.channelId) return;
      setMessages((current) => current.map((item) => item.id === updated.id ? { ...item, body: updated.body, edited_at: updated.edited_at } : item));
    });
    socketRef.current.on("channel:message-reaction", (update) => {
      if (selectedChannelRef.current !== update.channelId) return;
      setMessages((current) => current.map((item) => {
        if (item.id !== update.id) return item;
        const previous = new Map((item.reactions || []).map((reaction) => [reaction.emoji, reaction]));
        return {
          ...item,
          reactions: update.reactions.map((reaction) => ({
            ...reaction,
            reacted_by_me: update.actorId === user.id
              ? reaction.emoji === update.userEmoji
              : Boolean(previous.get(reaction.emoji)?.reacted_by_me)
          }))
        };
      }));
    });
    socketRef.current.on("direct:message", (incoming) => {
      if (selectedPersonRef.current?.id !== incoming.sender_id) return;
      setMessages((current) => current.some((item) => item.id === incoming.id) ? current : [...current, incoming]);
      if (document.visibilityState === "visible") {
        api(`/direct/${incoming.sender_id}/read`, { method: "POST" })
          .then(() => onConversationRead?.("direct", incoming.sender_id))
          .catch(() => {});
      }
    });
    socketRef.current.on("direct:message-edited", (updated) => {
      if (!selectedPersonRef.current || ![updated.sender_id, updated.recipient_id].includes(selectedPersonRef.current.id)) return;
      setMessages((current) => current.map((item) => item.id === updated.id ? { ...item, body: updated.body, edited_at: updated.edited_at } : item));
    });
    socketRef.current.on("direct:message-deleted", (deleted) => {
      if (!selectedPersonRef.current || ![deleted.sender_id, deleted.recipient_id].includes(selectedPersonRef.current.id)) return;
      setMessages((current) => current.map((item) => {
        if (item.id === deleted.id) return { ...item, body: "", attachment_id: null, deleted_at: deleted.deleted_at, reactions: [] };
        return item.reply_to_id === deleted.id ? { ...item, reply_deleted_at: deleted.deleted_at } : item;
      }));
    });
    socketRef.current.on("direct:message-reaction", (update) => {
      if (!selectedPersonRef.current || ![update.sender_id, update.recipient_id].includes(selectedPersonRef.current.id)) return;
      setMessages((current) => current.map((item) => {
        if (item.id !== update.id) return item;
        const previous = new Map((item.reactions || []).map((reaction) => [reaction.emoji, reaction]));
        return { ...item, reactions: update.reactions.map((reaction) => ({
          ...reaction,
          reacted_by_me: update.actorId === user.id ? reaction.emoji === update.userEmoji : Boolean(previous.get(reaction.emoji)?.reacted_by_me)
        })) };
      }));
    });
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => { selectedPersonRef.current = selectedPerson; }, [selectedPerson]);
  useEffect(() => { selectedChannelRef.current = selected; }, [selected]);

  useEffect(() => {
    const syncConversation = () => {
      const params = new URLSearchParams(window.location.search);
      const channelId = params.get("channel");
      const personId = params.get("direct");
      setSelected(channels.some((channel) => channel.id === channelId) ? channelId : null);
      setSelectedPerson(people.find((person) => person.id === personId) || null);
    };
    window.addEventListener("popstate", syncConversation);
    return () => window.removeEventListener("popstate", syncConversation);
  }, [channels, people]);

  useEffect(() => {
    const markReadWhenVisible = () => {
      if (document.visibilityState === "visible" && selectedChannelRef.current) {
        api(`/channels/${selectedChannelRef.current}/read`, { method: "POST" })
          .then(() => onConversationRead?.("channel", selectedChannelRef.current))
          .catch(() => {});
      }
      if (document.visibilityState === "visible" && selectedPersonRef.current) {
        api(`/direct/${selectedPersonRef.current.id}/read`, { method: "POST" })
          .then(() => onConversationRead?.("direct", selectedPersonRef.current.id))
          .catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", markReadWhenVisible);
    window.addEventListener("focus", markReadWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", markReadWhenVisible);
      window.removeEventListener("focus", markReadWhenVisible);
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    setMessages([]);
    Promise.all([api(`/channels/${selected}/messages`), api(`/channels/${selected}/members`)])
      .then(([conversation, membership]) => { setMessages(conversation.messages); setChannelMembers(membership.members); onConversationRead?.("channel", selected); })
      .catch((error) => onToast(error.message));
    socketRef.current?.emit("channel:join", selected);
    return () => {
      socketRef.current?.emit("channel:leave", selected);
    };
  }, [selected]);

  useEffect(() => {
    if (!selectedPerson) return;
    setMessages([]);
    api(`/direct/${selectedPerson.id}`).then(({ messages }) => { setMessages(messages); onConversationRead?.("direct", selectedPerson.id); }).catch((error) => onToast(error.message));
  }, [selectedPerson]);

  useEffect(() => {
    const compact = window.matchMedia("(max-width: 700px)").matches;
    endRef.current?.scrollIntoView({ behavior: compact ? "auto" : "smooth" });
  }, [messages]);

  async function send(event) {
    event.preventDefault();
    if ((!message.trim() && !attachment) || (!selected && !selectedPerson)) return;
    setBusy(true);
    const body = message;
    const selectedAttachment = attachment;
    const selectedReply = replyingTo;
    const selectedEdit = editingMessage;
    setMessage("");
    setAttachment(null);
    setReplyingTo(null);
    setEditingMessage(null);
    setEmojiOpen(false);
    try {
      if (selectedEdit) {
        const endpoint = selectedPerson ? `/direct/${selectedPerson.id}/messages/${selectedEdit.id}` : `/channels/${selected}/messages/${selectedEdit.id}`;
        const updated = await api(endpoint, { method: "PATCH", body: JSON.stringify({ body }) });
        setMessages((current) => current.map((item) => item.id === updated.id ? { ...item, body: updated.body, edited_at: updated.edited_at } : item));
        onToast("Message edited");
      } else {
        const endpoint = selectedPerson ? `/direct/${selectedPerson.id}` : `/channels/${selected}/messages`;
        const sent = await api(endpoint, {
          method: "POST",
          body: JSON.stringify({ body, attachmentId: selectedAttachment?.id || null, replyTo: selectedReply?.id || null })
        });
        setMessages((current) => current.some((item) => item.id === sent.id) ? current : [...current, sent]);
      }
    } catch (error) {
      setMessage(body);
      setAttachment(selectedAttachment);
      setReplyingTo(selectedReply);
      setEditingMessage(selectedEdit);
      onToast(error.message);
    }
    finally { setBusy(false); }
  }

  function replyToMessage(item) {
    setReplyingTo(item);
    setMessageMenuId(null);
    setReactionMessageId(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function editMessage(item) {
    setEditingMessage(item);
    setMessage(item.body);
    setAttachment(null);
    setReplyingTo(null);
    setMessageMenuId(null);
    setReactionMessageId(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  async function reactToMessage(item, emoji) {
    try {
      const endpoint = selectedPerson ? `/direct/${selectedPerson.id}/messages/${item.id}/reactions` : `/channels/${selected}/messages/${item.id}/reactions`;
      const result = await api(endpoint, {
        method: "POST",
        body: JSON.stringify({ emoji })
      });
      setMessages((current) => current.map((messageItem) => messageItem.id === item.id ? {
        ...messageItem,
        reactions: result.reactions
      } : messageItem));
      setReactionMessageId(null);
      setMessageMenuId(null);
    } catch (error) { onToast(error.message); }
  }

  async function deleteMessage(item, scope) {
    try {
      const endpoint = selectedPerson ? `/direct/${selectedPerson.id}/messages/${item.id}` : `/channels/${selected}/messages/${item.id}`;
      const result = await api(`${endpoint}?scope=${scope}`, { method: "DELETE" });
      if (scope === "me") {
        setMessages((current) => current.filter((messageItem) => messageItem.id !== item.id));
      } else {
        setMessages((current) => current.map((messageItem) => {
          if (messageItem.id === item.id) return {
            ...messageItem,
            body: "",
            attachment_id: null,
            deleted_at: result.deleted_at,
            reactions: []
          };
          return messageItem.reply_to_id === item.id ? { ...messageItem, reply_deleted_at: result.deleted_at } : messageItem;
        }));
      }
      setMessageMenuId(null);
      setReactionMessageId(null);
      onToast(scope === "me" ? "Message deleted for you" : "Message deleted for everyone");
    } catch (error) { onToast(error.message); }
  }

  async function forwardMessage(targetType, targetId) {
    if (!forwardingMessage) return;
    try {
      if (targetType === "channel") {
        await api(`/channels/${targetId}/messages`, {
          method: "POST",
          body: JSON.stringify({ body: forwardingMessage.body, forwardedFrom: forwardingMessage.id })
        });
      } else {
        await api(`/direct/${targetId}`, {
          method: "POST",
          body: JSON.stringify({ body: `Forwarded from ${forwardingMessage.sender_name}\n${forwardingMessage.body}` })
        });
      }
      setForwardingMessage(null);
      onToast("Message forwarded");
    } catch (error) { onToast(error.message); }
  }

  async function uploadAttachment(file) {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) return onToast("Files must be 8 MB or smaller");
    const form = new FormData();
    form.append("file", file);
    setUploading(true);
    try {
      const uploaded = await api("/attachments", { method: "POST", body: form });
      setAttachment(uploaded);
      onToast(`${file.name} is ready to send`);
    } catch (error) { onToast(error.message); }
    finally { setUploading(false); }
  }

  function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    void uploadAttachment(file);
  }

  function pasteImage(event) {
    const item = [...(event.clipboardData?.items || [])].find((entry) => entry.type.startsWith("image/"));
    const image = item?.getAsFile();
    if (!image) return;
    event.preventDefault();
    const extension = image.type.split("/")[1] || "png";
    void uploadAttachment(new File([image], `pasted-image-${Date.now()}.${extension}`, { type: image.type }));
  }

  function insertEmoji(emoji) {
    const element = textareaRef.current;
    const start = element?.selectionStart ?? message.length;
    const end = element?.selectionEnd ?? message.length;
    setMessage(`${message.slice(0, start)}${emoji}${message.slice(end)}`);
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  async function downloadAttachment(item) {
    try {
      const response = await fetch(apiUrl(`/attachments/${item.attachment_id}`), {
        headers: { Authorization: `Bearer ${authStore.get()}` }
      });
      if (!response.ok) throw new Error("The attachment could not be opened");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = item.file_name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { onToast(error.message); }
  }

  async function submitGroup(group) {
    try {
      const channel = await api("/channels", { method: "POST", body: JSON.stringify(group) });
      await onRefresh();
      setCreateGroup(false);
      openChannel(channel.id);
      onToast("Group created successfully");
    } catch (error) { onToast(error.message); }
  }

  async function saveMembers(memberIds) {
    try {
      const result = await api(`/channels/${selected}/members`, {
        method: "PUT",
        body: JSON.stringify({ memberIds })
      });
      setChannelMembers(result.members);
      await onRefresh();
      setManageMembers(false);
      onToast(result.message);
    } catch (error) { onToast(error.message); }
  }

  async function toggleMute() {
    const next = !channelMuted;
    try {
      const result = await api(`/channels/${selected}/preferences`, { method: "PATCH", body: JSON.stringify({ muted: next }) });
      setChannelMutedState(result.muted);
      await onRefresh();
      onToast(result.message);
    } catch (error) { onToast(error.message); }
  }

  function copyChannelLink() {
    const url = new URL(window.location.href);
    url.searchParams.set("channel", selected);
    navigator.clipboard.writeText(url.toString())
      .then(() => onToast("Channel link copied"))
      .catch(() => onToast("Could not copy the channel link"));
    setMoreOpen(false);
  }

  function exportConversation() {
    const content = messages.map((item) =>
      `[${new Date(item.sent_at).toLocaleString()}] ${item.sender_name}: ${item.body || ""}${item.file_name ? ` [Attachment: ${item.file_name}]` : ""}`
    ).join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeChannel.name}-conversation.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMoreOpen(false);
  }

  async function deleteGroup() {
    try {
      const result = await api(`/channels/${selected}`, { method: "DELETE" });
      setDeleteGroupOpen(false);
      closeConversation(false);
      setChannelMembers([]);
      await onRefresh();
      onToast(result.message);
    } catch (error) { onToast(error.message); }
  }

  return (
    <div className="chat-page">
      <aside className="chat-sidebar">
        <header><div><h1>Chat</h1><p>{people.length} employees connected</p></div>{canCreateGroup && <button className="icon-button" onClick={() => setCreateGroup(true)} title="Create group"><Plus size={20} /></button>}</header>
        <label className="section-search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find an employee" /></label>
        <div className="chat-sidebar-scroll">
          <nav className="chat-nav">
            <button className={!selected && !selectedPerson ? "active" : ""} onClick={() => closeConversation()}><Users size={18} /> All employees <b>{people.length}</b></button>
          </nav>
          <div className="channel-heading"><span>GROUPS & CHANNELS</span>{canCreateGroup && <button onClick={() => setCreateGroup(true)}><Plus size={15} /></button>}</div>
          <nav className="channels">
            {channels.map((channel) => <button key={channel.id} onClick={() => openChannel(channel.id)} className={selected === channel.id ? "active" : ""}>{channel.is_private ? <Lock size={16} /> : <Hash size={17} />}<span>{channel.name}</span><UnreadBadge count={channel.unread_count} /></button>)}
          </nav>
          <div className="channel-heading"><span>EMPLOYEES</span></div>
          <nav className="direct-list">
            {filteredPeople.filter((person) => person.id !== user.id).map((person) => <div className={`direct-person-row ${selectedPerson?.id === person.id ? "active" : ""}`} key={person.id}>
              <button className="direct-person-open" onClick={() => openPerson(person)}><Avatar person={person} size="xs" showPresence /><span className="direct-person-name">{person.full_name}</span><UnreadBadge count={directUnreadCounts[person.id]} /></button>
              <span className="direct-call-actions">
                <button type="button" onClick={() => onStartCall(person, "audio")} title={`Voice call ${person.full_name}`} aria-label={`Voice call ${person.full_name}`}><Phone size={15} /></button>
                <button type="button" onClick={() => onStartCall(person, "video")} title={`Video call ${person.full_name}`} aria-label={`Video call ${person.full_name}`}><Video size={15} /></button>
              </span>
            </div>)}
          </nav>
        </div>
      </aside>

      {!selected && !selectedPerson ? (
        <section className="employee-chat-hub">
          <section className="mobile-channel-browser" aria-labelledby="mobile-channels-title">
            <header>
              <div><span className="eyebrow">GROUPS &amp; CHANNELS</span><h2 id="mobile-channels-title">Channels</h2></div>
              {canCreateGroup && <button className="icon-button" onClick={() => setCreateGroup(true)} title="Create group" aria-label="Create group"><Plus size={20} /></button>}
            </header>
            <nav>
              {channels.map((channel) => <button key={channel.id} onClick={() => openChannel(channel.id)}>
                <span className="mobile-channel-icon">{channel.is_private ? <Lock size={18} /> : <Hash size={20} />}</span>
                <span><b>{channel.name}</b><small>{channel.description || (channel.is_private ? "Private channel" : "Channel")}</small></span>
                <span className="mobile-channel-tail"><UnreadBadge count={channel.unread_count} /><ChevronRight size={18} /></span>
              </button>)}
            </nav>
          </section>
          <header className="employee-hub-head"><div><span className="eyebrow">COMPANY DIRECTORY</span><h1>Start a conversation</h1><p>Everyone who joined your workspace through an approved invitation appears here.</p></div>{canCreateGroup && <button className="button button-primary" onClick={() => setCreateGroup(true)}><UserPlus size={17} /> Create group</button>}</header>
          <label className="employee-hub-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search employees by name, ID, designation, or department" /></label>
          <div className="employee-chat-grid">
            {filteredPeople.map((person) => <article key={person.id}>
              <Avatar person={person} size="lg" showPresence />
              <div><h3>{person.full_name}<UnreadBadge count={directUnreadCounts[person.id]} /></h3><p><BriefcaseBusiness size={13} /> {person.title}</p><p><MapPin size={13} /> {person.location || person.department}</p><span>{person.employee_id} · {person.department}</span></div>
              {person.id !== user.id && <div className="employee-chat-actions">
                <button className="button button-secondary employee-message-button" onClick={() => openPerson(person)}><MessageSquareText size={16} /> Message</button>
                <div className="mobile-employee-call-actions">
                  <button type="button" onClick={() => openPerson(person)} title={`Message ${person.full_name}`} aria-label={`Message ${person.full_name}`}><MessageSquareText size={19} /></button>
                  <button type="button" onClick={() => onStartCall(person, "audio")} title={`Voice call ${person.full_name}`} aria-label={`Voice call ${person.full_name}`}><Phone size={19} /></button>
                  <button type="button" onClick={() => onStartCall(person, "video")} title={`Video call ${person.full_name}`} aria-label={`Video call ${person.full_name}`}><Video size={19} /></button>
                </div>
              </div>}
            </article>)}
          </div>
        </section>
      ) : (
        <section className={`conversation ${selectedPerson ? "direct-conversation" : ""}`}>
          <header className="conversation-header">
            <div><button className="mobile-conversation-back" onClick={() => closeConversation()} title="Back to chats" aria-label="Back to chats"><ArrowLeft size={21} /></button>{selectedPerson ? <Avatar person={selectedPerson} showPresence /> : <span className="channel-icon"><Hash size={19} /></span>}<span><h2>{selectedPerson?.full_name || activeChannel?.name}</h2><p>{selectedPerson ? `${selectedPerson.title} · ${selectedPerson.department}` : activeChannel?.description}</p></span></div>
            <div>
              {selectedPerson && <><button className="icon-button call-button" onClick={() => onStartCall(selectedPerson, "audio")} title="Start voice call"><Phone size={18} /></button><button className="icon-button call-button" onClick={() => onStartCall(selectedPerson, "video")} title="Start video call"><Video size={18} /></button></>}
              {selected && <button className="members-button" onClick={() => canManageGroup && setManageMembers(true)}><Users size={17} /> {channelMembers.length}</button>}
              {selected && canManageGroup && <button className="icon-button mobile-manage-members" onClick={() => setManageMembers(true)} title="Manage members" aria-label="Manage members"><UserPlus size={19} /></button>}
              <button className={`icon-button ${selectedPerson ? "personal-chat-extra" : ""}`}><Bell size={19} /></button><button className={`icon-button ${selectedPerson ? "personal-chat-extra" : ""}`}><Info size={19} /></button>
            </div>
          </header>
          {selected && messageSearchOpen && <div className="conversation-search">
            <Search size={17} /><input autoFocus value={messageSearch} onChange={(event) => setMessageSearch(event.target.value)} placeholder={`Search in #${activeChannel?.name}`} />
            <small>{visibleMessages.length} result{visibleMessages.length === 1 ? "" : "s"}</small>
            <button onClick={() => { setMessageSearchOpen(false); setMessageSearch(""); }}><X size={16} /></button>
          </div>}
          <div className="messages">
            <div className="channel-intro">{selectedPerson ? <Avatar person={selectedPerson} size="lg" showPresence /> : <span><Hash size={26} /></span>}<h2>{selectedPerson ? `Conversation with ${selectedPerson.full_name}` : `Welcome to #${activeChannel?.name}`}</h2><p>{selectedPerson ? "This is a private conversation between the two of you." : activeChannel?.description}</p></div>
            {visibleMessages.map((item, index) => {
              const previous = visibleMessages[index - 1];
              const startsNewDay = !previous || !isSameMessageDay(previous.sent_at, item.sent_at);
              const grouped = !startsNewDay && previous.sender_id === item.sender_id && new Date(item.sent_at) - new Date(previous.sent_at) < 300000;
              const mine = item.sender_id === user.id;
              return <Fragment key={item.id}>
                {startsNewDay && <div className="date-divider"><span>{messageDateLabel(item.sent_at)}</span></div>}
                <div className={`chat-message ${grouped ? "grouped" : ""} ${mine ? "mine" : "theirs"}`}>
                {!grouped && <Avatar person={{ initials: item.initials, avatar_color: item.avatar_color }} />}
                <div><header>{!grouped && <b>{item.sender_name}</b>}<span className="message-meta"><time>{eventTime(item.sent_at)}{item.edited_at ? " · edited" : ""}</time>{mine && selected && (item.seen_by_all
                  ? <span className="message-sent-status seen" title="Seen by everyone" aria-label="Seen by everyone"><CheckCheck size={14} strokeWidth={2.5} /></span>
                  : <span className="message-sent-status" title="Sent" aria-label="Sent"><Check size={13} strokeWidth={2.6} /></span>)}</span></header>
                  {item.forwarded_from_id && !item.deleted_at && <span className="forwarded-label"><Forward size={12} /> Forwarded</span>}
                  {item.reply_to_id && !item.deleted_at && <div className="message-reply-preview"><b>{item.reply_sender_name || "Message"}</b><span>{item.reply_deleted_at ? "This message was deleted" : item.reply_body}</span></div>}
                  {item.deleted_at ? <p className="deleted-message"><Trash2 size={14} /> This message was deleted</p> : item.body && <MessageBody body={item.body} />}
                  {item.attachment_id && <button className="message-attachment" onClick={() => downloadAttachment(item)}>
                    <span><FileText size={19} /></span><span><b>{item.file_name}</b><small>{formatFileSize(item.file_size)}</small></span><Download size={17} />
                  </button>}
                  {!!item.reactions?.length && !item.deleted_at && <div className="message-reactions">
                    {item.reactions.map((reaction) => <button className={reaction.reacted_by_me ? "mine" : ""} onClick={() => reactToMessage(item, reaction.emoji)} key={reaction.emoji}><span>{reaction.emoji}</span><b>{reaction.count}</b></button>)}
                  </div>}
                </div>
                <button className="message-more" onClick={() => { setMessageMenuId(messageMenuId === item.id ? null : item.id); setReactionMessageId(null); }} aria-label="Message actions"><MoreHorizontal size={16} /></button>
                {messageMenuId === item.id && <div className={`message-actions-menu ${mine ? "align-mine" : ""}`}>
                  {!item.deleted_at && <><button onClick={() => setReactionMessageId(reactionMessageId === item.id ? null : item.id)}><Smile size={16} /> React</button>
                    <button onClick={() => replyToMessage(item)}><Reply size={16} /> Reply</button>
                    <button onClick={() => { setForwardingMessage(item); setMessageMenuId(null); }}><Forward size={16} /> Forward</button>
                    {mine && item.body && <button onClick={() => editMessage(item)}><Pencil size={16} /> Edit</button>}</>}
                  <button onClick={() => deleteMessage(item, "me")}><Trash2 size={16} /> Delete for me</button>
                  {mine && !item.deleted_at && <button className="danger-menu-item" onClick={() => deleteMessage(item, "everyone")}><Trash2 size={16} /> Delete for everyone</button>}
                </div>}
                {reactionMessageId === item.id && <div className={`message-reaction-picker ${mine ? "align-mine" : ""}`}>
                  {QUICK_REACTIONS.map((emoji) => <button onClick={() => reactToMessage(item, emoji)} key={emoji}>{emoji}</button>)}
                </div>}
                </div>
              </Fragment>;
            })}
            {messageSearch && !visibleMessages.length && <div className="conversation-search-empty"><Search size={23} /><b>No matching messages</b><span>Try another name, phrase, or file name.</span></div>}
            <div ref={endRef} />
          </div>
          <form className="message-composer" onSubmit={send}>
            {editingMessage && <div className="composer-reply composer-edit"><Pencil size={16} /><div><b>Editing message</b><span>{editingMessage.body}</span></div><button type="button" onClick={() => { setEditingMessage(null); setMessage(""); }} aria-label="Cancel edit"><X size={16} /></button></div>}
            {replyingTo && <div className="composer-reply"><Reply size={16} /><div><b>Replying to {replyingTo.sender_name}</b><span>{replyingTo.body || replyingTo.file_name || "Attachment"}</span></div><button type="button" onClick={() => setReplyingTo(null)} aria-label="Cancel reply"><X size={16} /></button></div>}
            {attachment && <div className="composer-attachment"><span><Check size={15} /></span><div><b>{attachment.file_name}</b><small>{formatFileSize(attachment.file_size)} · Ready to send</small></div><button type="button" onClick={() => setAttachment(null)} title="Remove attachment"><X size={16} /></button></div>}
            <textarea ref={textareaRef} value={message} onChange={(event) => setMessage(event.target.value)} onPaste={pasteImage} onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form.requestSubmit(); }
            }} placeholder={selectedPerson ? `Message ${selectedPerson.full_name}` : `Message #${activeChannel?.name}`} rows={1} />
            <input ref={fileInputRef} className="composer-file-input" type="file" accept={ACCEPTED_FILES} onChange={chooseFile} />
            <div className="composer-toolbar"><span>
              <button type="button" className={uploading ? "tool-busy" : ""} onClick={() => fileInputRef.current?.click()} disabled={uploading} title="Attach a file"><Paperclip size={18} /></button>
              <button type="button" className={emojiOpen ? "active" : ""} onClick={() => setEmojiOpen((open) => !open)} title="Choose an emoji"><Smile size={18} /></button>
            </span><button className="send-button" disabled={(!message.trim() && !attachment) || busy || uploading}><Send size={17} /></button></div>
            {emojiOpen && <div className="emoji-picker" role="dialog" aria-label="Choose an emoji">
              <header><b>Choose an emoji</b><button type="button" onClick={() => setEmojiOpen(false)}><X size={15} /></button></header>
              <div>{EMOJIS.map((emoji) => <button type="button" key={emoji} onClick={() => insertEmoji(emoji)}>{emoji}</button>)}</div>
            </div>}
          </form>
        </section>
      )}

      {selected && <aside className="chat-details">
        <div className="details-channel-icon"><Hash size={25} /></div>
        <h3>{activeChannel?.name}</h3><p>{activeChannel?.description}</p>
        <div className="detail-actions">
          <button className={channelMuted ? "active" : ""} onClick={toggleMute}><Bell size={18} /><span>{channelMuted ? "Unmute" : "Mute"}</span></button>
          <button className={messageSearchOpen ? "active" : ""} onClick={() => setMessageSearchOpen((open) => !open)}><Search size={18} /><span>Search</span></button>
          <div className="channel-more-wrap"><button className={moreOpen ? "active" : ""} onClick={() => setMoreOpen((open) => !open)}><MoreHorizontal size={18} /><span>More</span></button>
            {moreOpen && <div className="channel-more-menu">
              {canManageGroup && <button onClick={() => { setManageMembers(true); setMoreOpen(false); }}><UserPlus size={16} /> Manage members</button>}
              <button onClick={copyChannelLink}><Hash size={16} /> Copy channel link</button>
              <button onClick={exportConversation}><Download size={16} /> Export conversation</button>
              {(activeChannel?.created_by === user.id || ["hr", "senior_leader"].includes(user.role)) && <button className="danger-menu-item" onClick={() => { setDeleteGroupOpen(true); setMoreOpen(false); }}><Trash2 size={16} /> Delete group</button>}
            </div>}
          </div>
        </div>
        <button className="details-row" onClick={() => canManageGroup && setManageMembers(true)}><span><Users size={18} /> Members</span><b>{channelMembers.length}</b><ChevronDown size={16} /></button>
        <div className="details-members">{channelMembers.slice(0, 6).map((person) => <div key={person.id}><Avatar person={person} size="xs" showPresence /><span><b>{person.full_name}</b><small>{person.title}</small></span></div>)}</div>
        {canManageGroup && <button className="button button-secondary manage-members-button" onClick={() => setManageMembers(true)}><UserPlus size={16} /> Manage members</button>}
      </aside>}
      {createGroup && <CreateGroup people={people.filter((person) => person.id !== user.id)} onCreate={submitGroup} onClose={() => setCreateGroup(false)} />}
      {manageMembers && selected && <ManageGroupMembers channel={activeChannel} people={people} members={channelMembers} currentUserId={user.id} onSave={saveMembers} onClose={() => setManageMembers(false)} />}
      {forwardingMessage && <ForwardMessageModal message={forwardingMessage} channels={channels} people={people.filter((person) => person.id !== user.id)} onForward={forwardMessage} onClose={() => setForwardingMessage(null)} />}
      {deleteGroupOpen && activeChannel && <Modal title="Delete group" subtitle={`Permanently remove #${activeChannel.name}`} onClose={() => setDeleteGroupOpen(false)}>
        <div className="delete-confirm"><span><Trash2 size={24} /></span><h3>Delete #{activeChannel.name}?</h3><p>All messages, attachments, and membership records in this group will be permanently deleted. This cannot be recovered.</p><footer><button className="button button-secondary" onClick={() => setDeleteGroupOpen(false)}>Cancel</button><button className="button button-danger" onClick={deleteGroup}><Trash2 size={16} /> Delete group</button></footer></div>
      </Modal>}
    </div>
  );
}

function formatFileSize(bytes) {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function UnreadBadge({ count }) {
  const unread = Number(count) || 0;
  if (!unread) return null;
  return <b className="conversation-unread-badge" aria-label={`${unread} unread message${unread === 1 ? "" : "s"}`}>{unread > 99 ? "99+" : unread}</b>;
}

function isSameMessageDay(first, second) {
  const a = new Date(first);
  const b = new Date(second);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function messageDateLabel(value) {
  const date = new Date(value);
  const today = new Date();
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const currentDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysAgo = Math.round((currentDay - targetDay) / 86_400_000);
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return date.toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric"
  });
}

function MessageBody({ body }) {
  const parts = body.split(/(https?:\/\/[^\s]+)/g);
  return <p>{parts.map((part, index) => /^https?:\/\//.test(part)
    ? <a className="message-link" href={part} key={`${part}-${index}`}>{part}</a>
    : part
  )}</p>;
}

function ForwardMessageModal({ message, channels, people, onForward, onClose }) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const visibleChannels = channels.filter((channel) => channel.name.toLowerCase().includes(term));
  const visiblePeople = people.filter((person) => `${person.full_name} ${person.title}`.toLowerCase().includes(term));
  return <Modal title="Forward message" subtitle="Choose a group or employee" onClose={onClose}>
    <div className="forward-message-modal">
      <div className="forward-message-preview"><Forward size={16} /><span>{message.body || message.file_name || "Attachment"}</span></div>
      <label className="section-search"><Search size={16} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search groups or employees" /></label>
      {!!visibleChannels.length && <section><small>GROUPS &amp; CHANNELS</small>{visibleChannels.map((channel) => <button onClick={() => onForward("channel", channel.id)} key={channel.id}><span className="forward-target-icon">{channel.is_private ? <Lock size={16} /> : <Hash size={17} />}</span><span><b>{channel.name}</b><em>{channel.description || "Channel"}</em></span><Forward size={16} /></button>)}</section>}
      {!!visiblePeople.length && <section><small>EMPLOYEES</small>{visiblePeople.map((person) => <button onClick={() => onForward("person", person.id)} key={person.id}><Avatar person={person} size="xs" showPresence /><span><b>{person.full_name}</b><em>{person.title}</em></span><Forward size={16} /></button>)}</section>}
      {!visibleChannels.length && !visiblePeople.length && <p className="forward-empty">No matching conversation found.</p>}
    </div>
  </Modal>;
}
