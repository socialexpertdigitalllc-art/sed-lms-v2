import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";

/**
 * The version agents should be running, and where to get it. Read from the
 * extension's own manifest so it can never disagree with the zip.
 */
export async function GET() {
  try {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), "photo-extractor", "manifest.json"), "utf8")) as {
      version: string;
    };
    return NextResponse.json({
      version: manifest.version,
      downloadUrl: `/downloads/business-photo-extractor-v${manifest.version}.zip`,
    });
  } catch {
    return NextResponse.json({ error: "Extension build not available" }, { status: 503 });
  }
}
