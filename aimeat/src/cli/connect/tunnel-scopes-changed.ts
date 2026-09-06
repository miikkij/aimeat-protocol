/**
 * @file tunnel-scopes-changed.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the connector does with a `scopes_changed` frame. Pure extraction from
 *   tunnel-client.ts when that file passed the 800-line ceiling; the body is verbatim and the client
 *   lends it the four things it needs through ScopeRefreshCtx.
 *
 *   IT IS NOT auth_revoked AND MUST NEVER ACT LIKE IT. That frame stops an identity, which is right
 *   for a dead credential. This news is most often a GRANT, so behaving the same way would kill the
 *   agent that gained a permission.
 * @structure ScopeRefreshCtx; onScopesChanged(ctx, frame)
 * @usage onScopesChanged(this.scopeCtx(), frame);
 * @version-history
 *   v1.0.0 — 2026-09-06 — Extracted from tunnel-client.ts (max-file-lines).
 */
import { forgetCachedToken } from './agent-key.js';
import { gaiiParts } from './agent-gaii.js';
import type { TunnelFrame, TunnelIdentity } from './tunnel-client-types.js';

/** The four things this decision borrows from the client, and nothing else. */
export interface ScopeRefreshCtx {
  label: string;
  /** The socket's own identity, so a frame naming it can be told apart from a passenger's. */
  ownGaii?: string;
  /** The credential this socket is riding on, to answer "would a reconnect change anything". */
  socketToken: string | null;
  attached(gaii: string): TunnelIdentity | undefined;
  /** Re-prove an attached identity with a freshly minted token. Never removes it on failure. */
  reattach(identity: TunnelIdentity): Promise<boolean>;
  /** The socket's own credential hook, asked again after the cache is dropped. */
  ownToken(): Promise<string | null>;
  /** Drop the socket so the client reconnects and re-reads its credential. */
  reconnect(): void;
}

/**
 * FORGETTING THE LOCAL CACHE IS NOT ENOUGH, and the first version of this did only that.
 *
 * A forwarded call is authorized on the NODE against the token pinned when this identity attached
 * (connect-tunnel-forward.ts sends `Bearer ${conn.rawToken}`), so the credential that refuses a call
 * is the node's copy, not the connector's. Re-attaching is what replaces the pin: handleAttach
 * verifies the fresh token and overwrites the connection's rawToken.
 *
 * The socket's OWN credential is pinned at UPGRADE and no frame can replace it, so picking up a
 * GRANT there costs a reconnect — and that cost is only worth paying when a reconnect can actually
 * produce a DIFFERENT credential. An agent with a key mints a new one; an agent carrying a stored
 * bearer gets the same string back, and bouncing a live tunnel to arrive at the token it already had
 * is pure loss (measured: it dropped the tunnel under every test that followed).
 *
 * A REMOVED permission needs none of this. The node narrows an agent's scopes to its record on every
 * request (auth/effective-scopes.ts), so a revocation is already in force before this frame arrives.
 */
export function onScopesChanged(ctx: ScopeRefreshCtx, frame: TunnelFrame): void {
  const named = typeof frame.agent === 'string' ? frame.agent : '';
  const who = named || (ctx.ownGaii ?? '');
  const parts = who ? gaiiParts(who) : null;
  if (parts) forgetCachedToken(parts.agent, parts.owner);

  const attached = named ? ctx.attached(named) : undefined;
  if (attached) {
    void ctx.reattach(attached).then(ok => {
      console.error(`[${ctx.label}] ${named}: permissions changed — ${ok
        ? 're-attached with a fresh credential'
        : 'could not re-attach yet; the previous credential stands until the next reconnect'}`);
    });
    return;
  }

  if (!named || named === ctx.ownGaii) {
    void ctx.ownToken().then(fresh => {
      if (fresh && fresh !== ctx.socketToken) {
        console.error(`[${ctx.label}] Permissions changed — reconnecting with a fresh credential`);
        ctx.reconnect();
        return;
      }
      // Said plainly rather than swallowed. This agent CANNOT pick up an ADDED permission on its
      // own, and nothing else in the system would notice that it did not.
      console.error(`[${ctx.label}] Permissions changed, but this agent holds a stored token it cannot re-mint: an ADDED permission needs \`aimeat connect\` re-run. A REMOVED one is already in force.`);
    }).catch((err: unknown) => {
      console.error(`[${ctx.label}] Permissions changed, and no credential could be obtained to compare against: ${String(err)}`);
    });
    return;
  }

  // A name this socket does not hold: dropped, and said out loud. Every neighbouring case logs what
  // it discards; this one used to fall through in silence.
  console.error(`[${ctx.label}] scopes_changed for ${named}, which this socket does not carry — ignored`);
}
