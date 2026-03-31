import React, { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, MessageCircle, Phone, Video, X, Mic, MicOff, Video as VideoIcon, VideoOff, Send, ArrowLeft } from "lucide-react";
import Peer from "simple-peer";
import { cn } from "./lib/utils";

// --- Types ---
type View = "landing" | "connect" | "dashboard" | "chat" | "call";
type CallType = "voice" | "video";

interface Message {
  id: string;
  text: string;
  sender: string;
  timestamp: number;
}

// --- Main App Component ---
export default function App() {
  const [view, setView] = useState<View>("landing");
  const [pin, setPin] = useState("");
  const [isCreator, setIsCreator] = useState(false);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [incomingCall, setIncomingCall] = useState<{ from: string; offer: any; type: CallType } | null>(null);
  const [activeCall, setActiveCall] = useState<{ type: CallType; peer: Peer.Instance | null } | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    ringtoneRef.current = new Audio("https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3");
    ringtoneRef.current.loop = true;

    socketRef.current = io();

    socketRef.current.on("room-created", (createdPin) => {
      setPin(createdPin);
      setView("connect");
    });

    socketRef.current.on("user-connected", ({ pin: roomPin }) => {
      setPin(roomPin);
      setConnected(true);
      setView("dashboard");
    });

    socketRef.current.on("receive-message", (msg) => {
      setMessages((prev) => [...prev, { ...msg, id: Math.random().toString() }]);
    });

    socketRef.current.on("incoming-call", (data) => {
      setIncomingCall(data);
      ringtoneRef.current?.play().catch(e => console.log("Audio play failed", e));
    });

    socketRef.current.on("call-ended", () => {
      endCall();
    });

    socketRef.current.on("error", (msg) => {
      setError(msg);
      setTimeout(() => setError(null), 3000);
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, []);

  // --- Handlers ---
  const handleCreateConnection = () => {
    const newPin = Math.floor(100000 + Math.random() * 900000).toString();
    setIsCreator(true);
    socketRef.current?.emit("create-room", newPin);
  };

  const handleJoinConnection = (inputPin: string) => {
    setIsCreator(false);
    socketRef.current?.emit("join-room", inputPin);
  };

  const sendMessage = (text: string) => {
    if (!text.trim()) return;
    const msg = { pin, text, sender: socketRef.current?.id || "", timestamp: Date.now() };
    socketRef.current?.emit("send-message", msg);
    setMessages((prev) => [...prev, { ...msg, id: Math.random().toString() }]);
  };

  const initiateCall = async (type: CallType) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: type === "video",
        audio: true,
      });
      setLocalStream(stream);
      setActiveCall({ type, peer: null });
      setView("call");

      const peer = new Peer({
        initiator: true,
        trickle: false,
        stream,
      });

      peer.on("signal", (data) => {
        socketRef.current?.emit("call-user", { pin, offer: data, type });
      });

      peer.on("stream", (remoteStream) => {
        setRemoteStream(remoteStream);
      });

      socketRef.current?.on("call-accepted", (answer) => {
        peer.signal(answer);
      });

      setActiveCall({ type, peer });
    } catch (err) {
      console.error("Failed to get media stream", err);
    }
  };

  const acceptCall = async () => {
    if (!incomingCall) return;
    ringtoneRef.current?.pause();
    ringtoneRef.current!.currentTime = 0;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: incomingCall.type === "video",
        audio: true,
      });
      setLocalStream(stream);
      setView("call");
      setActiveCall({ type: incomingCall.type, peer: null });

      const peer = new Peer({
        initiator: false,
        trickle: false,
        stream,
      });

      peer.on("signal", (data) => {
        socketRef.current?.emit("answer-call", { pin, answer: data });
      });

      peer.on("stream", (remoteStream) => {
        setRemoteStream(remoteStream);
      });

      peer.signal(incomingCall.offer);
      setActiveCall({ type: incomingCall.type, peer });
      setIncomingCall(null);
    } catch (err) {
      console.error("Failed to accept call", err);
    }
  };

  const endCall = () => {
    ringtoneRef.current?.pause();
    ringtoneRef.current!.currentTime = 0;
    activeCall?.peer?.destroy();
    localStream?.getTracks().forEach((track) => track.stop());
    setLocalStream(null);
    setRemoteStream(null);
    setActiveCall(null);
    setIncomingCall(null);
    setView("dashboard");
    socketRef.current?.emit("end-call", pin);
  };

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks()[0].enabled = isMuted;
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStream && activeCall?.type === "video") {
      localStream.getVideoTracks()[0].enabled = isVideoOff;
      setIsVideoOff(!isVideoOff);
    }
  };

  // --- Render Helpers ---
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  return (
    <div className="min-h-screen bg-rose-50 text-rose-900 font-sans selection:bg-rose-200">
      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 bg-rose-600 text-white px-6 py-2 rounded-full shadow-lg z-50"
          >
            {error}
          </motion.div>
        )}

        {view === "landing" && (
          <motion.div
            key="landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center min-h-screen p-6 text-center"
          >
            <motion.div
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ repeat: Infinity, duration: 2 }}
              className="mb-8"
            >
              <Heart className="w-24 h-24 text-rose-500 fill-rose-500" />
            </motion.div>
            <h1 className="text-5xl font-bold mb-4 tracking-tight">Me and You</h1>
            <p className="text-rose-400 mb-12 max-w-xs">A private space for just the two of you. Secure, intimate, and always connected.</p>
            <button
              onClick={() => setView("connect")}
              className="bg-rose-500 hover:bg-rose-600 text-white px-10 py-4 rounded-2xl font-semibold text-lg shadow-xl shadow-rose-200 transition-all active:scale-95"
            >
              Connect with Her
            </button>
          </motion.div>
        )}

        {view === "connect" && (
          <motion.div
            key="connect"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex flex-col items-center justify-center min-h-screen p-6"
          >
            <div className="w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl shadow-rose-100">
              <button onClick={() => setView("landing")} className="mb-6 text-rose-400 hover:text-rose-600 flex items-center gap-2">
                <ArrowLeft size={20} /> Back
              </button>
              
              {!pin && !isCreator ? (
                <div className="space-y-6">
                  <h2 className="text-2xl font-bold text-center">Start Connection</h2>
                  <button
                    onClick={handleCreateConnection}
                    className="w-full bg-rose-500 text-white py-4 rounded-xl font-semibold shadow-lg hover:bg-rose-600 transition-colors"
                  >
                    Create New Connection
                  </button>
                  <div className="relative flex items-center py-2">
                    <div className="flex-grow border-t border-rose-100"></div>
                    <span className="flex-shrink mx-4 text-rose-300 text-sm">OR</span>
                    <div className="flex-grow border-t border-rose-100"></div>
                  </div>
                  <div className="space-y-4">
                    <input
                      type="text"
                      placeholder="Enter 6-digit PIN"
                      className="w-full px-4 py-4 rounded-xl border-2 border-rose-100 focus:border-rose-300 outline-none text-center text-2xl tracking-widest font-mono"
                      maxLength={6}
                      onChange={(e) => {
                        if (e.target.value.length === 6) {
                          handleJoinConnection(e.target.value);
                        }
                      }}
                    />
                    <p className="text-center text-sm text-rose-300">Enter the PIN shared by your partner</p>
                  </div>
                </div>
              ) : (
                <div className="text-center space-y-8">
                  <h2 className="text-2xl font-bold">Your Connection PIN</h2>
                  <div className="text-6xl font-bold tracking-tighter text-rose-500 font-mono bg-rose-50 py-8 rounded-2xl">
                    {pin}
                  </div>
                  <div className="space-y-2">
                    <p className="text-rose-400">Waiting for your partner to join...</p>
                    <div className="flex justify-center gap-1">
                      <motion.div animate={{ opacity: [0, 1, 0] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0 }} className="w-2 h-2 bg-rose-300 rounded-full" />
                      <motion.div animate={{ opacity: [0, 1, 0] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.2 }} className="w-2 h-2 bg-rose-300 rounded-full" />
                      <motion.div animate={{ opacity: [0, 1, 0] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.4 }} className="w-2 h-2 bg-rose-300 rounded-full" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {view === "dashboard" && (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col min-h-screen"
          >
            <header className="p-6 flex items-center justify-between bg-white/50 backdrop-blur-md sticky top-0 z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-rose-500 rounded-full flex items-center justify-center text-white">
                  <Heart size={20} fill="currentColor" />
                </div>
                <div>
                  <h2 className="font-bold">Me and You</h2>
                  <p className="text-xs text-rose-400 flex items-center gap-1">
                    <span className="w-2 h-2 bg-green-500 rounded-full" /> Connected ❤️
                  </p>
                </div>
              </div>
              <button 
                onClick={() => {
                  socketRef.current?.disconnect();
                  window.location.reload();
                }}
                className="text-rose-300 hover:text-rose-500"
              >
                <X size={24} />
              </button>
            </header>

            <main className="flex-grow flex flex-col items-center justify-center p-6 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-2xl">
                <DashboardCard
                  icon={<MessageCircle size={32} />}
                  label="Chat"
                  onClick={() => setView("chat")}
                  color="bg-blue-500"
                />
                <DashboardCard
                  icon={<Phone size={32} />}
                  label="Voice Call"
                  onClick={() => initiateCall("voice")}
                  color="bg-green-500"
                />
                <DashboardCard
                  icon={<Video size={32} />}
                  label="Video Call"
                  onClick={() => initiateCall("video")}
                  color="bg-purple-500"
                />
              </div>
            </main>
          </motion.div>
        )}

        {view === "chat" && (
          <motion.div
            key="chat"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="flex flex-col h-screen bg-white"
          >
            <header className="p-4 border-b flex items-center gap-4">
              <button onClick={() => setView("dashboard")} className="text-rose-400">
                <ArrowLeft size={24} />
              </button>
              <h2 className="font-bold">Private Chat</h2>
            </header>
            
            <div className="flex-grow overflow-y-auto p-4 space-y-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "flex flex-col max-w-[80%]",
                    msg.sender === socketRef.current?.id ? "ml-auto items-end" : "mr-auto items-start"
                  )}
                >
                  <div
                    className={cn(
                      "px-4 py-2 rounded-2xl text-sm",
                      msg.sender === socketRef.current?.id
                        ? "bg-rose-500 text-white rounded-tr-none"
                        : "bg-rose-50 text-rose-900 rounded-tl-none"
                    )}
                  >
                    {msg.text}
                  </div>
                  <span className="text-[10px] text-rose-300 mt-1">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const input = e.currentTarget.elements.namedItem("message") as HTMLInputElement;
                sendMessage(input.value);
                input.value = "";
              }}
              className="p-4 border-t flex gap-2"
            >
              <input
                name="message"
                type="text"
                placeholder="Type a message..."
                className="flex-grow px-4 py-2 rounded-full bg-rose-50 border-none focus:ring-2 focus:ring-rose-200 outline-none"
              />
              <button type="submit" className="bg-rose-500 text-white p-2 rounded-full">
                <Send size={20} />
              </button>
            </form>
          </motion.div>
        )}

        {view === "call" && (
          <motion.div
            key="call"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 bg-rose-950 z-50 flex flex-col items-center justify-center"
          >
            {activeCall?.type === "video" ? (
              <div className="relative w-full h-full">
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-6 right-6 w-32 h-48 bg-black rounded-xl overflow-hidden shadow-2xl border-2 border-white/20">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center space-y-8">
                <motion.div
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="w-32 h-32 bg-rose-500 rounded-full flex items-center justify-center text-white shadow-2xl shadow-rose-500/50"
                >
                  <Phone size={48} />
                </motion.div>
                <div className="text-center">
                  <h2 className="text-2xl font-bold text-white">Voice Call</h2>
                  <p className="text-rose-300">Connected</p>
                </div>
                <audio ref={remoteVideoRef} autoPlay />
              </div>
            )}

            <div className="absolute bottom-12 flex items-center gap-6">
              <button
                onClick={toggleMute}
                className={cn(
                  "p-4 rounded-full transition-colors",
                  isMuted ? "bg-rose-600 text-white" : "bg-white/10 text-white hover:bg-white/20"
                )}
              >
                {isMuted ? <MicOff /> : <Mic />}
              </button>
              
              <button
                onClick={endCall}
                className="p-6 bg-red-500 text-white rounded-full shadow-xl shadow-red-500/30 hover:bg-red-600 transition-all active:scale-90"
              >
                <X size={32} />
              </button>

              {activeCall?.type === "video" && (
                <button
                  onClick={toggleVideo}
                  className={cn(
                    "p-4 rounded-full transition-colors",
                    isVideoOff ? "bg-rose-600 text-white" : "bg-white/10 text-white hover:bg-white/20"
                  )}
                >
                  {isVideoOff ? <VideoOff /> : <VideoIcon />}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Incoming Call Modal */}
      <AnimatePresence>
        {incomingCall && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 100 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 100 }}
            className="fixed bottom-8 left-4 right-4 md:left-auto md:right-8 md:w-80 bg-white rounded-3xl p-6 shadow-2xl z-[60] border-2 border-rose-100"
          >
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center text-rose-500">
                {incomingCall.type === "video" ? <Video size={32} /> : <Phone size={32} />}
              </div>
              <div>
                <h3 className="font-bold text-lg">Incoming {incomingCall.type} Call</h3>
                <p className="text-rose-400 text-sm">Your partner wants to connect</p>
              </div>
              <div className="flex gap-4 w-full">
                <button
                  onClick={() => setIncomingCall(null)}
                  className="flex-1 py-3 rounded-xl bg-rose-50 text-rose-500 font-semibold hover:bg-rose-100 transition-colors"
                >
                  Decline
                </button>
                <button
                  onClick={acceptCall}
                  className="flex-1 py-3 rounded-xl bg-rose-500 text-white font-semibold shadow-lg shadow-rose-200 hover:bg-rose-600 transition-colors"
                >
                  Accept
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DashboardCard({ icon, label, onClick, color }: { icon: React.ReactNode; label: string; onClick: () => void; color: string }) {
  return (
    <button
      onClick={onClick}
      className="bg-white p-8 rounded-3xl shadow-xl shadow-rose-100 flex flex-col items-center justify-center gap-4 hover:scale-105 transition-transform active:scale-95 group"
    >
      <div className={cn("p-4 rounded-2xl text-white shadow-lg group-hover:rotate-6 transition-transform", color)}>
        {icon}
      </div>
      <span className="font-bold text-rose-900">{label}</span>
    </button>
  );
}
