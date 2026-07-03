"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GeneratedFile } from "@/lib/ai-tools/parse";

const NAV_BRIDGE = `<script>
document.addEventListener('click', function (e) {
  var a = e.target && e.target.closest ? e.target.closest('a') : null;
  if (!a) return;
  var href = a.getAttribute('href') || '';
  if (/^https?:|^mailto:|^tel:/i.test(href)) return;
  if (/\\.html(\\?|#|$)/i.test(href)) {
    e.preventDefault();
    var name = href.split('#')[0].split('?')[0].replace(/^\\.\\//, '').replace(/^\\//, '');
    parent.postMessage({ __webcraftNav: name }, '*');
  }
});
<\/script>`;

export function PreviewPane({ files }: { files: GeneratedFile[] }) {
  const [active, setActive] = useState(0);
  const [mode, setMode] = useState<"preview" | "code">("preview");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Reset to the first file whenever a fresh set is generated.
  useEffect(() => {
    setActive(0);
  }, [files]);

  useEffect(() => {
    function onMsg(e: MessageEvent) {
      const name = (e.data as { __webcraftNav?: string })?.__webcraftNav;
      if (!name) return;
      const idx = files.findIndex((f) => f.name.toLowerCase() === name.toLowerCase());
      if (idx !== -1) setActive(idx);
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [files]);

  const current = files[active];
  const srcDoc = useMemo(() => (current ? current.code + NAV_BRIDGE : ""), [current]);

  if (!current) return null;

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-surface">
      <div className="flex items-center gap-1 border-b border-border bg-surface-2 px-2 overflow-x-auto">
        {files.map((f, i) => (
          <button
            key={f.name + i}
            onClick={() => setActive(i)}
            className={
              "px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors " +
              (i === active
                ? "border-accent text-accent-ink"
                : "border-transparent text-text-muted hover:text-text")
            }
          >
            {f.name}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 pl-2">
          <Toggle on={mode === "preview"} onClick={() => setMode("preview")}>
            Preview
          </Toggle>
          <Toggle on={mode === "code"} onClick={() => setMode("code")}>
            Code
          </Toggle>
        </div>
      </div>

      {mode === "preview" ? (
        <iframe
          ref={iframeRef}
          title={current.name}
          srcDoc={srcDoc}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          className="w-full h-[70vh] bg-white"
        />
      ) : (
        <pre className="w-full h-[70vh] overflow-auto bg-[#0f1117] text-[#cdd3de] text-xs font-mono p-4 whitespace-pre-wrap">
          {current.code}
        </pre>
      )}
    </div>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        "px-2.5 py-1 my-1 rounded text-xs font-medium transition-colors " +
        (on ? "bg-accent text-white" : "text-text-muted hover:bg-surface")
      }
    >
      {children}
    </button>
  );
}
