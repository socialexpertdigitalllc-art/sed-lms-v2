"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    login,
    null
  );

  return (
    <main className="min-h-screen grid place-items-center bg-bg px-4">
      <form
        action={action}
        className="w-[380px] bg-surface border border-border rounded-lg p-8 shadow-sm"
      >
        <div className="flex items-center gap-2.5 mb-6">
          <div className="w-9 h-9 rounded-lg bg-accent grid place-items-center text-white font-bold">
            S
          </div>
          <div>
            <div className="font-semibold text-text leading-tight">SED LMS</div>
            <div className="text-xs text-text-faint">Lead Management System</div>
          </div>
        </div>

        <h1 className="text-lg font-semibold text-text">Sign in</h1>
        <p className="text-sm text-text-muted mt-1 mb-6">
          Access your dashboard
        </p>

        {state?.error && (
          <div className="mb-4 text-sm text-dropped-fg bg-dropped-bg rounded-md px-3 py-2">
            {state.error}
          </div>
        )}

        <label className="block text-xs font-semibold uppercase tracking-wide text-text-faint mb-1">
          Email or username
        </label>
        <input
          name="identifier"
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          required
          autoFocus
          className="w-full mb-4 px-3 py-2 rounded-md border border-border bg-surface text-text outline-none focus:ring-2 focus:ring-accent"
        />

        <label className="block text-xs font-semibold uppercase tracking-wide text-text-faint mb-1">
          Password
        </label>
        <input
          name="password"
          type="password"
          required
          className="w-full mb-6 px-3 py-2 rounded-md border border-border bg-surface text-text outline-none focus:ring-2 focus:ring-accent"
        />

        <button
          disabled={pending}
          className="w-full bg-accent text-white rounded-md py-2 font-semibold hover:bg-accent-ink transition-colors disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
