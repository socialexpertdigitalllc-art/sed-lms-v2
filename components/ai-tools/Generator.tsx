"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TOOLS, type ToolId } from "@/lib/ai-tools/config";
import { buildPrompt, EMPTY_INPUT, type GenInput } from "@/lib/ai-tools/prompt";
import type { WgeConfig, WgeVariable } from "@/lib/ai-tools/wge-types";
import { parseFiles, type GeneratedFile } from "@/lib/ai-tools/parse";
import { makeZip } from "@/lib/ai-tools/zip";
import { PreviewPane } from "./PreviewPane";

const inputCls =
  "w-full px-3 py-2 rounded-md border border-border bg-surface text-sm text-text outline-none focus:ring-2 focus:ring-accent";
const estTokens = (s: string) => Math.ceil(s.length / 4);

export function Generator({
  tool,
  prefill,
  leadId,
  config,
}: {
  tool: ToolId;
  prefill?: Partial<GenInput>;
  leadId?: string;
  config: WgeConfig;
}) {
  const cfg = TOOLS[tool];
  const s = config.settings;

  const [step, setStep] = useState(1);
  const [input, setInput] = useState<GenInput>({ ...EMPTY_INPUT, pages: String(s.default_pages), ...prefill });
  const [prompt, setPrompt] = useState("");
  const [promptDirty, setPromptDirty] = useState(false);

  const [model, setModel] = useState(cfg.defaultModel);
  const [maxTokens, setMaxTokens] = useState(Math.min(s.max_tokens, cfg.maxOutputTokens));
  const [temperature, setTemperature] = useState(s.temperature);

  const [generating, setGenerating] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [files, setFiles] = useState<GeneratedFile[]>([]);
  const [tokens, setTokens] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved" | "error"; msg?: string }>({
    state: "idle",
  });
  const abortRef = useRef<AbortController | null>(null);
  const streamBoxRef = useRef<HTMLPreElement>(null);

  const set = (k: keyof GenInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setInput((p) => ({ ...p, [k]: e.target.value }));

  const rebuildPrompt = useCallback(() => {
    setPrompt(buildPrompt(input, config.prompt_template));
    setPromptDirty(false);
  }, [input, config.prompt_template]);

  // Build the prompt when first arriving at step 2 (unless the user edited it).
  useEffect(() => {
    if (step === 2 && !promptDirty && !prompt) setPrompt(buildPrompt(input, config.prompt_template));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    if (streamBoxRef.current) streamBoxRef.current.scrollTop = streamBoxRef.current.scrollHeight;
  }, [streamText]);

  async function persist(generated: GeneratedFile[], timings: { total: number; ai: number }, tokenCount: number) {
    setSave({ state: "saving" });
    try {
      const res = await fetch(`/api/ai-tools/${tool}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: generated,
          model,
          businessName: input.name || null,
          leadId: leadId ?? null,
          numPages: generated.length,
          pageTypes: generated.map((f) => f.name),
          tokensUsed: tokenCount,
          totalTimeMs: timings.total,
          aiTimeMs: timings.ai,
          status: "success",
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setSave({ state: "error", msg: j.error ?? "Could not save" });
        return;
      }
      setSave({ state: "saved" });
    } catch (e) {
      setSave({ state: "error", msg: (e as Error).message });
    }
  }

  async function generate() {
    setError(null);
    setFiles([]);
    setStreamText("");
    setTokens(0);
    setSave({ state: "idle" });
    setGenerating(true);
    setStep(3);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const start = Date.now();
    let firstChunk = 0;

    try {
      const res = await fetch(`/api/ai-tools/${tool}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, model, maxTokens, temperature }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!firstChunk) firstChunk = Date.now();
        full += dec.decode(value, { stream: true });
        setStreamText(full);
        setTokens(Math.ceil(full.length / 4));
      }

      const parsed = parseFiles(full);
      if (!parsed.length) throw new Error("The model did not return any usable HTML.");
      setFiles(parsed);

      const end = Date.now();
      const finalTokens = Math.ceil(full.length / 4);
      await persist(parsed, { total: end - start, ai: firstChunk ? end - firstChunk : 0 }, finalTokens);
      if (s.auto_download) downloadZip(parsed);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
    setGenerating(false);
  }

  function downloadZip(list: GeneratedFile[] = files) {
    if (!list.length) return;
    const blob = makeZip(list);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const slug = (input.name || "website").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    a.href = url;
    a.download = `${slug || "website"}_site.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const promptStats = useMemo(
    () => ({
      chars: prompt.length,
      words: prompt.trim() ? prompt.trim().split(/\s+/).length : 0,
      tokens: estTokens(prompt),
    }),
    [prompt]
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-5 gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: cfg.accent }} />
            {cfg.label} generator
          </h1>
          <p className="text-sm text-text-muted mt-0.5">{cfg.blurb}</p>
        </div>
        <Stepper step={step} onStep={setStep} />
      </div>

      {error && (
        <div className="mb-4 text-sm rounded-md px-3 py-2 bg-dropped-bg text-dropped-fg">{error}</div>
      )}

      {/* STEP 1 — business details */}
      {step === 1 && (
        <div className="space-y-5">
          <Card title="Website details">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
              {config.variables.map((v) => (
                <VarField
                  key={v.key}
                  v={v}
                  value={input[v.key as keyof GenInput] ?? ""}
                  onChange={(val) => setInput((p) => ({ ...p, [v.key]: val }))}
                />
              ))}
            </div>
          </Card>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                rebuildPrompt();
                setStep(2);
              }}
              className="text-sm px-4 py-2 rounded-md bg-accent text-white font-semibold hover:bg-accent-ink"
            >
              Build prompt →
            </button>
          </div>
        </div>
      )}

      {/* STEP 2 — prompt & settings */}
      {step === 2 && (
        <div className="space-y-5">
          <Card title="Generation settings">
            <Grid>
              <div>
                <Label>Model</Label>
                <select value={model} onChange={(e) => setModel(e.target.value)} className={inputCls}>
                  {cfg.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Max output tokens (≤ {cfg.maxOutputTokens.toLocaleString()})</Label>
                <input
                  type="number"
                  value={maxTokens}
                  min={256}
                  max={cfg.maxOutputTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                  className={inputCls}
                />
              </div>
              <div>
                <Label>Temperature: {temperature.toFixed(2)}</Label>
                <input
                  type="range"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  className="w-full accent-accent"
                />
              </div>
            </Grid>
          </Card>

          <Card title="Prompt">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-text-faint font-mono">
                {promptStats.chars.toLocaleString()} chars · {promptStats.words.toLocaleString()} words · ~
                {promptStats.tokens.toLocaleString()} tokens
              </div>
              <button onClick={rebuildPrompt} className="text-xs text-accent-ink hover:underline">
                ↻ Rebuild from details
              </button>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setPromptDirty(true);
              }}
              rows={18}
              className={inputCls + " font-mono text-xs leading-relaxed"}
            />
          </Card>

          <div className="flex justify-between gap-2">
            <button onClick={() => setStep(1)} className="text-sm px-4 py-2 rounded-md border border-border text-text-muted hover:bg-surface-2">
              ← Back
            </button>
            <button
              onClick={generate}
              disabled={prompt.trim().length < 20}
              className="text-sm px-5 py-2 rounded-md bg-accent text-white font-semibold hover:bg-accent-ink disabled:opacity-60"
            >
              ⚡ Generate website
            </button>
          </div>
        </div>
      )}

      {/* STEP 3 — generation & result */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3 text-sm">
              {generating ? (
                <span className="flex items-center gap-2 text-text-muted">
                  <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                  Streaming from {model}…
                </span>
              ) : files.length ? (
                <span className="text-ready-fg font-medium">✓ {files.length} page(s) generated</span>
              ) : (
                <span className="text-text-muted">Ready</span>
              )}
              <span className="text-text-faint font-mono text-xs">~{tokens.toLocaleString()} tokens</span>
              <SaveBadge save={save} />
            </div>
            <div className="flex items-center gap-2">
              {generating && (
                <button onClick={stop} className="text-sm px-3 py-2 rounded-md border border-dropped-fg/40 text-dropped-fg hover:bg-dropped-bg">
                  Stop
                </button>
              )}
              {!generating && files.length > 0 && (
                <>
                  <button onClick={() => downloadZip()} className="text-sm px-3 py-2 rounded-md border border-border text-text hover:bg-surface-2">
                    ↓ Download ZIP
                  </button>
                  <button onClick={() => setStep(2)} className="text-sm px-3 py-2 rounded-md border border-border text-text-muted hover:bg-surface-2">
                    Edit & regenerate
                  </button>
                </>
              )}
            </div>
          </div>

          {generating || (!files.length && streamText) ? (
            <pre
              ref={streamBoxRef}
              className="w-full h-[60vh] overflow-auto bg-[#0f1117] text-[#cdd3de] text-xs font-mono p-4 rounded-lg whitespace-pre-wrap"
            >
              {streamText.length > 6000 ? "…(streaming)…\n" + streamText.slice(-5000) : streamText || "Waiting for the model…"}
            </pre>
          ) : null}

          {!generating && files.length > 0 && <PreviewPane files={files} />}
        </div>
      )}
    </div>
  );
}

function VarField({ v, value, onChange }: { v: WgeVariable; value: string; onChange: (val: string) => void }) {
  const full = v.type === "textarea";
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label className="block text-xs font-medium text-text-muted mb-1">{v.label}</label>
      {v.type === "textarea" ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className={inputCls + " font-mono text-xs"} />
      ) : (
        <input type={v.type === "number" ? "number" : "text"} value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} />
      )}
    </div>
  );
}

function Stepper({ step, onStep }: { step: number; onStep: (n: number) => void }) {
  const labels = ["Details", "Prompt", "Generate"];
  return (
    <div className="flex items-center gap-1">
      {labels.map((l, i) => {
        const n = i + 1;
        const done = n < step;
        const active = n === step;
        return (
          <button
            key={l}
            onClick={() => n <= step && onStep(n)}
            disabled={n > step}
            className={
              "px-3 py-1.5 rounded-md text-xs font-medium transition-colors " +
              (active
                ? "bg-accent-soft text-accent-ink"
                : done
                  ? "text-text-muted hover:bg-surface-2"
                  : "text-text-faint cursor-not-allowed")
            }
          >
            {n}. {l}
          </button>
        );
      })}
    </div>
  );
}

function SaveBadge({ save }: { save: { state: string; msg?: string } }) {
  if (save.state === "saving") return <span className="text-xs text-text-faint">saving…</span>;
  if (save.state === "saved") return <span className="text-xs text-ready-fg">saved to history</span>;
  if (save.state === "error") return <span className="text-xs text-dropped-fg">save failed: {save.msg}</span>;
  return null;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-5">
      <div className="text-[10px] uppercase tracking-wider text-text-faint font-semibold mb-4">{title}</div>
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">{children}</div>;
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-text-muted mb-1">{children}</label>;
}
