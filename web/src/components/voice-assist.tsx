"use client";

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
};
type Transcription = { text: string; language: string; locale: string; detail?: string };

function numberWord(number: number): string {
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  return words[number] ?? String(number);
}

function spokenStepLabel(number: number, locale: string): string {
  const language = locale.toLowerCase().split("-")[0];
  if (language === "ta") {
    const labels = ["", "முதல் படி", "இரண்டாவது படி", "மூன்றாவது படி", "நான்காவது படி", "ஐந்தாவது படி"];
    return labels[number] ?? `${number}வது படி`;
  }
  if (language === "hi") {
    const labels = ["", "पहला कदम", "दूसरा कदम", "तीसरा कदम", "चौथा कदम", "पाँचवाँ कदम"];
    return labels[number] ?? `${number}वाँ कदम`;
  }
  return `Step ${numberWord(number)}`;
}

function makeSpeechFriendly(text: string, locale: string): string {
  return text
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*([^]*?)\*\*/g, "$1")
    .replace(/\*([^]*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*(\d+)[.)]\s+/gm, (_match, value: string) => `${spokenStepLabel(Number(value), locale)}: `)
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n{2,}/g, "\n");
}

function splitSpeechText(text: string, locale: string, maxChunkLength = 220): string[] {
  const speechText = makeSpeechFriendly(text, locale);
  const sentences = speechText.match(/[^.!?।॥\n]+[.!?।॥]?/gu) ?? [speechText];
  const chunks: string[] = [];
  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/);
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > maxChunkLength && current) {
        chunks.push(current);
        current = word;
      } else {
        current = next;
      }
    }
    if (current) chunks.push(current);
  }
  return chunks.filter(Boolean);
}
const initialMessages: ChatMessage[] = [
  { id: 1, role: "assistant", content: "Ask me about this asset by speaking." },
];

export function VoiceAssist({ context }: { context: AssistContext }) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const speechStartedRef = useRef(false);
  const silenceFramesRef = useRef(0);
  const noSpeechFramesRef = useRef(0);
  const discardRecordingRef = useRef(false);
  const voiceSessionActiveRef = useRef(false);
  const pauseListeningRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>(initialMessages);
  const nextIdRef = useRef(2);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [voiceSessionActive, setVoiceSessionActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Speak in any language. I will detect it and reply aloud.");
  const [provider, setProvider] = useState("local");

  useEffect(() => {
    return () => {
      voiceSessionActiveRef.current = false;
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void audioContextRef.current?.close();
      window.speechSynthesis?.cancel();
    };
  }, []);

  const stopRecording = (discard = false) => {
    discardRecordingRef.current = discard;
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  const startVoiceSession = async () => {
    voiceSessionActiveRef.current = true;
    setVoiceSessionActive(true);
    setVoiceStatus("Starting voice chat...");
    await startRecording();
  };

  const endVoiceSession = () => {
    voiceSessionActiveRef.current = false;
    setVoiceSessionActive(false);
    pauseListeningRef.current = false;
    stopRecording(true);
    window.speechSynthesis?.cancel();
    setVoiceStatus("Voice chat ended.");
  };

  const transcribeAndAsk = async (recordingBlob: Blob) => {
    setBusy(true);
    setVoiceStatus("Detecting language and transcribing...");
    try {
      const form = new FormData();
      form.append("audio", recordingBlob, recordingBlob.type.includes("mp4") ? "question.mp4" : "question.webm");
      const response = await fetch("/api/assist/transcribe", { method: "POST", body: form });
      const transcription = (await response.json()) as Transcription;
      if (!response.ok || !transcription.text) {
        throw new Error(transcription.detail ?? "Could not understand the recording. Try again.");
      }
      setVoiceStatus(`Detected ${transcription.language}. Asking Rise Assist...`);
      await sendMessage(transcription.text, transcription.locale, true, transcription.language);
    } catch (error) {
      setVoiceStatus(error instanceof Error ? error.message : "Voice transcription failed. Try typing instead.");
      setBusy(false);
      if (voiceSessionActiveRef.current) {
        window.setTimeout(() => {
          if (voiceSessionActiveRef.current) void startRecording();
        }, 700);
      }
    }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setVoiceStatus("Voice recording is not supported in this browser. Type your question instead.");
      return;
    }
    let audioContext: AudioContext | null = null;
    try {
      setVoiceStatus("Requesting microphone access...");
      audioContext = new AudioContext();
      await audioContext.resume();
      audioContextRef.current = audioContext;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioChunksRef.current = [];
      speechStartedRef.current = false;
      silenceFramesRef.current = 0;
      noSpeechFramesRef.current = 0;
      discardRecordingRef.current = false;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        audioChunksRef.current = [];
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        void audioContextRef.current?.close();
        audioContextRef.current = null;
        if (discardRecordingRef.current) {
          if (voiceSessionActiveRef.current && !pauseListeningRef.current) {
            setVoiceStatus("No speech detected. Listening again...");
            window.setTimeout(() => {
              if (voiceSessionActiveRef.current) void startRecording();
            }, 350);
          }
          return;
        }
        if (blob.size > 0) void transcribeAndAsk(blob);
        else if (voiceSessionActiveRef.current) {
          setVoiceStatus("No audio captured. Listening again...");
          window.setTimeout(() => {
            if (voiceSessionActiveRef.current) void startRecording();
          }, 350);
        } else setVoiceStatus("No audio was captured. Check microphone permission and try again.");
      };
      recorder.onerror = () => {
        setVoiceStatus("Microphone recording failed. Check permission and try again.");
        stopRecording(true);
      };
      recorder.start(250);
      setVoiceStatus("Listening. Speak naturally, then pause for a reply.");

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const monitorSilence = () => {
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
        if (rms > 0.012) {
          speechStartedRef.current = true;
          silenceFramesRef.current = 0;
          setVoiceStatus("Listening to you...");
        } else if (speechStartedRef.current) {
          silenceFramesRef.current += 1;
          if (silenceFramesRef.current >= 90) {
            setVoiceStatus("Thinking...");
            stopRecording();
            return;
          }
        } else {
          noSpeechFramesRef.current += 1;
          if (noSpeechFramesRef.current >= 900) {
            stopRecording(true);
            return;
          }
        }
        animationFrameRef.current = requestAnimationFrame(monitorSilence);
      };
      animationFrameRef.current = requestAnimationFrame(monitorSilence);
    } catch (error) {
      if (audioContext && audioContext.state !== "closed") await audioContext.close();
      audioContextRef.current = null;
      const name = error instanceof DOMException ? error.name : "";
      if (voiceSessionActiveRef.current) voiceSessionActiveRef.current = false;
      setVoiceSessionActive(false);
      setVoiceStatus(name === "NotAllowedError"
        ? "Microphone permission denied. Allow access in browser settings and retry."
        : "Could not open the microphone. Check that one is connected and enabled.");
    }
  };

  const speakReply = (text: string, locale: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setVoiceStatus("Reply is ready, but speech playback is not supported in this browser.");
      return;
    }
    window.speechSynthesis.cancel();
    const voices = window.speechSynthesis.getVoices();
    const normalizedLocale = locale.toLowerCase();
    const languageCode = normalizedLocale.split("-")[0];
    const voice = voices.find((item) => item.lang.toLowerCase() === normalizedLocale)
      ?? voices.find((item) => item.lang.toLowerCase().split("-")[0] === languageCode)
      ?? null;
    const chunks = splitSpeechText(text, locale);
    chunks.forEach((chunk, index) => {
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.lang = locale;
      utterance.voice = voice;
      utterance.onstart = () => setVoiceStatus(`Speaking (${index + 1}/${chunks.length})...`);
      if (index === chunks.length - 1) {
        utterance.onend = () => {
          if (!voiceSessionActiveRef.current) {
            setVoiceStatus("Voice reply finished.");
            return;
          }
          pauseListeningRef.current = false;
          setVoiceStatus("Listening again. You can respond when ready.");
          window.setTimeout(() => {
            if (voiceSessionActiveRef.current) void startRecording();
          }, 500);
        };
      }
      utterance.onerror = () => {
        if (index === chunks.length - 1 && voiceSessionActiveRef.current) {
          pauseListeningRef.current = false;
          setVoiceStatus("Could not finish reading the reply. Listening again...");
          window.setTimeout(() => {
            if (voiceSessionActiveRef.current) void startRecording();
          }, 500);
        }
      };
      window.speechSynthesis.speak(utterance);
    });
    setVoiceStatus(`Replying aloud in ${locale}...`);
  };

  const sendMessage = async (
    text: string,
    responseLanguage: string,
    spoken: boolean,
    detectedLanguage?: string,
  ) => {
    const userMessage: ChatMessage = {
      id: nextIdRef.current++,
      role: "user",
      content: text,
      input: spoken ? "voice" : "text",
      language: detectedLanguage,
    };
    const conversation = [...messagesRef.current, userMessage];
    messagesRef.current = conversation;
    setMessages(conversation);
    setDraft("");
    setBusy(true);
    setVoiceStatus(spoken ? "Thinking..." : "Rise Assist is preparing a response...");
    try {
      const response = await fetch("/api/assist/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: conversation.slice(-20).map(({ role, content }) => ({ role, content })),
          context,
          responseLanguage,
          responseStyle: spoken || voiceSessionActive || voiceSessionActiveRef.current ? "spoken" : "text",
        }),
      });
      const result = (await response.json()) as { reply?: string; provider?: string; locale?: string; detail?: string };
      if (!response.ok || !result.reply) throw new Error(result.detail ?? "Rise Assist is unavailable.");
      setProvider(result.provider ?? "local");
      const reply = result.reply;
      const assistantMessage: ChatMessage = { id: nextIdRef.current++, role: "assistant", content: reply };
      messagesRef.current = [...messagesRef.current, assistantMessage];
      setMessages(messagesRef.current);
      const sessionIsActive = voiceSessionActive || voiceSessionActiveRef.current;
      const shouldSpeakReply = spoken || sessionIsActive;
      if (shouldSpeakReply) {
        speakReply(reply, result.provider === "openai" ? result.locale ?? responseLanguage : "en-US");
      }
      else setVoiceStatus(result.provider === "openai" ? "Reply ready." : "Local playbook reply is in English.");
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: nextIdRef.current++,
        role: "assistant",
        content: error instanceof Error ? error.message : "Could not reach Rise Assist.",
      };
      messagesRef.current = [...messagesRef.current, errorMessage];
      setMessages(messagesRef.current);
      const sessionIsActive = voiceSessionActive || voiceSessionActiveRef.current;
      setVoiceStatus(sessionIsActive
        ? "Could not get a reply. Listening again..."
        : "Assistant request failed. Check the connection and try again.");
      if (sessionIsActive) {
        pauseListeningRef.current = false;
        window.setTimeout(() => {
          if (voiceSessionActiveRef.current) void startRecording();
        }, 500);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitTypedMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (text && !busy) {
      if (voiceSessionActive || voiceSessionActiveRef.current) {
        pauseListeningRef.current = true;
        if (recorderRef.current?.state === "recording") stopRecording(true);
      }
      void sendMessage(text, "auto", false);
    }
  };

  return (
    <section className="tool-panel assist-tool" aria-labelledby="voice-assist-title">
      <div className="tool-heading">
        <div>
          <span className="eyebrow dark">ASSET ASSISTANCE</span>
          <h3 id="voice-assist-title">Ask about {context.assetId}</h3>
        </div>
        <span className={`provider-badge ${provider}`}><span />{provider === "openai" ? "Connected" : provider === "local-fallback" ? "Fallback" : "Local"}</span>
      </div>
      <p className="assist-context">{context.site} · {context.issue}</p>
      <p className="voice-language-hint">Start voice chat once. Rise listens, replies aloud in your language, then listens again.</p>
      <div className="chat-stream" role="log" aria-live="polite" aria-relevant="additions text">
        {messages.map((message) => (
          <article key={message.id} className={`chat-message ${message.role}`}>
            <span>{message.role === "assistant" ? "RISE" : "YOU"}</span>
            {message.role === "user" && (
              <small className="message-input-kind">
                {message.input === "voice" ? `Voice · ${message.language ?? "language detected"}` : "Typed"}
              </small>
            )}
            <p>{message.content}</p>
          </article>
        ))}
        {busy && <p className="chat-pending" role="status">Working...</p>}
      </div>
      <div className="voice-controls">
        <button className={`button ${voiceSessionActive ? "recording" : "primary"}`} type="button" onClick={() => voiceSessionActive ? endVoiceSession() : void startVoiceSession()} disabled={busy && !voiceSessionActive}>
          <span className="mic-indicator" />{voiceSessionActive ? "End voice chat" : "Start voice chat"}
        </button>
        <span className="voice-status" role="status">{voiceStatus}</span>
      </div>
      <form className="chat-composer" onSubmit={submitTypedMessage}>
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Or type a question..." aria-label="Type a question for Rise Assist" rows={2} maxLength={2000} />
        <div className="composer-actions">
          <span className="voice-status">Typed replies are text unless voice chat is active.</span>
          <button className="button secondary small" type="submit" disabled={busy || !draft.trim()}>{busy ? "Sending..." : "Send"}</button>
        </div>
      </form>
      <p className="assist-disclaimer">Decision support only. Follow site isolation, OEM, and approved safety procedures.</p>
    </section>
  );
}
