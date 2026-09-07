// lib/forms/snippet.ts
export const DEFAULT_RELAY_URL = "https://lms.sedsolutions.online/api/forms/submit";

/** Public URL client sites POST to. Env override for local/dev. */
export function relaySubmitUrl(): string {
  return process.env.FORM_RELAY_PUBLIC_URL?.trim() || DEFAULT_RELAY_URL;
}

export function htmlSnippet(a: { url: string; accessKey: string }): string {
  return `<form action="${a.url}" method="POST">
  <input type="hidden" name="access_key" value="${a.accessKey}">
  <input type="hidden" name="subject" value="New contact form submission">
  <!-- honeypot: keep hidden, bots fill it -->
  <input type="checkbox" name="botcheck" style="display:none" tabindex="-1" autocomplete="off">

  <input type="text" name="name" placeholder="Your name" required>
  <input type="email" name="email" placeholder="Your email" required>
  <textarea name="message" placeholder="How can we help?" required></textarea>
  <button type="submit">Send</button>
</form>`;
}

export function jsSnippet(a: { url: string; accessKey: string }): string {
  return `const form = document.querySelector("#contact-form");
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const body = JSON.stringify({ access_key: "${a.accessKey}", ...data });
  const post = () => fetch("${a.url}", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body,
  });
  let res;
  try {
    res = await post();
  } catch {
    // one retry after 3s covers a dashboard restart window
    await new Promise((r) => setTimeout(r, 3000));
    res = await post();
  }
  const json = await res.json().catch(() => ({ success: false }));
  if (json.success) {
    form.reset();
    alert("Thanks — we'll be in touch shortly.");
  } else {
    alert(json.message || "Something went wrong. Please try again.");
  }
});`;
}
