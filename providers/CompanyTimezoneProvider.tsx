"use client";

import { createContext, useContext } from "react";
import { DEFAULT_COMPANY_TZ } from "@/lib/analytics/dateScope";

/**
 * The company's timezone (app_settings.work_timezone) for client components.
 * Month filters and month counts follow the company calendar, not the
 * viewer's browser or the server's UTC clock.
 */
const CompanyTimezoneContext = createContext<string>(DEFAULT_COMPANY_TZ);

export function CompanyTimezoneProvider({ value, children }: { value: string; children: React.ReactNode }) {
  return <CompanyTimezoneContext.Provider value={value || DEFAULT_COMPANY_TZ}>{children}</CompanyTimezoneContext.Provider>;
}

export function useCompanyTimezone(): string {
  return useContext(CompanyTimezoneContext);
}
