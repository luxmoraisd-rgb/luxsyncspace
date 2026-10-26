import { useEffect, useRef, useState } from "react";
import {
  Check, ChevronDown, Copy, Expand, Hand, MessageSquareText, Mic, MicOff, MonitorUp, PhoneOff,
  Send, Users, Video, VideoOff, Volume2, VolumeX, X
} from "lucide-react";
import { io } from "socket.io-client";
import { api, SOCKET_URL, socketOptions } from "../lib/api";
import { copyTextToClipboard } from "../lib/clipboard";
import { Modal } from "../components/Modal";

const DEFAULT_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];
const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
  sampleRate: { ideal: 48000 }
};
const VIDEO_CONSTRAINTS = {
  width: { ideal: 640, max: 960 },
  height: { ideal: 360, max: 540 },
  frameRate: { ideal: 15, max: 20 }
};

export function MeetingRoom({ meeting, user, people = [], onInvite, onLeave, onEndMeeting, onToast, skipLobby = false }) {
  const isAudioOnly = meeting.meeting_mode === "audio";
  const isOrganizer = meeting.organizer_id === user.id;
  const isDirectCall = Boolean(meeting.isCall || meeting.title?.includes(" and ") || (meeting.title || "").toLowerCase().includes("call"));
  const [inLobby, setInLobby] = useState(!skipLobby);
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const [micDevice, setMicDevice] = useState("Microphone (Realtek(R) Audio)");
  const [speakerDevice, setSpeakerDevice] = useState("Speakers (Realtek(R) Audio)");
  const [cameraDevice, setCameraDevice] = useState("USB Camera");
  const [participants, setParticipants] = useState([]);
  const [localStream, setLocalStream] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(!isAudioOnly);
  const [lobbyParticipants, setLobbyParticipants] = useState([]);
  const [lobbyPresenceStatus, setLobbyPresenceStatus] = useState("loading");
  const [screenOn, setScreenOn] = useState(false);
  const [raised, setRaised] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [panel, setPanel] = useState(null);
  const [chat, setChat] = useState([]);
  const [chatMessage, setChatMessage] = useState("");
  const [meetingChatPopup, setMeetingChatPopup] = useState(null);
  const [status, setStatus] = useState("Connecting securely…");
  const [elapsed, setElapsed] = useState("00:00");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [invitingUserId, setInvitingUserId] = useState(null);
  const [invitedUsers, setInvitedUsers] = useState(new Set());
  const inviteResetTimersRef = useRef(new Map());
  const localVideoRef = useRef();
  const lobbyVideoRef = useRef();
  const localStreamRef = useRef();
  const displayStreamRef = useRef();
  const socketRef = useRef();
  const panelRef = useRef(null);
  const peersRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map());
  const reconnectTimersRef = useRef(new Map());
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS);
  const chatBottomRef = useRef(null);

  useEffect(() => () => {
    inviteResetTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    inviteResetTimersRef.current.clear();
  }, []);

  useEffect(() => { panelRef.current = panel; }, [panel]);

  useEffect(() => {
    if (panel === "chat") {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chat, panel]);

  useEffect(() => {
    if (!meetingChatPopup) return;
    const timer = window.setTimeout(() => setMeetingChatPopup(null), 5000);
    return () => window.clearTimeout(timer);
  }, [meetingChatPopup]);

  // Elapsed meeting time only runs when inside the active meeting
  useEffect(() => {
    if (inLobby) return;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(`${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(timer);
  }, [inLobby]);

  useEffect(() => {
    if (!inLobby || skipLobby) return;
    const socket = io(SOCKET_URL, socketOptions());
    let disposed = false;
    let refreshTimer;
    setLobbyPresenceStatus("loading");

    function refreshPresence() {
      socket.emit("meeting:presence", { roomId: meeting.id }, (response) => {
        if (disposed) return;
        if (!response?.ok) {
          if (response?.ended || (response?.error || "").toLowerCase().includes("ended")) {
            onToast?.(isDirectCall ? "This call has ended." : "This meeting has ended.");
            localStreamRef.current?.getTracks().forEach((track) => track.stop());
            onLeave?.();
            return;
          }
          if (response?.cancelled) {
            onToast?.("This meeting was cancelled.");
            localStreamRef.current?.getTracks().forEach((track) => track.stop());
            onLeave?.();
            return;
          }
          setLobbyPresenceStatus("error");
          return;
        }
        setLobbyParticipants(response.participants || []);
        setLobbyPresenceStatus("ready");
      });
    }

    socket.on("connect", refreshPresence);
    socket.on("connect_error", () => {
      if (!disposed) setLobbyPresenceStatus("error");
    });
    refreshTimer = window.setInterval(() => {
      if (socket.connected) refreshPresence();
    }, 5000);

    return () => {
      disposed = true;
      window.clearInterval(refreshTimer);
      socket.disconnect();
    };
  }, [inLobby, meeting.id, skipLobby]);

  // Initialize preview media and detect devices for the Lobby
  useEffect(() => {
    if (skipLobby) return;
    let disposed = false;
    async function initPreview() {
      try {
        const meetingConfig = await api("/meetings/config").catch(() => null);
        if (meetingConfig?.iceServers?.length) iceServersRef.current = meetingConfig.iceServers;
      } catch { }

      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: AUDIO_CONSTRAINTS,
          video: isAudioOnly ? false : VIDEO_CONSTRAINTS
        });
        setCameraBlocked(false);
      } catch (err) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
          setCameraOn(false);
          setCameraBlocked(true);
        } catch {
          setMicOn(false);
          setCameraOn(false);
          setCameraBlocked(true);
        }
      }
      if (disposed) {
        stream?.getTracks().forEach((track) => track.stop());
        return;
      }
      localStreamRef.current = stream;
      stream?.getAudioTracks().forEach((track) => {
        track.contentHint = "speech";
        track.enabled = micOn;
      });
      stream?.getVideoTracks().forEach((track) => {
        track.enabled = cameraOn;
      });
      setLocalStream(stream);

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics = devices.filter((d) => d.kind === "audioinput" && d.label);
        const speakers = devices.filter((d) => d.kind === "audiooutput" && d.label);
        const cameras = devices.filter((d) => d.kind === "videoinput" && d.label);
        if (mics.length) setMicDevice(mics[0].label);
        if (speakers.length) setSpeakerDevice(speakers[0].label);
        if (cameras.length) setCameraDevice(cameras[0].label);
      } catch { }
    }

    initPreview();
    return () => {
      disposed = true;
    };
  }, [meeting.id, skipLobby]);

  // Keep lobby video attached to local stream
  useEffect(() => {
    if (inLobby && lobbyVideoRef.current && localStream) {
      lobbyVideoRef.current.srcObject = localStream;
    }
  }, [inLobby, localStream, cameraOn, cameraBlocked]);

  useEffect(() => {
    if (inLobby) return;
    let disposed = false;

    function upsertParticipant(socketId, values) {
      setParticipants((current) => {
        const existing = current.find((participant) => participant.socketId === socketId);
        if (existing) return current.map((participant) => participant.socketId === socketId ? { ...participant, ...values } : participant);
        return [...current, { socketId, stream: null, raised: false, ...values }];
      });
    }

    function removeParticipant(socketId) {
      window.clearTimeout(reconnectTimersRef.current.get(socketId));
      reconnectTimersRef.current.delete(socketId);
      pendingCandidatesRef.current.delete(socketId);
      peersRef.current.get(socketId)?.close();
      peersRef.current.delete(socketId);
      setParticipants((current) => current.filter((participant) => participant.socketId !== socketId));
    }

    async function tuneSender(sender) {
      if (!sender.track) return;
      sender.track.contentHint = sender.track.kind === "audio" ? "speech" : "motion";
      try {
        const parameters = sender.getParameters();
        if (!parameters.encodings?.length) parameters.encodings = [{}];
        if (sender.track.kind === "audio") {
          parameters.encodings[0].maxBitrate = 96000;
          parameters.encodings[0].priority = "high";
          parameters.degradationPreference = "maintain-framerate";
        } else {
          const remoteCount = Math.max(1, peersRef.current.size);
          parameters.encodings[0].maxBitrate = Math.max(180000, Math.floor(900000 / remoteCount));
          parameters.encodings[0].maxFramerate = remoteCount >= 5 ? 12 : 18;
          parameters.encodings[0].scaleResolutionDownBy = remoteCount >= 7 ? 2 : remoteCount >= 4 ? 1.5 : 1;
          parameters.encodings[0].priority = "low";
          parameters.degradationPreference = "maintain-framerate";
        }
        await sender.setParameters(parameters);
      } catch {
        // Some browsers apply their own sender limits and reject these hints.
      }
    }

    function tuneAllSenders() {
      peersRef.current.forEach((peer) => peer.getSenders().forEach(tuneSender));
    }

    async function flushCandidates(socketId, peer) {
      const candidates = pendingCandidatesRef.current.get(socketId) || [];
      pendingCandidatesRef.current.delete(socketId);
      for (const candidate of candidates) {
        try { await peer.addIceCandidate(candidate); }
        catch (error) { console.warn("Could not apply a queued meeting candidate", error); }
      }
    }

    async function sendOffer(socketId, peer, restart = false) {
      if (peer.signalingState !== "stable") return;
      const offer = await peer.createOffer({ iceRestart: restart });
      await peer.setLocalDescription(offer);
      peer.getSenders().forEach(tuneSender);
      socketRef.current?.emit("meeting:signal", { target: socketId, signal: { offer: peer.localDescription } });
    }

    function scheduleReconnect(socketId, peer) {
      if (!peer._luxInitiator || reconnectTimersRef.current.has(socketId)) return;
      const timer = window.setTimeout(async () => {
        reconnectTimersRef.current.delete(socketId);
        if (!["disconnected", "failed"].includes(peer.connectionState)) return;
        try {
          setStatus("Restoring media connection...");
          peer.restartIce?.();
          await sendOffer(socketId, peer, true);
          if (["disconnected", "failed"].includes(peer.connectionState)) scheduleReconnect(socketId, peer);
        } catch (error) {
          console.warn("Meeting media reconnect failed", error);
          scheduleReconnect(socketId, peer);
        }
      }, peer.connectionState === "failed" ? 500 : 3500);
      reconnectTimersRef.current.set(socketId, timer);
    }

    function createPeer(socketId, participantUser, initiator = false) {
      if (peersRef.current.has(socketId)) {
        const existing = peersRef.current.get(socketId);
        existing._luxInitiator ||= initiator;
        return existing;
      }
      const peer = new RTCPeerConnection({ iceServers: iceServersRef.current, iceCandidatePoolSize: 10 });
      peer._luxInitiator = initiator;
      peersRef.current.set(socketId, peer);
      localStreamRef.current?.getTracks().forEach((track) => {
        const sender = peer.addTrack(track, localStreamRef.current);
        tuneSender(sender);
      });
      tuneAllSenders();
      peer.onicecandidate = (event) => {
        if (event.candidate) socketRef.current?.emit("meeting:signal", { target: socketId, signal: { candidate: event.candidate } });
      };
      peer.ontrack = (event) => upsertParticipant(socketId, { user: participantUser, stream: event.streams[0], connectionState: "connected" });
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") {
          window.clearTimeout(reconnectTimersRef.current.get(socketId));
          reconnectTimersRef.current.delete(socketId);
          upsertParticipant(socketId, { connectionState: "connected" });
          setStatus("Connected");
        } else if (["disconnected", "failed"].includes(peer.connectionState)) {
          upsertParticipant(socketId, { connectionState: "reconnecting" });
          scheduleReconnect(socketId, peer);
        }
      };
      return peer;
    }

    async function start() {
      try {
        const meetingConfig = await api("/meetings/config");
        if (meetingConfig.iceServers?.length) iceServersRef.current = meetingConfig.iceServers;
      } catch {
        // The safe default still supports most peer-to-peer connections.
      }
      let stream = localStreamRef.current;
      if (!stream) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: isAudioOnly ? false : VIDEO_CONSTRAINTS });
        } catch {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: AUDIO_CONSTRAINTS, video: false });
            setCameraOn(false);
            onToast("Camera unavailable. Joined with microphone only.");
          } catch {
            setMicOn(false);
            setCameraOn(false);
            onToast("Camera and microphone access is blocked. You can still join and view the meeting.");
          }
        }
      }
      if (disposed) {
        stream?.getTracks().forEach((track) => track.stop());
        return;
      }
      localStreamRef.current = stream;
      stream?.getAudioTracks().forEach((track) => {
        track.contentHint = "speech";
        track.enabled = micOn;
      });
      stream?.getVideoTracks().forEach((track) => {
        track.enabled = cameraOn;
      });
      setLocalStream(stream);
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const socket = io(SOCKET_URL, socketOptions());
      socketRef.current = socket;
      socket.on("connect_error", () => setStatus("Realtime connection unavailable. Retrying..."));
      socket.on("disconnect", () => {
        setStatus("Reconnecting securely...");
        reconnectTimersRef.current.forEach((timer) => window.clearTimeout(timer));
        reconnectTimersRef.current.clear();
        pendingCandidatesRef.current.clear();
        peersRef.current.forEach((peer) => peer.close());
        peersRef.current.clear();
        setParticipants([]);
      });
      socket.on("meeting:user-joined", ({ socketId, user: participantUser }) => {
        upsertParticipant(socketId, { user: participantUser });
      });
      socket.on("meeting:user-left", ({ socketId }) => {
        removeParticipant(socketId);
        if (isDirectCall) {
          setStatus("Call ended");
          setParticipants([]);
          peersRef.current.forEach((peer) => peer.close());
          peersRef.current.clear();
          onToast("The other participant left. Call ended.");
          window.setTimeout(onLeave, 900);
        }
      });
      socket.on("meeting:signal", async ({ from, signal, user: participantUser }) => {
        try {
          const peer = createPeer(from, participantUser);
          upsertParticipant(from, { user: participantUser });
          if (signal.offer) {
            await peer.setRemoteDescription(signal.offer);
            await flushCandidates(from, peer);
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            peer.getSenders().forEach(tuneSender);
            socket.emit("meeting:signal", { target: from, signal: { answer: peer.localDescription } });
          } else if (signal.answer) {
            await peer.setRemoteDescription(signal.answer);
            await flushCandidates(from, peer);
          } else if (signal.candidate) {
            if (peer.remoteDescription) await peer.addIceCandidate(signal.candidate);
            else pendingCandidatesRef.current.set(from, [...(pendingCandidatesRef.current.get(from) || []), signal.candidate]);
          }
        } catch (error) {
          console.error("Meeting signal failed", error);
        }
      });
      socket.on("meeting:chat", (incoming) => {
        setChat((current) => [...current, incoming]);
        if (incoming.sender_id !== user.id && panelRef.current !== "chat") setMeetingChatPopup(incoming);
      });
      socket.on("meeting:hand", ({ socketId, raised: isRaised }) => upsertParticipant(socketId, { raised: isRaised }));
      socket.on("meeting:cancelled", ({ body }) => {
        setStatus("Meeting cancelled");
        setParticipants([]);
        peersRef.current.forEach((peer) => peer.close());
        peersRef.current.clear();
        onToast(body || "This meeting was cancelled by the organizer.");
        window.setTimeout(onLeave, 1800);
      });
      socket.on("meeting:ended", ({ message, isCall }) => {
        const endedText = isCall || isDirectCall ? "Call ended" : "Meeting ended";
        setStatus(endedText);
        setParticipants([]);
        peersRef.current.forEach((peer) => peer.close());
        peersRef.current.clear();
        onToast(message || `${endedText}.`);
        window.setTimeout(onLeave, 900);
      });
      socket.on("connect", () => {
        setStatus("Connecting securely...");
        socket.emit("meeting:join", { roomId: meeting.id }, async (response) => {
          if (!response?.ok) {
            const isEnded = response?.ended || (response?.error || "").toLowerCase().includes("ended");
            const errText = isEnded ? (isDirectCall ? "This call has ended" : "This meeting has ended") : (response?.error || "Could not join meeting");
            setStatus(errText);
            setParticipants([]);
            onToast(errText);
            window.setTimeout(onLeave, 1200);
            return;
          }
          setStatus("Connected");
          for (const participant of response.participants) {
            upsertParticipant(participant.socketId, { user: participant.user });
            const peer = createPeer(participant.socketId, participant.user, true);
            await sendOffer(participant.socketId, peer);
          }
        });
      });
    }

    start();
    return () => {
      disposed = true;
      socketRef.current?.emit("meeting:leave");
      socketRef.current?.disconnect();
      peersRef.current.forEach((peer) => peer.close());
      peersRef.current.clear();
      reconnectTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      reconnectTimersRef.current.clear();
      pendingCandidatesRef.current.clear();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [inLobby, meeting.id, user.id]);

  function toggleMic() {
    const next = !micOn;
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = next; });
    setMicOn(next);
  }

  async function toggleCamera() {
    if (isAudioOnly) return;
    const next = !cameraOn;
    setCameraOn(next);
    if (!next) {
      localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = false; });
    } else {
      const currentTrack = localStreamRef.current?.getVideoTracks()[0];
      if (currentTrack && currentTrack.readyState === "live") {
        currentTrack.enabled = true;
        setCameraBlocked(false);
      } else {
        try {
          const videoStream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
          const newTrack = videoStream.getVideoTracks()[0];
          if (newTrack) {
            if (localStreamRef.current) {
              localStreamRef.current.addTrack(newTrack);
            } else {
              localStreamRef.current = videoStream;
              setLocalStream(videoStream);
            }
            if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
            if (lobbyVideoRef.current) lobbyVideoRef.current.srcObject = localStreamRef.current;
            setCameraBlocked(false);
          }
        } catch {
          setCameraOn(false);
          setCameraBlocked(true);
          onToast("Camera access is blocked or unavailable");
        }
      }
    }
  }

  async function shareScreen() {
    if (screenOn) return stopScreenShare();
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      displayStreamRef.current = display;
      const screenTrack = display.getVideoTracks()[0];
      peersRef.current.forEach((peer) => {
        peer.getSenders().find((sender) => sender.track?.kind === "video")?.replaceTrack(screenTrack);
      });
      if (localVideoRef.current) localVideoRef.current.srcObject = display;
      screenTrack.onended = stopScreenShare;
      setScreenOn(true);
    } catch {
      onToast("Screen sharing was cancelled");
    }
  }

  function stopScreenShare() {
    const display = displayStreamRef.current;
    displayStreamRef.current = null;
    display?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    const cameraTrack = localStreamRef.current?.getVideoTracks()[0] || null;
    peersRef.current.forEach((peer) => {
      peer.getSenders().find((sender) => sender.track?.kind === "video")?.replaceTrack(cameraTrack);
    });
    if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
    setScreenOn(false);
  }

  function toggleHand() {
    const next = !raised;
    setRaised(next);
    socketRef.current?.emit("meeting:hand", { raised: next });
  }

  function sendChat(event) {
    event.preventDefault();
    if (!chatMessage.trim()) return;
    socketRef.current?.emit("meeting:chat", { body: chatMessage });
    setChatMessage("");
  }

  async function copyLink() {
    const meetingId = meeting?.id || new URLSearchParams(window.location.search).get("meeting") || "";
    const url = new URL(window.location.pathname, window.location.origin);
    if (meetingId) {
      url.searchParams.set("meeting", meetingId);
    }
    const inviteUrl = url.toString();
    const success = await copyTextToClipboard(inviteUrl);
    if (success) {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
      onToast?.("Meeting invite link copied to clipboard");
    } else {
      onToast?.("Could not copy meeting link");
    }
  }

  async function handleLeaveCall() {
    if (isDirectCall) {
      try {
        await onEndMeeting(meeting);
        return;
      } catch (err) {
        console.error("End call error", err);
      }
    }
    onLeave();
  }

  async function endForEveryone() {
    setEnding(true);
    try {
      await onEndMeeting(meeting);
      setConfirmEnd(false);
    } catch (error) {
      onToast(error.message);
    } finally {
      setEnding(false);
    }
  }

  async function invitePerson(person) {
    setInvitingUserId(person.id);
    try {
      if (!onInvite) throw new Error("Inviting people is currently unavailable.");
      await onInvite([person.id]);
      setInvitedUsers((current) => new Set(current).add(person.id));
      window.clearTimeout(inviteResetTimersRef.current.get(person.id));
      const timer = window.setTimeout(() => {
        setInvitedUsers((current) => {
          const next = new Set(current);
          next.delete(person.id);
          return next;
        });
        inviteResetTimersRef.current.delete(person.id);
      }, 10_000);
      inviteResetTimersRef.current.set(person.id, timer);
    } catch (error) {
      onToast(error.message || "Could not invite this person.");
    } finally {
      setInvitingUserId(null);
    }
  }

  const allParticipants = [{ socketId: "local", user, stream: localStream, raised, local: true }, ...participants];

  if (inLobby) {
    const hasActiveVideo = cameraOn && !cameraBlocked && localStream && localStream.getVideoTracks().some((t) => t.enabled);
    return (
      <div className="meeting-lobby">
        <header className="lobby-header">
          <div className="lobby-brand">
            <img src="/icons/luxsyncspace-192.png" alt="" />
            <span>LuxSyncspace</span>
          </div>
          <button
            className="icon-button"
            onClick={() => {
              localStreamRef.current?.getTracks().forEach((t) => t.stop());
              onLeave();
            }}
            title="Leave"
            aria-label="Leave"
          >
            <X size={20} />
          </button>
        </header>

        <main className="lobby-container">
          <div className="lobby-preview-wrapper">
            <div className="lobby-preview-box">
              <div className="lobby-preview-header">
                <span className="lobby-user-label">{user.full_name?.toUpperCase() || "YOU"}</span>
              </div>

              {hasActiveVideo ? (
                <video ref={lobbyVideoRef} autoPlay playsInline muted />
              ) : (
                <div className="lobby-blocked-prompt">
                  <div className="lobby-warning-icon">!</div>
                  <h3>{cameraBlocked ? "Camera might be blocked" : "Camera is off"}</h3>
                  <p>
                    {cameraBlocked
                      ? "Check your camera's privacy switch and remove anything that is covering the camera lens"
                      : "Your camera is turned off. Click the camera icon below to turn it on."}
                  </p>
                </div>
              )}

              <div className="lobby-preview-controls">
                <div className="lobby-preview-center-controls">
                  <button
                    type="button"
                    className={`lobby-control-btn ${!micOn ? "off" : ""}`}
                    onClick={toggleMic}
                    title={micOn ? "Turn off microphone" : "Turn on microphone"}
                    aria-label={micOn ? "Turn off microphone" : "Turn on microphone"}
                  >
                    {micOn ? <Mic size={20} /> : <><MicOff size={20} /><span className="lobby-badge-warning">!</span></>}
                  </button>
                  <button
                    type="button"
                    className={`lobby-control-btn ${!cameraOn || cameraBlocked ? "off" : ""}`}
                    onClick={toggleCamera}
                    title={cameraOn ? "Turn off camera" : "Turn on camera"}
                    aria-label={cameraOn ? "Turn off camera" : "Turn on camera"}
                  >
                    {cameraOn && !cameraBlocked ? <Video size={20} /> : <><VideoOff size={20} /><span className="lobby-badge-warning">!</span></>}
                  </button>
                </div>

              </div>
            </div>

          </div>

          <div className="lobby-action-card">
            <h1 className="lobby-title">Ready to join?</h1>
            <p className="lobby-subtitle">
              {lobbyPresenceStatus === "loading"
                ? "Checking who's here…"
                : lobbyPresenceStatus === "error"
                  ? "Unable to check meeting participants"
                  : lobbyParticipants.length === 0
                    ? "No one else is here"
                    : lobbyParticipants.length > 1
                      ? `${lobbyParticipants[0].full_name} and ${lobbyParticipants.length - 1} more are already here`
                      : `${lobbyParticipants[0].full_name} is already here`}
            </p>

            <div className="lobby-join-wrapper">
              {(!cameraOn || !micOn || cameraBlocked) && (
                <span className="lobby-join-warning-badge">!</span>
              )}
              <button className="lobby-join-btn" onClick={() => setInLobby(false)} type="button">
                Join now
              </button>
            </div>

          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={`meeting-room ${isAudioOnly ? "audio-call" : "video-call"}`}>
      <header className="meeting-topbar">
        <div><img src="/icons/luxsyncspace-192.png" alt="" /><span><b>{meeting.title || "LuxSyncspace meeting"}</b><small>{status} · Encrypted media connection</small></span></div>
        <div><time>{elapsed}</time><button onClick={copyLink} className={copiedLink ? "meeting-copied-btn" : ""} type="button" title="Copy meeting link">{copiedLink ? <Check size={17} /> : <Copy size={17} />} {copiedLink ? "Link copied!" : "Copy invite link"}</button></div>
      </header>
      <main className={`meeting-stage ${panel ? "with-panel" : ""}`}>
        <section className={`meeting-grid participants-${Math.min(allParticipants.length, 6)}`}>
          {allParticipants.map((participant) => <VideoTile participant={participant} key={participant.socketId} localVideoRef={participant.local ? localVideoRef : null} cameraOn={participant.local ? cameraOn : true} speakerOn={speakerOn} />)}
        </section>
        {panel && <aside className="meeting-panel">
          <header><div><b>{panel === "people" ? "Participants" : panel === "invite" ? "Invite people" : "Meeting chat"}</b><small>{allParticipants.length} in this meeting</small></div><button onClick={() => setPanel(null)}><X size={18} /></button></header>
          {panel === "invite" ? <div className="meeting-people">
            <button className="button button-secondary meeting-invite-people-btn" onClick={() => setPanel("people")} style={{ width: "100%", marginBottom: "1rem" }}>
              Back to participants
            </button>
            <div className="invite-list" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {people.filter((p) => p.id !== user.id && !allParticipants.some((ap) => ap.user?.id === p.id)).map((person) => (
                <div key={person.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.5rem", background: "var(--layer-2)", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <span style={{ "--participant": person.avatar_color, width: 32, height: 32, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 13, background: "var(--participant)" }}>{person.initials}</span>
                    <div style={{ display: "flex", flexDirection: "column" }}><b style={{ fontSize: "0.85rem" }}>{person.full_name}</b><small style={{ fontSize: "0.7rem", opacity: 0.7 }}>{person.title}</small></div>
                  </div>
                  {invitedUsers.has(person.id) ? (
                    <span style={{ fontSize: "0.8rem", opacity: 0.7, padding: "0.25rem 0.5rem" }}>Invite sent</span>
                  ) : (
                    <button
                      className="button button-primary"
                      style={{ padding: "0.25rem 0.75rem", fontSize: "0.8rem", height: "auto" }}
                      onClick={() => invitePerson(person)}
                      disabled={invitingUserId === person.id}
                    >
                      {invitingUserId === person.id ? "Inviting…" : "Invite"}
                    </button>
                  )}
                </div>
              ))}
              {people.filter((p) => p.id !== user.id && !allParticipants.some((ap) => ap.user?.id === p.id)).length === 0 && <p style={{ fontSize: "0.85rem", opacity: 0.7, textAlign: "center", padding: "2rem 0" }}>Everyone is already in the meeting.</p>}
            </div>
          </div> : panel === "people" ? <div className="meeting-people">
            <button className="button button-secondary meeting-invite-people-btn" onClick={() => setPanel("invite")} style={{ width: "100%", marginBottom: "1rem" }}>
              Invite people
            </button>
            {allParticipants.map((participant) => <div key={participant.socketId}><span style={{ "--participant": participant.user?.avatar_color }}>{participant.user?.initials}</span><div><b>{participant.user?.full_name}{participant.local ? " (You)" : ""}</b><small>{participant.user?.title}</small></div>{participant.raised && <Hand size={17} />}</div>)}
          </div> : <><div className="meeting-chat">
            {chat.map((item) => <article key={item.id} className={item.sender_id === user.id ? "mine" : ""}><header><b>{item.sender_name}</b><time>{new Date(item.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></header><p><MeetingChatBody body={item.body} /></p></article>)}
            {!chat.length && <div className="meeting-chat-empty"><MessageSquareText size={25} /><p>Messages sent during this meeting appear here.</p></div>}
            <div ref={chatBottomRef} />
          </div><form className="meeting-chat-composer" onSubmit={sendChat}><input value={chatMessage} onChange={(event) => setChatMessage(event.target.value)} placeholder="Message everyone" /><button><Send size={17} /></button></form></>}
        </aside>}
      </main>
      <footer className={`meeting-controls ${isOrganizer ? "organizer-controls" : ""}`}>
        <div className="meeting-info"><span>{allParticipants.length}</span><small>participants</small></div>
        <div className="meeting-main-controls">
          <MeetingControl active={!micOn} onClick={toggleMic} icon={micOn ? Mic : MicOff} label={micOn ? "Mute" : "Unmute"} />
          {isAudioOnly && <MeetingControl active={!speakerOn} onClick={() => setSpeakerOn((enabled) => !enabled)} icon={speakerOn ? Volume2 : VolumeX} label={speakerOn ? "Speaker" : "Sound off"} />}
          {!isAudioOnly && <MeetingControl active={!cameraOn} onClick={toggleCamera} icon={cameraOn ? Video : VideoOff} label={cameraOn ? "Camera" : "Start video"} />}
          {!isAudioOnly && <MeetingControl active={screenOn} onClick={shareScreen} icon={MonitorUp} label={screenOn ? "Stop sharing" : "Share screen"} />}
          <MeetingControl active={raised} onClick={toggleHand} icon={Hand} label={raised ? "Lower hand" : "Raise hand"} />
          <MeetingControl active={panel === "chat"} onClick={() => setPanel(panel === "chat" ? null : "chat")} icon={MessageSquareText} label="Chat" />
          <MeetingControl active={panel === "people"} onClick={() => setPanel(panel === "people" ? null : "people")} icon={Users} label="People" />
          <MeetingControl onClick={() => document.documentElement.requestFullscreen?.()} icon={Expand} label="Full screen" />
        </div>
        <div className="meeting-exit-actions desktop-leave"><button className="leave-meeting" onClick={handleLeaveCall}><PhoneOff size={18} /><span>{isDirectCall ? "End call" : "Leave"}</span></button>{isOrganizer && <button className="end-meeting-for-all" onClick={() => setConfirmEnd(true)}><PhoneOff size={18} /><span>End for all</span></button>}</div>
      </footer>
      {meetingChatPopup && <button className="meeting-chat-popup" onClick={() => { setPanel("chat"); setMeetingChatPopup(null); }}>
        <span><MessageSquareText size={18} /></span><div><b>{meetingChatPopup.sender_name}</b><p>{meetingChatPopup.body}</p></div><small>Open chat</small>
      </button>}
      {confirmEnd && <Modal title="End meeting for everyone?" subtitle={meeting.title} onClose={() => !ending && setConfirmEnd(false)}><div className="end-meeting-confirm"><PhoneOff size={28} /><h3>Everyone will be disconnected</h3><p>Participants will not be able to rejoin this meeting after you end it.</p><div className="modal-actions"><button className="button button-secondary" onClick={() => setConfirmEnd(false)} disabled={ending}>Keep meeting open</button><button className="button button-danger" onClick={endForEveryone} disabled={ending}><PhoneOff size={16} /> {ending ? "Ending…" : "End for everyone"}</button></div></div></Modal>}
    </div>
  );
}

function MeetingControl({ active, onClick, icon: Icon, label }) {
  return <button className={active ? "active" : ""} onClick={onClick}><span><Icon size={20} /></span><small>{label}</small></button>;
}

function VideoTile({ participant, localVideoRef, cameraOn, speakerOn }) {
  const remoteVideoRef = useRef();
  const videoRef = localVideoRef || remoteVideoRef;
  const [soundBlocked, setSoundBlocked] = useState(false);

  function resumePlayback() {
    if (!videoRef.current) return;
    videoRef.current.play()
      .then(() => setSoundBlocked(false))
      .catch(() => {
        if (!participant.local && speakerOn) setSoundBlocked(true);
      });
  }

  useEffect(() => {
    if (!videoRef.current || !participant.stream) return;
    videoRef.current.srcObject = participant.stream;
    resumePlayback();
  }, [participant.stream, speakerOn]);
  const hasVideo = cameraOn && participant.stream?.getVideoTracks().some((track) => track.enabled && track.readyState === "live");
  return <article className="meeting-tile">
    <video ref={videoRef} autoPlay playsInline muted={participant.local || !speakerOn} />
    {soundBlocked && <button className="meeting-enable-audio" onClick={resumePlayback}><Volume2 size={18} /> Tap to enable sound</button>}
    {!hasVideo && <div className="meeting-avatar" style={{ "--participant": participant.user?.avatar_color }}><span>{participant.user?.initials || "?"}</span></div>}
    {participant.raised && <span className="raised-hand"><Hand size={16} /> Hand raised</span>}
    <footer><b>{participant.user?.full_name || (participant.local ? "You" : "Connecting…")}{participant.local ? " (You)" : ""}</b>{participant.local && !participant.stream && <small>No media access</small>}</footer>
  </article>;
}

function MeetingChatBody({ body }) {
  const parts = String(body || "").split(/(https?:\/\/[^\s]+)/g);
  return parts.map((part, index) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          className="message-link"
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          key={`${part}-${index}`}
        >
          {part}
        </a>
      );
    }
    return part;
  });
}
