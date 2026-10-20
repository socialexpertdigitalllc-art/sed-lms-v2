"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Bookmark, FileText, Loader2, Mic, MicOff, Paperclip, Square, X, Zap } from "lucide-react";
import { looksLikeTask } from "@/lib/assistant/intent";
import { AI_BRAND } from "@/lib/assistant/name";
import type { AssistantMode, MessageAttachment } from "@/lib/assistant/types";
import type { Recipe } from "@/lib/assistant/recipes";
import type { PermissionMode } from "@/lib/assistant/actions/permissions";
import { cn } from "@/lib/utils";
import { PermissionModePicker } from "./PermissionModePicker";
import type { ActPermissionsView } from "./useActPermissions";

const MAX = 8000;
const MAX_FILES = 6;

/**
 * The message box. Enter sends, Shift+Enter starts a new line; while an
 * answer is coming the send button becomes Stop. Grows with the text.
 *
 * For people with Act mode: an Ask / Act switch (and a hint when what they
 * type reads like a task), files to attach (a logo, ticket screenshots),
 * speaking instead of typing, and "/" for their saved shortcuts.
 */

interface SpeechResultList {
  length: number;
  [i: number]: { isFinal: boolean; 0: { transcript: string } };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: SpeechResultList }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type SpeechCtor = new () => SpeechRecognitionLike;

function speechCtor(): SpeechCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface PendingFile {
  key: string;
  name: string;
  file?: MessageAttachment;
  error?: string;
}

export function Composer({
  assistantName,
  onSend,
  onStop,
  running,
  disabled,
  autoFocus,
  compact,
  placeholder,
  canAct = false,
  mode = "ask",
  onModeChange,
  conversationId,
  permissions = null,
  onPermissionModeChange,
}: {
  assistantName: string;
  onSend: (text: string, extras?: { attachments: MessageAttachment[]; mode?: AssistantMode }) => void;
  onStop: () => void;
  running: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  /** The floating chat: smaller type and a shorter footnote. */
  compact?: boolean;
  placeholder?: string;
  /** This person may use Act mode. */
  canAct?: boolean;
  mode?: AssistantMode;
  onModeChange?: (mode: AssistantMode) => void;
  /** Files attached here are filed under this chat. */
  conversationId?: string | null;
  /** Act's permission mode (how much runs without a click), when loaded. */
  permissions?: ActPermissionsView | null;
  onPermissionModeChange?: (mode: PermissionMode) => void;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [pick, setPick] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const baseRef = useRef("");
  const [speechSupported, setSpeechSupported] = useState(false);

  useEffect(() => setSpeechSupported(Boolean(speechCtor())), []);

  // Grow with the text, up to about eight lines.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  useEffect(() => () => recRef.current?.stop(), []);

  // "/" opens the saved shortcuts (loaded the first time).
  const slash = text.startsWith("/") && !text.includes("\n") ? text.slice(1).toLowerCase() : null;
  useEffect(() => {
    if (slash === null || recipes !== null) return;
    void fetch("/api/assistant/recipes", { cache: "no-store" })
      .then((r) => r.json())
      .then((b: { recipes?: Recipe[] }) => setRecipes(b.recipes ?? []))
      .catch(() => setRecipes([]));
  }, [slash, recipes]);
  const matches = slash !== null && recipes ? recipes.filter((r) => r.command.includes(slash.split(/\s/)[0]) || r.name.toLowerCase().includes(slash)).slice(0, 6) : [];

  const uploading = files.some((f) => !f.file && !f.error);
  const ready = files.filter((f) => f.file).map((f) => f.file!);

  function send() {
    const t = text.trim();
    if (!t || running || disabled || uploading) return;
    recRef.current?.stop();
    onSend(t, { attachments: ready });
    setText("");
    setFiles([]);
  }

  function applyRecipe(r: Recipe) {
    setText(r.prompt);
    if (canAct) onModeChange?.(r.mode);
    void fetch(`/api/assistant/recipes/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ used: true }) }).catch(() => {});
    requestAnimationFrame(() => ref.current?.focus());
  }

  const attach = useCallback(
    async (list: FileList | File[]) => {
      const chosen = Array.from(list).slice(0, Math.max(0, MAX_FILES - files.length));
      for (const file of chosen) {
        const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
        setFiles((prev) => [...prev, { key, name: file.name }]);
        const form = new FormData();
        form.append("file", file);
        if (conversationId) form.append("conversationId", conversationId);
        try {
          const res = await fetch("/api/assistant/uploads", { method: "POST", body: form });
          const body = (await res.json().catch(() => ({}))) as { file?: MessageAttachment; error?: string };
          if (!res.ok || !body.file) throw new Error(body.error ?? `Upload failed (HTTP ${res.status})`);
          setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, file: body.file } : f)));
        } catch (e) {
          setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, error: (e as Error).message } : f)));
        }
      }
    },
    [files.length, conversationId],
  );

  function toggleVoice() {
    setVoiceError(null);
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const Ctor = speechCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    baseRef.current = text ? `${text.trimEnd()} ` : "";
    rec.onresult = (e) => {
      let finalText = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      setText(`${baseRef.current}${finalText}${interim}`.slice(0, MAX));
    };
    rec.onerror = (e) => {
      setVoiceError(e.error === "not-allowed" ? "Allow the microphone to speak to SED AI." : "Could not hear you — try again.");
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
    };
    recRef.current = rec;
    rec.start();
    setListening(true);
  }

  const taskHint = canAct && mode === "ask" && looksLikeTask(text);
  const round = "grid h-9 w-9 shrink-0 place-items-center rounded-full transition-[background-color,opacity] duration-150";
  const tool = "grid h-8 w-8 shrink-0 place-items-center rounded-full text-text-faint transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40";

  return (
    <div className="mx-auto w-full max-w-3xl">
      {matches.length || (slash !== null && recipes && !recipes.length) ? (
        <div className="mb-2 overflow-hidden rounded-2xl border border-border bg-surface shadow-lg" role="listbox" aria-label="Your shortcuts">
          {matches.length ? (
            matches.map((r, i) => (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={i === pick}
                onMouseEnter={() => setPick(i)}
                onClick={() => applyRecipe(r)}
                className={cn("flex w-full items-start gap-2 px-3 py-2 text-left text-[13px]", i === pick ? "bg-surface-2" : "hover:bg-surface-2")}
              >
                <Bookmark className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-text">/{r.command}</span> <span className="text-text-muted">{r.name}</span>
                  <span className="block truncate text-xs text-text-faint">{r.prompt}</span>
                </span>
                {r.mode === "act" ? <Zap className="mt-0.5 h-3 w-3 shrink-0 text-accent" aria-label="Runs in Act mode" /> : null}
              </button>
            ))
          ) : (
            <p className="px-3 py-2.5 text-xs text-text-faint">No shortcuts yet. Hover any question you asked and press the bookmark to save it as one.</p>
          )}
        </div>
      ) : null}

      {taskHint ? (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent-soft/50 px-3 py-1.5 text-xs text-accent-ink">
          <span className="flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5" aria-hidden /> This looks like a task. In Act mode {assistantName} prepares it for you to confirm.
          </span>
          <button type="button" className="shrink-0 rounded-full bg-accent px-2.5 py-0.5 font-medium text-white hover:bg-accent-ink" onClick={() => onModeChange?.("act")}>
            Switch to Act
          </button>
        </div>
      ) : null}

      {files.length ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {files.map((f) => (
            <span
              key={f.key}
              className={cn(
                "inline-flex max-w-[240px] items-center gap-1.5 rounded-lg border px-2 py-1 text-xs",
                f.error ? "border-dropped-bg bg-dropped-bg/40 text-dropped-fg" : "border-border bg-surface text-text-muted",
              )}
              title={f.error ?? f.name}
            >
              {f.file || f.error ? <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />}
              <span className="truncate">{f.error ? `${f.name}: ${f.error}` : f.name}</span>
              <button type="button" onClick={() => setFiles((prev) => prev.filter((x) => x.key !== f.key))} className="shrink-0 rounded hover:text-text" aria-label={`Remove ${f.name}`}>
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          "rounded-[26px] border bg-surface py-2 pl-4 pr-2 shadow-[0_2px_12px_-4px_rgba(15,23,42,0.12)] transition-colors",
          disabled ? "border-border opacity-60" : mode === "act" && canAct ? "border-accent/50 focus-within:border-accent" : "border-border focus-within:border-accent/60",
        )}
        onDragOver={(e) => {
          if (canAct && e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          if (!canAct || !e.dataTransfer.files.length) return;
          e.preventDefault();
          void attach(e.dataTransfer.files);
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={ref}
            value={text}
            onChange={(e) => {
              setText(e.target.value.slice(0, MAX));
              setPick(0);
            }}
            onPaste={(e) => {
              if (!canAct) return;
              const pasted = Array.from(e.clipboardData.files);
              if (pasted.length) {
                e.preventDefault();
                void attach(pasted);
              }
            }}
            onKeyDown={(e) => {
              if (matches.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault();
                setPick((p) => (e.key === "ArrowDown" ? (p + 1) % matches.length : (p - 1 + matches.length) % matches.length));
                return;
              }
              if (matches.length && (e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
                e.preventDefault();
                applyRecipe(matches[pick] ?? matches[0]);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            disabled={disabled}
            placeholder={
              disabled
                ? `${assistantName} is not available right now`
                : mode === "act" && canAct
                  ? permissions && permissions.effective !== "ask"
                    ? `Tell ${assistantName} what to do…`
                    : `Tell ${assistantName} what to do — it prepares it for you to confirm…`
                  : (placeholder ?? `Ask ${assistantName} anything…`)
            }
            className={cn(
              "max-h-[200px] min-h-[24px] flex-1 resize-none self-center bg-transparent py-1 leading-relaxed text-text placeholder:text-text-faint focus:outline-none",
              compact ? "text-sm" : "text-[15px]",
            )}
            aria-label="Message the assistant"
          />
          {running ? (
            <button type="button" onClick={onStop} className={cn(round, "bg-text text-surface hover:opacity-85")} aria-label="Stop answering" title="Stop">
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={send}
              disabled={!text.trim() || disabled || uploading}
              className={cn(
                round,
                mode === "act" && canAct ? "bg-accent text-white hover:bg-accent-ink" : "bg-text text-surface hover:opacity-85",
                "disabled:bg-border disabled:text-text-faint disabled:hover:opacity-100",
              )}
              aria-label="Send message"
              title={uploading ? "Wait for the files to finish uploading" : "Send (Enter)"}
            >
              <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.5} />
            </button>
          )}
        </div>
        {canAct || speechSupported ? (
          <div className="-ml-2 mt-1 flex items-center gap-1">
            {canAct ? (
              <div className="mr-1 inline-flex rounded-full border border-border p-0.5 text-xs" role="radiogroup" aria-label="Mode">
                {(["ask", "act"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => onModeChange?.(m)}
                    title={m === "ask" ? "Ask: questions and analysis — nothing changes" : "Act: it prepares changes for you to confirm"}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-medium transition-colors",
                      mode === m ? (m === "act" ? "bg-accent text-white" : "bg-text text-surface") : "text-text-muted hover:text-text",
                    )}
                  >
                    {m === "act" ? <Zap className="h-3 w-3" aria-hidden /> : null}
                    {m === "ask" ? "Ask" : "Act"}
                  </button>
                ))}
              </div>
            ) : null}
            {canAct && mode === "act" && permissions && onPermissionModeChange ? (
              <PermissionModePicker view={permissions} onChange={onPermissionModeChange} compact={compact} />
            ) : null}
            {canAct ? (
              <>
                <button type="button" className={tool} onClick={() => fileRef.current?.click()} disabled={files.length >= MAX_FILES || disabled} aria-label="Attach files" title="Attach a logo, screenshots or a file">
                  <Paperclip className="h-4 w-4" aria-hidden />
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  hidden
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,application/pdf,text/plain,text/csv"
                  onChange={(e) => {
                    if (e.target.files?.length) void attach(e.target.files);
                    e.target.value = "";
                  }}
                />
              </>
            ) : null}
            {speechSupported ? (
              <button
                type="button"
                className={cn(tool, listening && "bg-dropped-bg text-dropped-fg hover:bg-dropped-bg hover:text-dropped-fg")}
                onClick={toggleVoice}
                disabled={disabled}
                aria-pressed={listening}
                aria-label={listening ? "Stop listening" : "Speak instead of typing"}
                title={listening ? "Stop listening" : "Speak instead of typing"}
              >
                {listening ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
              </button>
            ) : null}
            {listening ? <span className="text-xs text-dropped-fg">Listening… speak, then press send</span> : null}
            {voiceError ? <span className="text-xs text-dropped-fg">{voiceError}</span> : null}
          </div>
        ) : null}
      </div>
      <p className="mt-1.5 text-center text-[11px] text-text-faint">
        {mode === "act" && canAct
          ? permissions?.effective === "auto_safe"
            ? `Act mode: safe changes happen right away; ${assistantName} asks you about the rest. Undo is on each card.`
            : permissions?.effective === "auto"
              ? `Act mode: changes happen right away, except high-impact ones. Undo is on each card.`
              : `Act mode: ${assistantName} prepares each change and nothing happens until you confirm it.`
          : compact
            ? `${AI_BRAND} can make mistakes. Check important numbers.`
            : `${assistantName} only sees what your account can see. ${AI_BRAND} can make mistakes, so check important numbers.`}
        {text.length > MAX - 1000 ? ` · ${MAX - text.length} characters left` : ""}
      </p>
    </div>
  );
}
