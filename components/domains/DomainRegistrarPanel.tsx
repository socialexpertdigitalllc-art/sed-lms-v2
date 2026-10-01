"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, KeyRound, Loader2, Send, Settings2 } from "lucide-react";
import { Panel } from "@/components/common/Panel";
import { CopyButton } from "@/components/common/CopyButton";
import { btnGhostSm, btnSecondarySm } from "@/components/common/buttons";
import { inputCls } from "@/components/forms/Field";
import { cn } from "@/lib/utils";
import { ConfirmAction, Switch, useDomainCall } from "@/components/domains/DomainControls";
import type { RegistrarSettings } from "@/lib/domains/manage";

function Row({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-border-subtle px-4 py-3 last:border-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 sm:max-w-xs">
        <p className="text-sm font-medium text-text">{label}</p>
        {hint ? <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{hint}</p> : null}
      </div>
      <div className="min-w-0 sm:text-right">{children}</div>
    </div>
  );
}

const MOVE_WORDS: Record<string, string> = {
  initiated: "Waiting for the receiving account to accept",
  activating: "Accepted — moving now",
  completed: "Moved",
};

/**
 * The registrar's own settings for the domain, live: transfer lock, WHOIS
 * privacy, nameservers, forwarding, and handing the domain over (transfer code,
 * or a move to the client's Hostinger account). What a registrar's API can't
 * do links to the page where it's done.
 */
export function DomainRegistrarPanel({
  domainId,
  domain,
  canManage,
  onChanged,
}: {
  domainId: string;
  domain: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const { call, busy } = useDomainCall();
  const [s, setS] = useState<RegistrarSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nsDraft, setNsDraft] = useState<string | null>(null);
  const [fwd, setFwd] = useState<{ url: string; type: "301" | "302" } | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [confirmCode, setConfirmCode] = useState(false);
  const [moveEmail, setMoveEmail] = useState("");
  const [confirmMove, setConfirmMove] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const r = await fetch(`/api/domains/${domainId}/registrar`);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setError(j.error ?? "Could not read the registrar settings");
    else setS(j.settings as RegistrarSettings);
  }, [domainId]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function patch(body: Record<string, unknown>, ok: string) {
    const r = await call("patch", `/api/domains/${domainId}/registrar`, { method: "PATCH", body }, { title: ok });
    if (r.ok) {
      await load();
      onChanged();
    }
    return r.ok;
  }

  async function saveNameservers() {
    if (nsDraft === null) return;
    const list = nsDraft.split(/[\s,]+/).filter(Boolean);
    if (!confirm(`Point ${domain} at ${list.join(", ")}? If these nameservers don't hold the domain's records, the site and email stop working.`)) return;
    if (await patch({ nameservers: list }, "Nameservers updated")) setNsDraft(null);
  }

  async function saveForwarding() {
    if (!fwd) return;
    const r = await call("fwd", `/api/domains/${domainId}/forwarding`, { method: "PUT", body: { redirectType: fwd.type, redirectUrl: fwd.url } }, { title: "Forwarding saved" });
    if (r.ok) {
      setFwd(null);
      await load();
      onChanged();
    }
  }

  async function removeForwarding() {
    if (!confirm(`Stop forwarding ${domain}?`)) return;
    const r = await call("fwd-del", `/api/domains/${domainId}/forwarding`, { method: "DELETE" }, { title: "Forwarding removed" });
    if (r.ok) {
      await load();
      onChanged();
    }
  }

  async function getCode() {
    const r = await call<{ code: string | null }>("code", `/api/domains/${domainId}/auth-code`, { method: "POST" });
    setConfirmCode(false);
    if (r.ok) {
      setCode(r.data.code ?? "");
      onChanged();
    }
  }

  async function startMove() {
    const r = await call("move", `/api/domains/${domainId}/move`, { method: "POST", body: { email: moveEmail } }, { title: "Move started", body: "The receiving Hostinger account has to accept it in hPanel." });
    setConfirmMove(false);
    if (r.ok) {
      setMoveEmail("");
      await load();
      onChanged();
    }
  }

  async function cancelMove() {
    if (!confirm(`Cancel moving ${domain}?`)) return;
    const r = await call("move-del", `/api/domains/${domainId}/move`, { method: "DELETE" }, { title: "Move cancelled" });
    if (r.ok) {
      await load();
      onChanged();
    }
  }

  const registrarName = s?.registrar === "cloudflare" ? "Cloudflare" : "Hostinger";

  return (
    <Panel
      icon={Settings2}
      title="Registrar settings"
      description={s ? `Live from ${registrarName}.` : "Live from the registrar."}
      flush
      action={
        s ? (
          <a href={s.dashboardUrl} target="_blank" rel="noreferrer" className={btnGhostSm}>
            Open in {registrarName} <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null
      }
    >
      {error ? (
        <p className="p-4 text-sm text-dropped-fg">{error}</p>
      ) : !s ? (
        <div className="grid place-items-center p-8 text-text-faint">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div>
          {s.message ? <p className="border-b border-border-subtle bg-notready-bg px-4 py-2 text-xs text-notready-fg">{registrarName}: {s.message}</p> : null}

          <Row label="Transfer lock" hint="Stops anyone moving the domain to another registrar. Turn it off only to transfer the domain away.">
            {s.locked === null ? (
              <span className="text-xs text-text-faint">Unknown</span>
            ) : (
              <span className="inline-flex items-center gap-2 text-xs text-text-muted">
                {s.locked ? "Locked" : "Unlocked"}
                <Switch
                  on={s.locked}
                  label="Transfer lock"
                  disabled={!canManage || !s.lockable || busy === "patch"}
                  onChange={(next) => {
                    if (!next && !confirm(`Unlock ${domain}? Only do this right before transferring it to another registrar.`)) return;
                    void patch({ locked: next }, next ? "Domain locked" : "Domain unlocked");
                  }}
                />
              </span>
            )}
          </Row>

          <Row label="WHOIS privacy" hint="Hides the owner's name, email and address from public WHOIS lookups.">
            {s.privacy === null ? (
              <span className="text-xs text-text-faint">Unknown</span>
            ) : (
              <span className="inline-flex items-center gap-2 text-xs text-text-muted">
                {s.privacy ? "Hidden" : "Public"}
                <Switch
                  on={s.privacy}
                  label="WHOIS privacy"
                  disabled={!canManage || !s.privacyAllowed || busy === "patch"}
                  onChange={(next) => void patch({ privacy: next }, next ? "Privacy on" : "Privacy off")}
                />
              </span>
            )}
          </Row>

          <Row
            label="Nameservers"
            hint={s.nameserversEditable ? "Who answers DNS for the domain. Hostinger's are ns1/ns2.dns-parking.com." : "A Cloudflare Registrar domain always uses Cloudflare's nameservers."}
          >
            {nsDraft !== null ? (
              <div className="space-y-2 sm:w-72">
                <textarea className={cn(inputCls, "h-24 font-mono text-xs")} aria-label="Nameservers, one per line" value={nsDraft} onChange={(e) => setNsDraft(e.target.value)} />
                <div className="flex justify-end gap-2">
                  <button type="button" className={btnGhostSm} onClick={() => setNsDraft(null)}>
                    Cancel
                  </button>
                  <button type="button" className={btnSecondarySm} disabled={busy === "patch"} onClick={() => void saveNameservers()}>
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {s.nameservers.length ? (
                  s.nameservers.map((n) => (
                    <p key={n} className="font-mono text-xs text-text">
                      {n}
                    </p>
                  ))
                ) : (
                  <p className="text-xs text-text-faint">—</p>
                )}
                {canManage && s.nameserversEditable ? (
                  <button type="button" className={btnGhostSm} onClick={() => setNsDraft(s.nameservers.join("\n"))}>
                    Change
                  </button>
                ) : null}
              </div>
            )}
          </Row>

          <Row
            label="Forwarding"
            hint={s.forwardingSupported ? "Send every visit to the domain to another web address." : "On Cloudflare, forwarding is a redirect rule on the domain's zone."}
          >
            {!s.forwardingSupported ? (
              <a href="https://dash.cloudflare.com/?to=/:account/:zone/rules/redirect-rules" target="_blank" rel="noreferrer" className={btnGhostSm}>
                Redirect rules <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : fwd ? (
              <div className="space-y-2 sm:w-80">
                <input className={inputCls} aria-label="Forward to" placeholder="https://example.com" value={fwd.url} onChange={(e) => setFwd({ ...fwd, url: e.target.value })} />
                <div className="flex items-center justify-between gap-2">
                  <select className={cn(inputCls, "w-40")} aria-label="Redirect type" value={fwd.type} onChange={(e) => setFwd({ ...fwd, type: e.target.value as "301" | "302" })}>
                    <option value="301">Permanent (301)</option>
                    <option value="302">Temporary (302)</option>
                  </select>
                  <span className="flex gap-2">
                    <button type="button" className={btnGhostSm} onClick={() => setFwd(null)}>
                      Cancel
                    </button>
                    <button type="button" className={btnSecondarySm} disabled={busy === "fwd" || !fwd.url.trim()} onClick={() => void saveForwarding()}>
                      Save
                    </button>
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-text">
                  {s.forwarding ? (
                    <>
                      {s.forwarding.redirectType === "301" ? "Permanently" : "Temporarily"} to <span className="font-mono">{s.forwarding.redirectUrl}</span>
                    </>
                  ) : (
                    <span className="text-text-faint">Not forwarded</span>
                  )}
                </p>
                {canManage ? (
                  <span className="inline-flex gap-1">
                    <button type="button" className={btnGhostSm} onClick={() => setFwd({ url: s.forwarding?.redirectUrl ?? "https://", type: s.forwarding?.redirectType ?? "301" })}>
                      {s.forwarding ? "Change" : "Set up"}
                    </button>
                    {s.forwarding ? (
                      <button type="button" className={btnGhostSm} disabled={busy === "fwd-del"} onClick={() => void removeForwarding()}>
                        Remove
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </div>
            )}
          </Row>

          <Row
            label="Transfer code"
            hint={
              s.authCodeSupported
                ? "The code (EPP) another registrar asks for to take the domain over. Each new code replaces the last. Unlock the domain first."
                : "Cloudflare's API can't give a transfer code — get it in Cloudflare: Manage domains → the domain → Configuration."
            }
          >
            {!s.authCodeSupported ? (
              <a href={s.dashboardUrl} target="_blank" rel="noreferrer" className={btnGhostSm}>
                Get it in Cloudflare <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : code !== null ? (
              <span className="inline-flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1 font-mono text-sm text-text">
                {code || "(none issued)"}
                {code ? <CopyButton value={code} title="Copy the transfer code" /> : null}
              </span>
            ) : canManage ? (
              <button type="button" className={btnSecondarySm} onClick={() => setConfirmCode(true)}>
                <KeyRound className="h-3.5 w-3.5" /> Get transfer code
              </button>
            ) : (
              <span className="text-xs text-text-faint">Admins only</span>
            )}
          </Row>

          <Row
            label="Give to a client"
            hint={
              s.moveSupported
                ? "Move the domain into the client's own Hostinger account. It changes hands once they accept it in hPanel; the dashboard then stops renewing it."
                : "A Cloudflare domain changes hands with a transfer out (transfer code above), done in Cloudflare."
            }
          >
            {!s.moveSupported ? (
              <a href={s.dashboardUrl} target="_blank" rel="noreferrer" className={btnGhostSm}>
                Transfer out in Cloudflare <ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : s.move ? (
              <div className="space-y-1">
                <p className="text-xs text-text">{MOVE_WORDS[s.move.status] ?? s.move.status}</p>
                {canManage && s.move.status === "initiated" ? (
                  <button type="button" className={btnGhostSm} disabled={busy === "move-del"} onClick={() => void cancelMove()}>
                    Cancel move
                  </button>
                ) : null}
              </div>
            ) : canManage ? (
              <div className="flex gap-2 sm:w-80">
                <input className={inputCls} type="email" aria-label="Client's Hostinger account email" placeholder="client's Hostinger email" value={moveEmail} onChange={(e) => setMoveEmail(e.target.value)} />
                <button type="button" className={btnSecondarySm} disabled={!moveEmail.includes("@")} onClick={() => setConfirmMove(true)}>
                  <Send className="h-3.5 w-3.5" /> Move
                </button>
              </div>
            ) : (
              <span className="text-xs text-text-faint">Admins only</span>
            )}
          </Row>
        </div>
      )}

      {confirmCode ? (
        <ConfirmAction title="Get a new transfer code?" confirmLabel="Get code" busy={busy === "code"} onConfirm={() => void getCode()} onClose={() => setConfirmCode(false)}>
          <p>Anyone with this code (and an unlocked domain) can move {domain} to another registrar. A new code replaces any earlier one, and viewing it is logged.</p>
        </ConfirmAction>
      ) : null}
      {confirmMove ? (
        <ConfirmAction title={`Move ${domain} to another account?`} confirmLabel="Start the move" danger busy={busy === "move"} onConfirm={() => void startMove()} onClose={() => setConfirmMove(false)}>
          <p>
            {domain} will move to the Hostinger account <strong className="text-text">{moveEmail}</strong> once they accept it. After that it is theirs: the dashboard can no
            longer renew it or change its DNS.
          </p>
        </ConfirmAction>
      ) : null}
    </Panel>
  );
}
