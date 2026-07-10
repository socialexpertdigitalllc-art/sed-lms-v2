"use client";

import { ChevronDown } from "lucide-react";
import { forwardRef, type SelectHTMLAttributes } from "react";

/**
 * Native <select> with the browser arrow removed and a consistent lucide
 * ChevronDown overlay, so every filter dropdown looks the same. Pass the same
 * className you'd put on a <select>; it's merged with `appearance-none pr-8`.
 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = "", children, ...props }, ref) {
    return (
      <div className="relative inline-flex items-center">
        <select
          ref={ref}
          {...props}
          className={"appearance-none pr-8 " + className}
        >
          {children}
        </select>
        <ChevronDown className="w-4 h-4 absolute right-2.5 pointer-events-none text-text-faint" />
      </div>
    );
  }
);
