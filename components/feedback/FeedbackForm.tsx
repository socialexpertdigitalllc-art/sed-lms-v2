"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FEEDBACK_TYPES, type FeedbackType } from "@/lib/feedback/types";
import { RadioPillGroup } from "@/components/forms/RadioPillGroup";
import { inputCls } from "@/components/forms/Field";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export function FeedbackForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [type, setType] = useState<FeedbackType>("Bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const labelCls = "block text-xs font-medium text-text-muted mb-1";

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (f) {
      if (!f.type.startsWith("image/")) {
        setError("Screenshot must be an image.");
        e.target.value = "";
        return;
      }
      if (f.size > MAX_FILE_BYTES) {
        setError("Screenshot must be 5 MB or smaller.");
        e.target.value = "";
        return;
      }
    }
    setError(null);
    setScreenshot(f);
  }

  function reset() {
    setType("Bug");
    setTitle("");
    setDescription("");
    setScreenshot(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function submit() {
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(false);
    const fd = new FormData();
    fd.append(
      "payload",
      JSON.stringify({ type, title: title.trim(), description: description.trim() || null })
    );
    if (screenshot) fd.append("screenshot", screenshot);
    const res = await fetch("/api/feedback", {
      method: "POST",
      body: fd, // no Content-Type header — the browser sets the multipart boundary
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Failed to submit feedback");
      return;
    }
    reset();
    setSuccess(true);
    router.refresh();
  }

  return (
    <section className="bg-surface border border-border rounded-lg p-5">
      <div className="text-sm font-semibold text-text mb-4">Submit feedback</div>

      {success && (
        <div className="mb-4 text-sm rounded-md px-3 py-2 bg-ready-bg text-ready-fg">
          Thanks — your feedback was submitted.
        </div>
      )}
      {error && (
        <div className="mb-4 text-sm rounded-md px-3 py-2 bg-dropped-bg text-dropped-fg">{error}</div>
      )}

      <div className="space-y-4">
        <div>
          <label className={labelCls}>Type</label>
          <RadioPillGroup
            options={FEEDBACK_TYPES}
            value={type}
            onChange={(v) => setType(v as FeedbackType)}
          />
        </div>

        <div>
          <label className={labelCls}>Title</label>
          <input
            type="text"
            className={inputCls}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short summary…"
          />
        </div>

        <div>
          <label className={labelCls}>Description (optional)</label>
          <textarea
            className={inputCls}
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Steps to reproduce, what you expected, etc…"
          />
        </div>

        <div>
          <label className={labelCls}>Screenshot (optional)</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onFile}
            className="block w-full text-xs text-text-muted file:mr-2 file:rounded-md file:border file:border-border file:bg-surface-2 file:px-2 file:py-1 file:text-xs file:text-text file:cursor-pointer"
          />
          {screenshot && <p className="text-[11px] text-text-faint mt-1">{screenshot.name}</p>}
        </div>
      </div>

      <div className="mt-4">
        <button
          onClick={submit}
          disabled={busy}
          className="px-4 py-2 text-sm rounded-md bg-accent text-white font-semibold hover:bg-accent-ink disabled:opacity-60"
        >
          {busy ? "Submitting…" : "Submit feedback"}
        </button>
      </div>
    </section>
  );
}
