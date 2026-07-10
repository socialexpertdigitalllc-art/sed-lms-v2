/**
 * DirectAdmin legacy API client (Basic auth user + login key).
 * Env: DA_HOST (e.g. https://server:2222), DA_USERNAME, DA_LOGIN_KEY, DA_DOMAIN.
 * Responses are legacy URL-encoded (`error=1&text=...&details=...`); JSON tolerated.
 * All calls are non-throwing — failures surface as { error: true, ... }.
 */

export interface DaResult {
  error: boolean;
  text: string;
  details: string;
  raw: string;
}

export function daConfigured(): boolean {
  return Boolean(
    process.env.DA_HOST && process.env.DA_USERNAME && process.env.DA_LOGIN_KEY && process.env.DA_DOMAIN
  );
}

export function parseDaResponse(text: string): { error: boolean; text: string; details: string } {
  const body = (text ?? "").trim();

  if (body.startsWith("{") || body.startsWith("[")) {
    try {
      const json = JSON.parse(body) as unknown;
      if (json && typeof json === "object" && !Array.isArray(json)) {
        const rec = json as Record<string, unknown>;
        const err = rec.error;
        return {
          error: err === 1 || err === true || err === "1",
          text: typeof rec.text === "string" ? rec.text : typeof rec.message === "string" ? rec.message : "",
          details: typeof rec.details === "string" ? rec.details : "",
        };
      }
    } catch {
      // fall through to url-encoded parsing
    }
  }

  const params = new URLSearchParams(body);
  const err = params.get("error");
  return {
    error: err !== null && err !== "" && err !== "0",
    text: params.get("text") ?? "",
    details: params.get("details") ?? "",
  };
}

export async function daCall(
  cmd: string,
  params: Record<string, string>,
  opts?: { method?: "GET" | "POST"; body?: FormData }
): Promise<DaResult> {
  const host = (process.env.DA_HOST ?? "").replace(/\/+$/, "");
  const method = opts?.method ?? "GET";
  const headers: Record<string, string> = {
    Authorization:
      "Basic " + Buffer.from(`${process.env.DA_USERNAME ?? ""}:${process.env.DA_LOGIN_KEY ?? ""}`).toString("base64"),
  };

  let url = `${host}/${cmd}`;
  let body: BodyInit | undefined;
  const query = new URLSearchParams(params).toString();

  if (opts?.body) {
    body = opts.body; // multipart — runtime sets the boundary content-type
    if (query) url += `?${query}`;
  } else if (method === "POST") {
    body = query;
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  } else if (query) {
    url += `?${query}`;
  }

  try {
    const res = await fetch(url, { method, headers, body });
    const raw = await res.text();
    const parsed = parseDaResponse(raw);
    return { ...parsed, error: parsed.error || !res.ok, raw };
  } catch (e) {
    return { error: true, text: e instanceof Error ? e.message : "network error", details: "", raw: "" };
  }
}

export async function createSubdomain(sub: string): Promise<DaResult> {
  return daCall(
    "CMD_API_SUBDOMAINS",
    { action: "add", domain: process.env.DA_DOMAIN ?? "", subdomain: sub },
    { method: "POST" }
  );
}

export async function subdomainExists(sub: string): Promise<boolean> {
  const res = await daCall("CMD_API_SUBDOMAINS", { domain: process.env.DA_DOMAIN ?? "" });
  if (res.error) return false;
  try {
    return new URLSearchParams(res.raw.trim()).getAll("list[]").includes(sub);
  } catch {
    return false;
  }
}

/**
 * Upload a site zip into the subdomain docroot, extract it there, then delete the zip.
 * Docroot: /domains/{DA_DOMAIN}/public_html/{sub}
 */
export async function uploadZipAndExtract(
  sub: string,
  zipBytes: Uint8Array,
  zipName: string
): Promise<{ ok: boolean; failedStep?: "upload" | "extract" | "delete"; message?: string }> {
  const dir = `/domains/${process.env.DA_DOMAIN ?? ""}/public_html/${sub}`;
  const zipPath = `${dir}/${zipName}`;

  const fd = new FormData();
  fd.append("action", "upload");
  fd.append("path", dir);
  // copy so the BlobPart is backed by a plain ArrayBuffer (TS: Uint8Array<ArrayBufferLike> is not a BlobPart)
  fd.append("file1", new File([new Uint8Array(zipBytes)], zipName, { type: "application/zip" }));
  const upload = await daCall("CMD_FILE_MANAGER", {}, { method: "POST", body: fd });
  if (upload.error) {
    return { ok: false, failedStep: "upload", message: upload.text || upload.details || upload.raw || "upload failed" };
  }

  const extract = await daCall(
    "CMD_FILE_MANAGER",
    { action: "extract", path: zipPath, directory: dir },
    { method: "POST" }
  );
  if (extract.error) {
    return { ok: false, failedStep: "extract", message: extract.text || extract.details || extract.raw || "extract failed" };
  }

  const del = await daCall(
    "CMD_FILE_MANAGER",
    { action: "multiple", button: "delete", select0: zipPath },
    { method: "POST" }
  );
  if (del.error) {
    return { ok: false, failedStep: "delete", message: del.text || del.details || del.raw || "delete failed" };
  }

  return { ok: true };
}
