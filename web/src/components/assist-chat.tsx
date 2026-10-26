"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type ChatRole = "user" | "assistant";
type ChatMessage = { id: number; role: ChatRole; content: string };
type AssistContext = {
  assetId: string;
  site: string;
  issue: string;
  description: string;
  severity: string;
};
type SpeechVoice = { name: string; lang: string };
type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechResultEvent = Event & { resultIndex: number; results: ArrayLike<SpeechResult> };
type BrowserRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionWindow = Window & {
  SpeechRecognition?: new () => BrowserRecognition;
  webkitSpeechRecognition?: new () => BrowserRecognition;
};

const quickPrompts = [
  "What should I inspect first?",
  "What readings should I capture?",
  "What safety checks apply?",
];

const speechLocales = [
  ["English (United States)", "en-US"],
  ["English (India)", "en-IN"],
  ["English (United Kingdom)", "en-GB"],
  ["Hindi", "hi-IN"],
  ["Tamil", "ta-IN"],
  ["Telugu", "te-IN"],
  ["Bengali", "bn-IN"],
  ["Kannada", "kn-IN"],
  ["Malayalam", "ml-IN"],
  ["Punjabi", "pa-IN"],
  ["Urdu", "ur-PK"],
  ["Spanish", "es-ES"],
  ["French", "fr-FR"],
  ["German", "de-DE"],
  ["Portuguese (Brazil)", "pt-BR"],
  ["Arabic", "ar-SA"],
  ["Mandarin Chinese", "zh-CN"],
  ["Japanese", "ja-JP"],
  ["Korean", "ko-KR"],
] as const;

export function AssistChat({ context }: { context: AssistContext }) {
  const recognitionRef = useRef<BrowserRecognition | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptBaseRef = useRef("");
  const speechErrorRef = useRef<string | null>(null);
  const receivedSpeechRef = useRef(false);
  const manualStopRef = useRef(false);
  const nextIdRef = useRef(2);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: "assistant",
      content: "I can help structure the next safe checks. Tell me what you observed or choose a prompt below.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechLanguage, setSpeechLanguage] = useState("en-US");
  const [customSpeechLanguage, setCustomSpeechLanguage] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechVoice[]>([]);
  const [voiceStatus, setVoiceStatus] = useState("Type a question or use voice input.");
  const [provider, setProvider] = useState("local");

  useEffect(() => {
    const speechWindow = window as RecognitionWindow;
    setVoiceSupported(Boolean(speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition));
    setSpeechSupported("speechSynthesis" in window);
    const loadVoices = () => {
      setAvailableVoices(window.speechSynthesis?.getVoices().map(({ name, lang }) => ({ name, lang })) ?? []);
    };
    loadVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", loadVoices);
    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      recognitionRef.current?.abort();
      window.speechSynthesis?.cancel();
      window.speechSynthesis?.removeEventListener("voiceschanged", loadVoices);
    };
  }, []);

  const startVoiceInput = () => {
    if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(speechLanguage)) {
      setVoiceStatus("Choose a language or enter a valid language tag first.");
      return;
    }
    const speechWindow = window as RecognitionWindow;
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceStatus("Voice input is not supported here. Type your question instead.");
      return;
    }

    const recognition = new Recognition();
    recognition.lang = speechLanguage;
    recognition.interimResults = true;
    recognition.continuous = true;
    transcriptBaseRef.current = draft.trim();
    speechErrorRef.current = null;
    receivedSpeechRef.current = false;
    manualStopRef.current = false;
    recognition.onresult = (event) => {
      const spoken = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(" ")
        .trim();
      receivedSpeechRef.current = Boolean(spoken);
      setDraft([transcriptBaseRef.current, spoken].filter(Boolean).join(" "));
      setVoiceStatus("Speech detected. Pausing will finish the transcript automatically.");
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        setVoiceStatus("Pause detected. Finishing transcript...");
        recognition.stop();
      }, 1400);
    };
    recognition.onerror = (event) => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
      const error = event.error ?? "unknown";
      speechErrorRef.current = error;
      setListening(false);
      const messages: Record<string, string> = {
        "not-allowed": "Microphone permission denied. Allow microphone access for this site in browser settings.",
        "service-not-allowed": "The browser blocked its speech service. Check microphone and speech-recognition permissions.",
        "audio-capture": "No microphone is available. Connect or enable a microphone, then try again.",
        network: "The browser speech service is unavailable on the network. Try again or type your question.",
        "language-not-supported": `${speechLanguage} is not supported by this browser's speech service. Choose another language.`,
        "no-speech": "No speech was detected. Check microphone input and try again.",
        aborted: "Voice capture was cancelled.",
      };
      setVoiceStatus(messages[error] ?? `Voice capture stopped (${error}). Try again or type your question.`);
    };
    recognition.onend = () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
      setListening(false);
      recognitionRef.current = null;
      if (!speechErrorRef.current) {
        if (receivedSpeechRef.current) {
          setVoiceStatus("Voice captured. Review the transcript, then send it.");
        } else if (!manualStopRef.current) {
          setVoiceStatus("Listening ended before speech was detected. Check microphone permission and input level.");
        }
      }
      manualStopRef.current = false;
    };

    try {
      recognitionRef.current = recognition;
      recognition.start();
      setListening(true);
      setVoiceStatus("Listening. Speak your question, then review the transcript.");
    } catch {
      setListening(false);
      setVoiceStatus("Could not start the microphone. Check browser permission.");
    }
  };

  const stopVoiceInput = () => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
    manualStopRef.current = true;
    recognitionRef.current?.stop();
    setListening(false);
  };

  const speakReply = (content: string, language = speechLanguage) => {
    if (!speechSupported) {
      setVoiceStatus("Speech playback is not supported in this browser.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.lang = language;
    const requestedLanguage = language.toLowerCase().split("-")[0];
    utterance.voice = window.speechSynthesis.getVoices().find(
      (voice) => voice.lang.toLowerCase().split("-")[0] === requestedLanguage,
    ) ?? null;
    window.speechSynthesis.speak(utterance);
    setVoiceStatus("Reading the reply aloud.");
  };

  const sendMessage = async (event?: FormEvent<HTMLFormElement>, quickText?: string) => {
    event?.preventDefault();
    const text = (quickText ?? draft).trim();
    if (!text || busy) return;
    if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(speechLanguage)) {
      setVoiceStatus("Choose a language or enter a valid language tag before sending.");
      return;
    }

    const userMessage: ChatMessage = { id: nextIdRef.current++, role: "user", content: text };
    const conversation = [...messages, userMessage];
    setMessages(conversation);
    setDraft("");
    setBusy(true);
    setVoiceStatus("Rise Assist is preparing a response...");

    try {
      const response = await fetch("/api/assist/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: conversation.slice(-20).map(({ role, content }) => ({ role, content })),
          context,
          responseLanguage: speechLanguage,
        }),
      });
      const result = (await response.json()) as { reply?: string; provider?: string; detail?: string };
      if (!response.ok || !result.reply) throw new Error(result.detail ?? "Rise Assist is unavailable");
      setProvider(result.provider ?? "local");
      const reply = result.reply ?? "No reply was returned.";
      setMessages((current) => [...current, {
        id: nextIdRef.current++,
        role: "assistant",
        content: reply,
      }]);
      if (autoSpeak) {
        speakReply(reply, result.provider === "openai" ? speechLanguage : "en-US");
      } else {
        setVoiceStatus(result.provider === "openai"
          ? "Reply ready in the selected language. Use Read aloud to hear it."
          : "Local playbook replies are in English. Configure the LLM for multilingual replies.");
      }
    } catch (error) {
      setMessages((current) => [...current, {
        id: nextIdRef.current++,
        role: "assistant",
        content: error instanceof Error ? error.message : "Could not reach Rise Assist.",
      }]);
      setVoiceStatus("Assistant connection failed. Check the Rise API.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="tool-panel assist-tool" aria-labelledby="assist-title">
      <div className="tool-heading">
        <div>
          <span className="eyebrow dark">Frontline copilot</span>
          <h3 id="assist-title">Rise Assist</h3>
        </div>
        <span className={`provider-badge ${provider}`}>
          <span /> {provider === "openai" ? "AI connected" : provider === "local-fallback" ? "Local fallback" : "Local playbook"}
        </span>
      </div>
      <p className="assist-context">
        {context.assetId} · {context.site} · {context.issue} · {context.severity}
      </p>
      <div className="speech-settings">
        <label className="speech-language-field" htmlFor="assist-language">
          <span>Speech language</span>
          <select
            id="assist-language"
            value={customSpeechLanguage ? "custom" : speechLanguage}
            onChange={(event) => {
              if (event.target.value === "custom") {
                setCustomSpeechLanguage(true);
                setSpeechLanguage("");
              } else {
                setCustomSpeechLanguage(false);
                setSpeechLanguage(event.target.value);
              }
            }}
            aria-describedby="assist-language-help"
          >
            {speechLocales.map(([label, locale]) => <option key={locale} value={locale}>{label} ({locale})</option>)}
            <option value="custom">Other language...</option>
          </select>
          {customSpeechLanguage && (
            <input
              id="assist-custom-language"
              value={speechLanguage}
              onChange={(event) => setSpeechLanguage(event.target.value.trim())}
              placeholder="Language tag, e.g. fr-CA"
              pattern="[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*"
              title="Enter a language tag such as fr-CA"
              aria-label="Custom speech language tag"
            />
          )}
          <small id="assist-language-help">This sets microphone recognition and the requested reply language. Browser support varies.</small>
        </label>
        {speechSupported && (
          <label className="speak-toggle">
            <input type="checkbox" checked={autoSpeak} onChange={(event) => setAutoSpeak(event.target.checked)} />
            <span>Speak replies</span>
          </label>
        )}
      </div>
      {speechLanguage && speechSupported && availableVoices.length > 0 && !availableVoices.some(
          (voice) => voice.lang.toLowerCase().split("-")[0] === speechLanguage.toLowerCase().split("-")[0],
      ) && (
        <p className="voice-availability" role="status">No installed speech voice matches {speechLanguage}; the browser default voice will be used.</p>
      )}
      <div className="chat-stream" role="log" aria-live="polite" aria-relevant="additions text">
        {messages.map((message) => (
          <article key={message.id} className={`chat-message ${message.role}`}>
            <span>{message.role === "assistant" ? "RISE ASSIST" : "YOU"}</span>
            <p>{message.content}</p>
            {message.role === "assistant" && speechSupported && (
              <button className="text-action" type="button" onClick={() => speakReply(message.content, provider === "openai" ? speechLanguage : "en-US")}>Read aloud</button>
            )}
          </article>
        ))}
        {busy && <p className="chat-pending" role="status">Preparing a grounded response...</p>}
      </div>
      <div className="quick-prompts" aria-label="Suggested questions">
        {quickPrompts.map((prompt) => (
          <button key={prompt} type="button" onClick={() => void sendMessage(undefined, prompt)} disabled={busy}>{prompt}</button>
        ))}
      </div>
      <form className="chat-composer" onSubmit={(event) => void sendMessage(event)}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Describe what you observed..."
          aria-label="Message Rise Assist"
          rows={2}
          maxLength={2000}
        />
        <div className="composer-actions">
          <span className="voice-status" role="status">{voiceStatus}</span>
          <div className="composer-buttons">
            {listening ? (
              <button className="button secondary small" type="button" onClick={stopVoiceInput}>Stop mic</button>
            ) : (
              <button className="button secondary small" type="button" onClick={startVoiceInput} disabled={!voiceSupported || !speechLanguage} title={voiceSupported ? "Dictate a message" : "Voice input is not supported in this browser"}>Mic</button>
            )}
            <button className="button primary small" type="submit" disabled={busy || !draft.trim() || !speechLanguage}>{busy ? "Sending..." : "Send"}</button>
          </div>
        </div>
      </form>
      <p className="assist-disclaimer">Decision support only. Follow site isolation, OEM, and approved safety procedures.</p>
    </section>
  );
}
