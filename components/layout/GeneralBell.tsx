"use client";

import { Bell } from "lucide-react";
import { BellBase } from "./BellBase";

export function GeneralBell() {
  return <BellBase bell="general" icon={Bell} label="Notifications" />;
}
