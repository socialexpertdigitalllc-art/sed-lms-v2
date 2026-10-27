"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/errors/report";

/** Last-resort boundary (root layout failed). Reports, then offers a reload. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    reportClientError(error, "root");
  }, [error]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#0b0b0b", color: "#eee", margin: 0 }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ maxWidth: 480, padding: 24 }}>
            <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>This page couldn’t load</h1>
            <p style={{ fontSize: 14, opacity: 0.8, margin: "0 0 16px" }}>
              Something went wrong. It has been reported. Reload to try again.
            </p>
            {error.digest ? (
              <p style={{ fontSize: 12, opacity: 0.6, fontFamily: "monospace" }}>ref {error.digest}</p>
            ) : null}
            <button
              onClick={() => window.location.reload()}
              style={{ padding: "8px 14px", borderRadius: 6, border: "1px solid #444", background: "#1a1a1a", color: "#eee", cursor: "pointer" }}
            >
              Reload
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
