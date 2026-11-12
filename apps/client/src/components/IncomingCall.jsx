import { useEffect } from "react";
import { Phone, PhoneOff, Video } from "lucide-react";
import { Avatar } from "./Avatar";
import { startIncomingCallRingtone, stopIncomingCallRingtone } from "../lib/notifications";
import { useEscapeKey } from "../lib/useEscapeKey";

export function IncomingCall({ call, onAccept, onDecline }) {
  useEscapeKey(onDecline, Boolean(call));

  useEffect(() => {
    if (!call) {
      stopIncomingCallRingtone();
      return;
    }
    startIncomingCallRingtone().catch(() => {});
    const missedCallTimer = window.setTimeout(onDecline, 45_000);
    return () => {
      window.clearTimeout(missedCallTimer);
      stopIncomingCallRingtone();
    };
  }, [call]);

  if (!call) return null;
  const isAudio = call.mode === "audio";
  return <div className="incoming-call" role="dialog" aria-modal="true" aria-label={`Incoming ${isAudio ? "voice" : "video"} call from ${call.caller.full_name}`}>
    <div className="incoming-call-pulse"><Avatar person={call.caller} size="xl" /></div>
    <span className="eyebrow">{isAudio ? "INCOMING VOICE CALL" : "INCOMING VIDEO CALL"}</span>
    <h2>{call.caller.full_name}</h2>
    <p>{call.meeting.title}</p>
    <div><button className="decline" onClick={onDecline}><PhoneOff size={20} /><span>Decline</span></button><button className="accept" onClick={onAccept}>{isAudio ? <Phone size={20} /> : <Video size={20} />}<span>Accept</span></button></div>
  </div>;
}
