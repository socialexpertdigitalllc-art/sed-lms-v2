// Pure {{key}} / {{key|fallback}} template engine. No domain imports.
const TOKEN = /\{\{\s*([^}|]+?)\s*(?:\|([^}]*))?\}\}/g;

export function renderTemplate(template: string, context: Record<string, string>): string {
  return template.replace(TOKEN, (_m, rawKey: string, fallback?: string) => {
    const value = context[rawKey];
    // An empty context value is treated as "absent" so the inline fallback wins — this is how empty generator form fields fall back to "(not provided)" text.
    if (value !== undefined && value !== "") return value;
    return fallback ?? "";
  });
}

export function listTemplateVars(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(TOKEN)) out.add(m[1]);
  return [...out];
}
