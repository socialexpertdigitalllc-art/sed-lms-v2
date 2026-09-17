"use client";

import { Moon, Sun } from "lucide-react";
import { themeCookieValue } from "@/lib/theme";

/**
 * The header's light/dark switch.
 *
 * Deliberately STATELESS. Both icons are rendered every time and CSS decides
 * which one is visible (see `.theme-icon-*` in globals.css), and the click
 * handler reads the live theme off the document rather than from React. That
 * is what makes it correct in the first paint under "system": the server
 * cannot know the OS preference, so any state-based icon would either flash
 * the wrong one or need its hydration suppressed.
 *
 * The click writes the cookie the server reads on the next request AND flips
 * the attribute immediately, so the change is instant and survives a reload.
 */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const explicit = root.getAttribute("data-theme");
    // No attribute = "system": resolve what is actually on screen right now,
    // so the first click always moves AWAY from what the user is looking at.
    const current =
      explicit === "dark" || explicit === "light"
        ? explicit
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    const next = current === "dark" ? "light" : "dark";

    root.setAttribute("data-theme", next);
    // Keep the native controls (selects, checkboxes, scrollbars) in step with
    // the same paint — the stylesheet sets this too, but only via a selector
    // that the attribute change has just satisfied.
    root.style.colorScheme = next;
    document.cookie = themeCookieValue(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title="Switch between light and dark"
      aria-label="Switch between light and dark"
      className="grid h-8 w-8 place-items-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
    >
      <Sun className="theme-icon-dark h-[18px] w-[18px]" aria-hidden />
      <Moon className="theme-icon-light h-[18px] w-[18px]" aria-hidden />
    </button>
  );
}
