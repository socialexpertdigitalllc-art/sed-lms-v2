import { getAccessToken } from "@/lib/google/oauth";

const DOCS = "https://docs.googleapis.com/v1/documents";

async function authHeaders(): Promise<Record<string, string>> {
  return { Authorization: `Bearer ${await getAccessToken()}` };
}

type DocElement = {
  paragraph?: { elements?: { textRun?: { content?: string } }[] };
  table?: { tableRows?: { tableCells?: { content?: DocElement[] }[] }[] };
};

function flattenDocText(content: DocElement[]): string {
  let out = "";
  for (const el of content) {
    if (el.paragraph?.elements) {
      for (const pe of el.paragraph.elements) {
        if (pe.textRun?.content) out += pe.textRun.content;
      }
    } else if (el.table?.tableRows) {
      for (const row of el.table.tableRows) {
        for (const cell of row.tableCells ?? []) {
          out += flattenDocText(cell.content ?? []);
        }
      }
    }
  }
  return out;
}

/** Fetch a doc's title and its flattened plain text (for placeholder detection). */
export async function getDocText(docId: string): Promise<{ title: string; text: string }> {
  const res = await fetch(`${DOCS}/${docId}`, { headers: await authHeaders() });
  if (!res.ok) throw new Error(`Docs get failed: ${res.status} ${await res.text()}`);
  const doc = (await res.json()) as { title?: string; body?: { content?: DocElement[] } };
  return { title: doc.title ?? "", text: flattenDocText(doc.body?.content ?? []) };
}

/** Replace every `{{token}}` occurrence — one replaceAllText request per token. */
export async function replaceAllText(
  docId: string,
  replacements: { token: string; value: string }[]
): Promise<void> {
  const requests = replacements.map((r) => ({
    replaceAllText: { containsText: { text: r.token, matchCase: true }, replaceText: r.value },
  }));
  const res = await fetch(`${DOCS}/${docId}:batchUpdate`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  });
  if (!res.ok) throw new Error(`Docs batchUpdate failed: ${res.status} ${await res.text()}`);
}
