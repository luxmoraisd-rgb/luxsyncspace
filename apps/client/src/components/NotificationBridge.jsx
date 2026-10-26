import { useEffect, useRef } from "react";
import { io } from "socket.io-client";
import { SOCKET_URL, socketOptions } from "../lib/api";
import { dismissIncomingCallNotification, primeNotificationAudio, refreshNotificationSubscription, showIncomingCallNotification, showWorkspaceNotification, stopIncomingCallRingtone } from "../lib/notifications";

export function NotificationBridge({ user, channels, onRefresh, onIncomingCall, onCallAnswered, onNotification, onChatMessage, onPresenceUpdate, onMeetingEnded }) {
  const channelsRef = useRef(channels);
  const callbacksRef = useRef({ onRefresh, onIncomingCall, onCallAnswered, onNotification, onChatMessage, onPresenceUpdate, onMeetingEnded });

  useEffect(() => {
    channelsRef.current = channels;
    callbacksRef.current = { onRefresh, onIncomingCall, onCallAnswered, onNotification, onChatMessage, onPresenceUpdate, onMeetingEnded };
  }, [channels, onRefresh, onIncomingCall, onCallAnswered, onNotification, onChatMessage, onPresenceUpdate, onMeetingEnded]);

  useEffect(() => {
    let lastSubscriptionRefresh = 0;
    const prepareDevice = () => {
      primeNotificationAudio().catch(() => {});
      if (Date.now() - lastSubscriptionRefresh > 15 * 60_000) {
        lastSubscriptionRefresh = Date.now();
        refreshNotificationSubscription().catch(() => {});
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") prepareDevice();
    };
    window.addEventListener("pointerdown", prepareDevice, { passive: true });
    window.addEventListener("touchend", prepareDevice, { passive: true });
    window.addEventListener("keydown", prepareDevice);
    document.addEventListener("visibilitychange", handleVisibility);
    prepareDevice();

    const socket = io(SOCKET_URL, socketOptions());
    const notify = (title, body, tag, sound = "message", view = "home") => {
      callbacksRef.current.onNotification?.({ title, body, tag, sound, view, id: crypto.randomUUID() });
      showWorkspaceNotification(title, body, tag, sound);
    };
    socket.on("direct:message", (message) => {
      if (message.sender_id === user.id) return;
      callbacksRef.current.onChatMessage?.("direct", message.sender_id);
      if (/^(Voice|Video) call:/.test(message.body || "")) return;
      if (/^Meeting cancelled:/.test(message.body || "")) return;
      const isMeetingInvitation = /^Meeting invitation:/.test(message.body || "");
      const mentioned = message.mentioned_user_ids?.includes(user.id);
      notify(
        isMeetingInvitation ? `Meeting invitation from ${message.sender_name}` : mentioned ? `${message.sender_name} mentioned you` : `Message from ${message.sender_name}`,
        message.body || `Shared ${message.file_name || "a file"}`,
        `direct-${message.sender_id}`,
        isMeetingInvitation ? "meeting" : "message",
        "chat"
      );
    });
    socket.on("channel:message", (message) => {
      if (message.sender_id === user.id) return;
      callbacksRef.current.onChatMessage?.("channel", message.channel_id);
      const channel = channelsRef.current.find((item) => item.id === message.channel_id);
      const mentioned = message.mentioned_user_ids?.includes(user.id);
      if (channel?.muted && !mentioned) return;
      notify(
        mentioned ? `${message.sender_name} mentioned you in #${channel?.name || "group"}` : `${message.sender_name} in #${channel?.name || "group"}`,
        message.body || `Shared ${message.file_name || "a file"}`,
        `channel-${message.channel_id}`,
        "message",
        "chat"
      );
    });
    socket.on("announcement:new", (announcement) => {
      notify(`Company announcement: ${announcement.title}`, announcement.body, `announcement-${announcement.id}`);
    });
    socket.on("event:created", (event) => {
      notify(event.title, event.body, event.tag, "meeting", "calendar");
    });
    socket.on("event:reminder", (event) => {
      notify(event.title, event.body, event.tag, "meeting", "calendar");
    });
    socket.on("event:cancelled", (event) => {
      notify(event.title, event.body, event.tag, "meeting", "meetings");
      callbacksRef.current.onRefresh?.();
    });
    socket.on("event:ended", (event) => {
      callbacksRef.current.onMeetingEnded?.(event);
      callbacksRef.current.onRefresh?.();
    });
    socket.on("channel:membership-updated", () => {
      callbacksRef.current.onRefresh();
    });
    socket.on("presence:updated", (presence) => {
      callbacksRef.current.onPresenceUpdate?.(presence);
    });
    socket.on("employee:status-updated", () => {
      callbacksRef.current.onRefresh?.();
    });
    socket.on("profile:privacy-updated", (updatedUser) => {
      if (updatedUser?.id !== user.id) callbacksRef.current.onRefresh?.();
    });
    socket.on("call:incoming", (call) => {
      callbacksRef.current.onIncomingCall(call);
      showIncomingCallNotification(call).catch(() => {});
    });
    socket.on("call:answered", ({ meetingId, participant }) => {
      stopIncomingCallRingtone();
      callbacksRef.current.onCallAnswered?.({ meetingId, participant });
      dismissIncomingCallNotification(meetingId).catch(() => {});
    });
    return () => {
      window.removeEventListener("pointerdown", prepareDevice);
      window.removeEventListener("touchend", prepareDevice);
      window.removeEventListener("keydown", prepareDevice);
      document.removeEventListener("visibilitychange", handleVisibility);
      socket.disconnect();
    };
  }, [user.id]);

  return null;
}
