"use client";

import { Globe } from "lucide-react";
import { BellBase } from "./BellBase";

export function WebsiteBell() {
  return <BellBase bell="website" icon={Globe} label="Website" />;
}
