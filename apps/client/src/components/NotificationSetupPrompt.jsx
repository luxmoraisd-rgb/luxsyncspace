import { useEffect, useState } from "react";
import { BellRing, ExternalLink, X } from "lucide-react";
import { enableNotifications, notificationsEnabled, notificationsSupported } from "../lib/notifications";

export function NotificationSetupPrompt({ onToast }) {
  const [visible, setVisible] = useState(() => notificationsSupported() && !notificationsEnabled());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const sync = () => setVisible(notificationsSupported() && !notificationsEnabled());
    window.addEventListener("luxsyncspace:notifications-changed", sync);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("luxsyncspace:notifications-changed", sync);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  if (!visible) return null;

  async function enable() {
    setBusy(true);
    setError("");
    try {
      await enableNotifications();
      setVisible(false);
      onToast("Call, message, and meeting notifications are enabled on this device");
    } catch (error) {
      setError(error.message || "Could not enable alerts.");
      onToast(error.message);
    } finally {
      setBusy(false);
    }
  }

  function openNotificationSettings() {
    const userAgent = navigator.userAgent;
    const settingsUrl = userAgent.includes("Edg/")
      ? `edge://settings/content/siteDetails?site=${encodeURIComponent(window.location.origin)}`
      : userAgent.includes("Chrome/")
        ? `chrome://settings/content/siteDetails?site=${encodeURIComponent(window.location.origin)}`
        : null;
    if (!settingsUrl) {
      setError("Open this site's browser settings, set Notifications to Allow, then return here.");
      return;
    }
    const settingsWindow = window.open(settingsUrl, "_blank");
    if (!settingsWindow) {
      setError("Open the site controls beside the address bar, set Notifications to Allow, then return here.");
    }
  }

  const permissionDenied = notificationsSupported() && Notification.permission === "denied";

  return (
    <aside className="notification-setup-prompt" role="status">
      <span><BellRing size={21} /></span>
      <div>
        <b>Never miss a call</b>
        <p>{permissionDenied
          ? "Notifications are blocked for this site. Allow them in your browser settings, then return here."
          : "Enable ringing and phone notifications for incoming calls and messages."}</p>
        {error && <p className="notification-setup-error" role="alert">{error}</p>}
      </div>
      {permissionDenied
        ? <button className="button button-primary" onClick={openNotificationSettings}><ExternalLink size={15} /> Open settings</button>
        : <button className="button button-primary" onClick={enable} disabled={busy}>{busy ? "Enabling…" : "Enable alerts"}</button>}
      <button className="notification-setup-close" onClick={() => setVisible(false)} aria-label="Dismiss notification setup"><X size={16} /></button>
    </aside>
  );
}
