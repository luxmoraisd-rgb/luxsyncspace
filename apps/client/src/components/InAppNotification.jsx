import { BellRing, X } from "lucide-react";
import { useEscapeKey } from "../lib/useEscapeKey";

export function InAppNotification({ notification, onOpen, onClose }) {
  useEscapeKey(onClose, Boolean(notification));

  if (!notification) return null;
  return (
    <aside className="in-app-notification" role="status" aria-live="polite">
      <span><BellRing size={20} /></span>
      <button className="in-app-notification-content" onClick={onOpen}><b>{notification.title}</b><p>{notification.body}</p></button>
      <button className="in-app-notification-close" onClick={onClose} aria-label="Dismiss notification"><X size={17} /></button>
    </aside>
  );
}
