"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";

type AssistContext = {
  assetId: string;
  site: string;
  issue: string;
  description: string;
  severity: string;
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  input?: "voice" | "text";
  language?: string;
  attachmentPreview?: string;
};

type PendingImage = { name: string; dataUrl: string };

const MAX_IMAGE_FILE_SIZE = 10 * 1024 * 1024;
const MAX_IMAGE_PAYLOAD_SIZE = 40 * 1024;

function encodeCanvasImage(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not prepare this image. Try another photo."));
    }, "image/jpeg", quality);
  });
}

async function prepareImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
  if (file.size > MAX_IMAGE_FILE_SIZE) throw new Error("Choose an image smaller than 10 MB.");

  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not prepare this image. Try another photo.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      for (const quality of [0.76, 0.6, 0.46, 0.32, 0.22]) {
        const blob = await encodeCanvasImage(canvas, quality);
        if (blob.size <= MAX_IMAGE_PAYLOAD_SIZE) {
          return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read the prepared image."));
            reader.onerror = () => reject(new Error("Could not read the prepared image."));
            reader.readAsDataURL(blob);
          });
        }
      }
      throw new Error("This image is still too large after compression. Choose a smaller photo.");
    } finally {
      bitmap.close();
    }
  }

  if (file.size > MAX_IMAGE_PAYLOAD_SIZE) throw new Error("This browser cannot compress the image. Choose one smaller than 900 KB.");
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read the image."));
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}

type RealtimeEvent = {
  type?: string;
  event_id?: string;
  error?: { message?: string; code?: string };
  item_id?: string;
  transcript?: string;
  response?: {
    id?: string;
    status?: string;
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; transcript?: string; text?: string }>;
    }>;
  };
};

type EphemeralSession = { clientSecret: string; sessionId: string; detail?: string };

const initialMessages: ChatMessage[] = [
  { id: 1, role: "assistant", content: "Ask me about this asset by speaking or typing." },
];

function localeFromScript(text: string): string | undefined {
  const ranges: Array<[string, number, number]> = [
    ["ta-IN", 0x0b80, 0x0bff], ["hi-IN", 0x0900, 0x097f], ["bn-IN", 0x0980, 0x09ff],
    ["pa-IN", 0x0a00, 0x0a7f], ["gu-IN", 0x0a80, 0x0aff], ["or-IN", 0x0b00, 0x0b7f],
    ["te-IN", 0x0c00, 0x0c7f], ["kn-IN", 0x0c80, 0x0cff], ["ml-IN", 0x0d00, 0x0d7f],
  ];
  for (const [locale, start, end] of ranges) {
    if (Array.from(text).some((character) => start <= character.codePointAt(0)! && character.codePointAt(0)! <= end)) return locale;
  }
  return undefined;
}

export function RealtimeAssist({ context }: { context: AssistContext }) {
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const microphoneRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const messagesRef = useRef<ChatMessage[]>(initialMessages);
  const nextIdRef = useRef(2);
  const seenInputItemsRef = useRef<Set<string>>(new Set());
  const seenOutputResponsesRef = useRef<Set<string>>(new Set());
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [preparingImage, setPreparingImage] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Start live voice for a natural, hands-free conversation.");
  const [provider, setProvider] = useState("realtime");

  const addMessage = (message: Omit<ChatMessage, "id">) => {
    const entry: ChatMessage = { id: nextIdRef.current++, ...message };
    messagesRef.current = [...messagesRef.current, entry];
    setMessages(messagesRef.current);
  };

  const closeSession = () => {
    channelRef.current?.close();
    channelRef.current = null;
    microphoneRef.current?.getTracks().forEach((track) => track.stop());
    microphoneRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    setActive(false);
    setConnecting(false);
  };

  useEffect(() => () => {
    channelRef.current?.close();
    microphoneRef.current?.getTracks().forEach((track) => track.stop());
    peerRef.current?.close();
    if (audioRef.current) audioRef.current.srcObject = null;
  }, []);

  const handleRealtimeEvent = (event: RealtimeEvent) => {
    if (!event.type) return;
    if (event.type === "session.created" || event.type === "session.updated") {
      setActive(true);
      setConnecting(false);
      setStatus("Live voice connected. Speak naturally; you can interrupt the assistant.");
      return;
    }
    if (event.type === "input_audio_buffer.speech_started") {
      setStatus("Listening to you...");
      return;
    }
    if (event.type === "input_audio_buffer.speech_stopped") {
      setStatus("Thinking...");
      return;
    }
    if (event.type === "conversation.item.input_audio_transcription.completed") {
      const key = event.item_id ?? `${event.type}:${event.transcript}`;
      if (event.transcript && !seenInputItemsRef.current.has(key)) {
        seenInputItemsRef.current.add(key);
        addMessage({ role: "user", content: event.transcript, input: "voice", language: localeFromScript(event.transcript) });
      }
      return;
    }
    if (event.type === "response.output_audio_transcript.done" || event.type === "response.audio_transcript.done") {
      const key = event.response?.id ?? `${event.type}:${event.transcript}`;
      if (event.transcript && !seenOutputResponsesRef.current.has(key)) {
        seenOutputResponsesRef.current.add(key);
        addMessage({ role: "assistant", content: event.transcript });
      }
      setStatus("Listening again. You can respond when ready.");
      return;
    }
    if (event.type === "response.done") {
      setBusy(false);
      setStatus("Listening again. You can respond when ready.");
      const responseId = event.response?.id;
      if (responseId && !seenOutputResponsesRef.current.has(responseId)) {
        const transcript = event.response?.output
          ?.flatMap((item) => item.content ?? [])
          .map((part) => part.transcript ?? part.text ?? "")
          .filter(Boolean)
          .join(" ");
        if (transcript) {
          seenOutputResponsesRef.current.add(responseId);
          addMessage({ role: "assistant", content: transcript });
        }
      }
      return;
    }
    if (event.type === "error") {
      setBusy(false);
      setStatus(event.error?.message ?? "Realtime voice reported an error.");
    }
  };

  const startLiveVoice = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      setStatus("This browser cannot start WebRTC voice. Use typed chat instead.");
      return;
    }
    setConnecting(true);
    setStatus("Connecting live voice...");
    try {
      const sessionResponse = await fetch("/api/assist/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context }),
      });
      const session = (await sessionResponse.json()) as EphemeralSession;
      if (!sessionResponse.ok || !session.clientSecret) {
        throw new Error(session.detail ?? "Could not create a secure Realtime session.");
      }

      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      peer.ontrack = (event) => {
        if (!audioRef.current) return;
        audioRef.current.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void audioRef.current.play().catch(() => {
          setStatus("Voice is connected. Tap play on the audio control to hear replies.");
        });
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
          setStatus("Live voice disconnected. Try ending and starting voice again.");
        }
      };

      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      microphoneRef.current = microphone;
      microphone.getAudioTracks().forEach((track) => peer.addTrack(track, microphone));

      const channel = peer.createDataChannel("oai-events");
      channelRef.current = channel;
      channel.onmessage = (message) => {
        try {
          handleRealtimeEvent(JSON.parse(message.data) as RealtimeEvent);
        } catch {
          setStatus("Received an unreadable Realtime event.");
        }
      };
      channel.onerror = () => setStatus("Realtime event channel had a connection error.");

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (peer.iceGatheringState !== "complete") {
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            peer.removeEventListener("icegatheringstatechange", onGathering);
            reject(new Error("Timed out connecting live voice."));
          }, 10000);
          const onGathering = () => {
            if (peer.iceGatheringState !== "complete") return;
            window.clearTimeout(timeout);
            peer.removeEventListener("icegatheringstatechange", onGathering);
            resolve();
          };
          peer.addEventListener("icegatheringstatechange", onGathering);
          onGathering();
        });
      }

      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new Error("Browser did not produce a WebRTC offer.");
      const answerResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.clientSecret}`,
          "Content-Type": "application/sdp",
        },
        body: sdp,
      });
      if (!answerResponse.ok) {
        const message = await answerResponse.text();
        throw new Error(`OpenAI Realtime connection failed (${answerResponse.status}): ${message.slice(0, 240)}`);
      }
      await peer.setRemoteDescription({ type: "answer", sdp: await answerResponse.text() });
      setStatus("Finishing live voice connection...");
    } catch (error) {
      closeSession();
      const name = error instanceof DOMException ? error.name : "";
      setStatus(name === "NotAllowedError"
        ? "Microphone permission denied. Allow microphone access and retry."
        : error instanceof Error ? error.message : "Realtime voice could not connect.");
    }
  };

  const endLiveVoice = () => {
    closeSession();
    setStatus("Live voice ended.");
  };

  const selectImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!active) {
      setStatus("Start a live voice session before sharing an image.");
      return;
    }

    setPreparingImage(true);
    setStatus("Preparing image...");
    try {
      const dataUrl = await prepareImage(file);
      setPendingImage({ name: file.name, dataUrl });
      setStatus("Image ready. Add a question or send it as-is.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not prepare this image.");
    } finally {
      setPreparingImage(false);
    }
  };

  const sendTypedMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if ((!text && !pendingImage) || busy || preparingImage) return;
    const channel = channelRef.current;
    if (pendingImage && (!active || channel?.readyState !== "open")) {
      setStatus("Reconnect live voice before sending this image.");
      return;
    }
    if (active && channel?.readyState === "open") {
      const content: Array<{ type: string; text?: string; image_url?: string; detail?: string }> = [];
      if (text) content.push({ type: "input_text", text });
      if (pendingImage) {
        content.push({
          type: "input_text",
          text: "Please describe only what is visibly present in this image. Treat it as evidence, not a confirmed diagnosis. Do not infer hidden faults or recommend hazardous work. Ask for a safe measurement or qualified inspection when needed.",
        });
        content.push({ type: "input_image", image_url: pendingImage.dataUrl, detail: "auto" });
      }
      const messageContent = text || "Shared an image for inspection.";
      try {
        channel.send(JSON.stringify({
          type: "conversation.item.create",
          item: { type: "message", role: "user", content },
        }));
        channel.send(JSON.stringify({ type: "response.create" }));
      } catch {
        setStatus("Could not send the image to the live session. Try a smaller photo.");
        return;
      }
      addMessage({ role: "user", content: messageContent, input: "text", attachmentPreview: pendingImage?.dataUrl });
      setDraft("");
      setPendingImage(null);
      setBusy(true);
      setStatus(pendingImage ? "Image sent. Rise Assist is checking what is visible..." : "Thinking...");
      return;
    }

    const userMessage: ChatMessage = { id: nextIdRef.current++, role: "user", content: text, input: "text" };
    const conversation = [...messagesRef.current, userMessage];
    messagesRef.current = conversation;
    setMessages(conversation);
    setDraft("");
    setBusy(true);
    setStatus("Rise Assist is preparing a response...");
    void fetch("/api/assist/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversation.slice(-20).map(({ role, content }) => ({ role, content })), context, responseLanguage: "auto", responseStyle: "text" }),
    }).then(async (response) => {
      const result = await response.json() as { reply?: string; detail?: string; provider?: string };
      if (!response.ok || !result.reply) throw new Error(result.detail ?? "Assistant unavailable.");
      const assistantMessage = { id: nextIdRef.current++, role: "assistant" as const, content: result.reply };
      messagesRef.current = [...messagesRef.current, assistantMessage];
      setMessages(messagesRef.current);
      setProvider(result.provider ?? "openai");
      setStatus("Reply ready.");
    }).catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : "Could not send your question.");
    }).finally(() => setBusy(false));
  };

  return (
    <section className="tool-panel assist-tool" aria-labelledby="voice-assist-title">
      <div className="tool-heading">
        <div>
          <span className="eyebrow dark">RISE ASSIST</span>
          <h3 id="voice-assist-title">Ask about {context.assetId}</h3>
        </div>
        <span className={`provider-badge ${provider}`}><span />{provider === "openai" ? "Realtime connected" : "Realtime voice"}</span>
      </div>
      <p className="assist-context">{context.site} · {context.issue}</p>
      <p className="voice-language-hint">Live voice-to-voice conversation. Speak naturally; Realtime detects your language and replies in voice.</p>
      <audio ref={audioRef} className="realtime-audio" autoPlay controls playsInline />
      <div className="chat-stream" role="log" aria-live="polite" aria-relevant="additions text">
        {messages.map((message) => (
          <article key={message.id} className={`chat-message ${message.role}`}>
            <span>{message.role === "assistant" ? "RISE" : "YOU"}</span>
            {message.role === "user" && <small className="message-input-kind">{message.input === "voice" ? `Voice${message.language ? ` · ${message.language}` : ""}` : "Typed"}</small>}
            {message.attachmentPreview && <Image className="chat-image-attachment" src={message.attachmentPreview} alt="Image shared with Rise Assist" width={480} height={360} unoptimized />}
            <p>{message.content}</p>
          </article>
        ))}
        {busy && <p className="chat-pending" role="status">Thinking...</p>}
      </div>
      <div className="voice-controls">
        <button className={`button ${active || connecting ? "recording" : "primary"}`} type="button" onClick={() => active || connecting ? endLiveVoice() : void startLiveVoice()} disabled={connecting}>
          <span className="mic-indicator" />{connecting ? "Connecting..." : active ? "End voice chat" : "Start live voice"}
        </button>
        <span className="voice-status" role="status">{status}</span>
      </div>
      <form className="chat-composer" onSubmit={sendTypedMessage}>
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Or type a question..." aria-label="Type a question for Rise Assist" rows={2} maxLength={2000} />
        {pendingImage && (
          <div className="image-attachment-preview">
            <Image src={pendingImage.dataUrl} alt="Selected image preview" width={88} height={88} unoptimized />
            <span>{pendingImage.name}</span>
            <button className="button secondary small" type="button" aria-label="Remove selected image" onClick={() => setPendingImage(null)}>Remove</button>
          </div>
        )}
        <div className="composer-actions">
          <div className="composer-tools">
            <label className={`button secondary small image-attach-button ${!active || preparingImage ? "disabled" : ""}`} title={active ? "Attach a photo to the live session" : "Start live voice to share an image"}>
              <input className="image-file-input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => void selectImage(event)} disabled={!active || busy || preparingImage} />
              {preparingImage ? "Preparing..." : "Attach image"}
            </label>
            <span className="voice-status">Images are sent to OpenAI for analysis. Avoid faces and confidential information.</span>
          </div>
          <button className="button secondary small" type="submit" disabled={busy || preparingImage || (!draft.trim() && !pendingImage) || Boolean(pendingImage && !active)}>{busy ? "Sending..." : pendingImage ? "Send image" : "Send"}</button>
        </div>
      </form>
      <p className="assist-disclaimer">Decision support only. Follow site isolation, OEM, and approved safety procedures.</p>
    </section>
  );
}
