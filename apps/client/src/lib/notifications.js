import { api } from "./api";

const ENABLED_KEY = "luxsyncspace_notifications_enabled";
let sharedAudioContext = null;
let subscriptionRefresh = null;

function getAudioContext() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  if (!sharedAudioContext || sharedAudioContext.state === "closed") {
    sharedAudioContext = new AudioContext();
  }
  return sharedAudioContext;
}

export async function primeNotificationAudio() {
  const context = getAudioContext();
  if (!context) return false;
  try {
    if (context.state !== "running") await context.resume();
    return context.state === "running";
  } catch {
    return false;
  }
}

export function notificationsSupported() {
  return "Notification" in window && "serviceWorker" in navigator;
}

export function notificationsEnabled() {
  return notificationsSupported() && Notification.permission === "granted" && localStorage.getItem(ENABLED_KEY) === "true";
}

export async function enableNotifications() {
  if (!notificationsSupported()) throw new Error("Notifications are not supported in this browser");
  if (!("PushManager" in window)) throw new Error("Push notifications are not supported in this browser");
  const permission = Notification.permission === "denied"
    ? "denied"
    : await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(permission === "denied"
      ? "Notifications are blocked for this site. Allow them in your browser's site settings, then try again."
      : "Allow notifications in the browser prompt to enable alerts.");
  }
  const { publicKey } = await api("/push/config");
  if (!publicKey) throw new Error("Push notifications are not configured on the server");

  localStorage.setItem(ENABLED_KEY, "true");
  try {
    await refreshNotificationSubscription(publicKey);
  } catch (error) {
    localStorage.setItem(ENABLED_KEY, "false");
    throw error;
  }
  await playNotificationSound();
  window.dispatchEvent(new CustomEvent("luxsyncspace:notifications-changed"));
  return true;
}

async function getNotificationRegistration() {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

export async function refreshNotificationSubscription(configuredPublicKey) {
  if (!notificationsEnabled()) return false;
  if (subscriptionRefresh) return subscriptionRefresh;
  subscriptionRefresh = (async () => {
    const registration = await getNotificationRegistration();
    await navigator.serviceWorker.ready;
    const { publicKey } = configuredPublicKey
      ? { publicKey: configuredPublicKey }
      : await api("/push/config");
    if (!publicKey) throw new Error("Push notifications are not configured");
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
    const json = subscription.toJSON();
    await api("/push/subscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys })
    });
    return true;
  })();
  try {
    return await subscriptionRefresh;
  } finally {
    subscriptionRefresh = null;
  }
}

export async function showIncomingCallNotification(call) {
  if (!notificationsEnabled() || !call?.meeting?.id) return;
  const registration = await getNotificationRegistration();
  const isAudio = call.mode === "audio";
  await registration.showNotification(`Incoming ${isAudio ? "voice" : "video"} call`, {
    body: call.caller?.full_name || call.meeting.title || "LuxSyncspace call",
    tag: `call-${call.meeting.id}`,
    icon: "/icons/luxsyncspace-192.png",
    badge: "/icons/luxsyncspace-192.png",
    vibrate: [500, 220, 500, 900, 500, 220, 500],
    renotify: true,
    requireInteraction: true,
    silent: false,
    actions: [
      { action: "accept", title: "Accept" },
      { action: "reject", title: "Reject" }
    ],
    data: {
      type: "call",
      meetingId: call.meeting.id,
      url: `/?meeting=${call.meeting.id}`
    }
  });
}

export async function dismissIncomingCallNotification(meetingId) {
  if (!("serviceWorker" in navigator) || !meetingId) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const notifications = await registration?.getNotifications({ tag: `call-${meetingId}` }) || [];
  notifications.forEach((notification) => notification.close());
}

export async function disableNotifications() {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await api("/push/subscribe", {
      method: "DELETE",
      body: JSON.stringify({ endpoint: subscription.endpoint })
    });
    await subscription.unsubscribe();
  }
  localStorage.setItem(ENABLED_KEY, "false");
  window.dispatchEvent(new CustomEvent("luxsyncspace:notifications-changed"));
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

export async function showWorkspaceNotification(title, body, tag = "luxsyncspace", sound = "message") {
  await playNotificationSound(sound).catch(() => {});
  if (!notificationsEnabled()) return;
  if (document.visibilityState === "visible") return;
  const registration = await getNotificationRegistration();
  
  let targetUrl = "/";
  if (tag && tag.startsWith("channel-")) targetUrl = `/?view=chat&channel=${tag.replace("channel-", "")}`;
  if (tag && tag.startsWith("direct-")) targetUrl = `/?view=chat&direct=${tag.replace("direct-", "")}`;

  await registration.showNotification(title, {
    body,
    tag,
    icon: "/icons/luxsyncspace-192.png",
    badge: "/icons/luxsyncspace-192.png",
    vibrate: sound === "meeting" ? [220, 90, 220, 90, 420] : [180, 80, 180],
    renotify: true,
    data: { url: targetUrl }
  });
}

export async function playNotificationSound(sound = "message") {
  const context = getAudioContext();
  if (!context || !(await primeNotificationAudio())) return;
  const gain = context.createGain();
  gain.connect(context.destination);
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  const isMeeting = sound === "meeting";
  const notes = isMeeting
    ? [[523.25, 0], [659.25, 0.16], [783.99, 0.32], [1046.5, 0.5]]
    : [[659.25, 0], [987.77, 0.13]];
  const duration = isMeeting ? 1.05 : 0.62;
  gain.gain.exponentialRampToValueAtTime(isMeeting ? 0.2 : 0.16, context.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);
  notes.forEach(([frequency, offset]) => {
    const oscillator = context.createOscillator();
    oscillator.type = isMeeting ? "triangle" : "sine";
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    oscillator.start(context.currentTime + offset);
    oscillator.stop(context.currentTime + offset + (isMeeting ? 0.32 : 0.42));
  });
  setTimeout(() => gain.disconnect(), (duration + 0.35) * 1000);
}

let activeRingtone = null;
let ringtoneGeneration = 0;

export async function startIncomingCallRingtone() {
  stopIncomingCallRingtone();
  const generation = ringtoneGeneration;
  const context = getAudioContext();
  if (!context || !(await primeNotificationAudio())) return;
  if (generation !== ringtoneGeneration) return;
  const master = context.createGain();
  master.gain.value = 0.22;
  master.connect(context.destination);

  const ring = () => {
    if (context.state === "closed") return;
    const start = context.currentTime;
    [[659.25, 0], [783.99, 0.22], [987.77, 0.48], [783.99, 0.72]].forEach(([frequency, offset]) => {
      const noteGain = context.createGain();
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      noteGain.gain.setValueAtTime(0.0001, start + offset);
      noteGain.gain.exponentialRampToValueAtTime(0.9, start + offset + 0.025);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.19);
      oscillator.connect(noteGain);
      noteGain.connect(master);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + 0.21);
    });
  };

  ring();
  const interval = window.setInterval(ring, 2600);
  activeRingtone = { context, interval, master };
  navigator.vibrate?.([450, 220, 450, 950, 450, 220, 450]);
}

export function stopIncomingCallRingtone() {
  ringtoneGeneration += 1;
  if (!activeRingtone) {
    navigator.vibrate?.(0);
    return;
  }
  window.clearInterval(activeRingtone.interval);
  const { context, master } = activeRingtone;
  activeRingtone = null;
  try {
    master.gain.cancelScheduledValues(context.currentTime);
    master.gain.setTargetAtTime(0.0001, context.currentTime, 0.025);
    window.setTimeout(() => master.disconnect(), 120);
  } catch {
    master.disconnect();
  }
  navigator.vibrate?.(0);
}
