/**
 * @file oauth-rounds.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's confirmation of an outside sign-in round that was started outside their
 *   browser: an agent connecting a mailbox (aimeat_connection_start), an agent or a CLI signing a
 *   remote MCP server in (aimeat_mcp_authorize, POST /v1/mcp-servers/:id/authorize).
 *
 *   WHY THE ROUND WAITS (secrets audit 2026-10-09, chapter 2). Such a round has no browser to bind
 *   to, so its callback refuses everything. The owner opens the node's page (/v1/oauth-round), sees
 *   what the round connects and to whom, and confirms; the confirmation binds the round to that
 *   browser (routes/oauth-rounds.ts sets the cookie) and hands over the provider's address. A third
 *   party who receives the address from an agent cannot confirm it, because only the round's owner
 *   in person can, and a provider approval in any other browser connects nothing.
 *
 *   THE ROUND IS RE-WRITTEN, NOT UPDATED. Binding consumes the stored row (the delete that removes it
 *   is the one that goes on) and writes it again with the binding, under the same state and expiry.
 *   Two confirmations at once bind once; the storage needs no update method for one field. A round
 *   that already carries a binding is refused, so a later confirmation cannot re-bind it.
 * @structure findOwnersRound · describeRound · bindRound
 * @usage const found = await findOwnersRound(storage, state, caller.ownerGhii);
 * @version-history
 *   v1.1.0 — 2026-10-10 — bindRound refuses a round that is already bound (secaudit 2026-10-10 I6).
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, chapter 2).
 */
import type { Storage } from '../storage/interface.js';
import type { VerificationNonceRecord } from '../storage/types/auth.js';
import type { OutboundProvider } from './connections/providers.js';
import { findProvider } from './connections/providers.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';

export type RoundKind = 'account' | 'mcp_server';

export interface OwnersRound {
  kind: RoundKind;
  round: VerificationNonceRecord;
  payload: Record<string, unknown>;
}

/** What the confirmation page shows. No secret and no provider address: those come with the confirmation. */
export interface RoundView {
  kind: RoundKind;
  /** The identity the account or the sign-in will belong to: the owner, or one of their agents. */
  for: string;
  /** Who asked for it, when that differs from `for` (an agent signing in the owner's MCP server). */
  started_by: string;
  provider: string | null;
  provider_label: string | null;
  server: { id: string; slug: string; title: string } | null;
  expires_at: string;
}

const KIND_OF: Record<string, RoundKind> = { connect: 'account', mcp_connect: 'mcp_server' };

/**
 * The waiting round under `state`, when it belongs to `ownerGhii`: the owner's own, or one of
 * their agents'. Null for anything else, absent and not-yours alike, and for an expired round.
 */
export async function findOwnersRound(storage: Storage, state: string, ownerGhii: string): Promise<OwnersRound | null> {
  if (!state) return null;
  const round = await storage.getVerificationNonce(state);
  const kind = round ? KIND_OF[round.type] : undefined;
  if (!round || !kind) return null;
  if (new Date(round.expiresAt).getTime() < Date.now()) return null;
  if (ownerGhiiOf(round.owner) !== ownerGhii) return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(round.payload ?? '{}') as Record<string, unknown>;
  } catch {
    logger.warn('oauth-rounds: a waiting round has an unreadable payload and cannot be confirmed', { type: round.type });
    return null;
  }
  if (typeof payload.authorizeUrl !== 'string' || !payload.authorizeUrl) return null;
  return { kind, round, payload };
}

/** The round as the confirmation page shows it. */
export async function describeRound(storage: Storage, providers: OutboundProvider[], found: OwnersRound): Promise<RoundView> {
  const { kind, round, payload } = found;
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  if (kind === 'account') {
    const id = str(payload.provider);
    const provider = id ? findProvider(providers, id) : undefined;
    return {
      kind, for: round.owner, started_by: round.owner,
      provider: id, provider_label: provider?.label ?? id, server: null, expires_at: round.expiresAt,
    };
  }
  const serverId = str(payload.serverId);
  const server = serverId ? await storage.getMcpServer(serverId) : undefined;
  return {
    kind, for: round.owner, started_by: str(payload.startedBy) ?? round.owner,
    provider: null, provider_label: null,
    server: server ? { id: server.id, slug: server.slug, title: server.title } : null,
    expires_at: round.expiresAt,
  };
}

/**
 * Bind the round to the browser whose binding hashes to `bindHash`, and return the provider's
 * address to send that browser to. Null when somebody else consumed the round first.
 */
export async function bindRound(storage: Storage, found: OwnersRound, bindHash: string): Promise<{ authorizeUrl: string } | null> {
  const { round, payload } = found;
  // Compare-and-set (secaudit 2026-10-10 I6): a round already bound to a browser stays bound to it.
  // The delete below cannot refuse alone, because the bound round is re-written under the same state
  // and a later delete finds it; without this check a second approve re-bound it with 200.
  if (typeof payload.bind === 'string' && payload.bind) return null;
  if (!(await storage.deleteVerificationNonce(round.state))) return null;
  // A round an agent started usually names no page to come back to; the owner confirmed it in this
  // browser, so the browser lands on the page that says the account is connected.
  const back = '/connection-done.html';
  await storage.createVerificationNonce({
    ...round,
    redirectUri: round.redirectUri || back,
    payload: JSON.stringify({ ...payload, bind: bindHash, ...(found.kind === 'mcp_server' && !payload.returnUrl ? { returnUrl: back } : {}) }),
  });
  return { authorizeUrl: payload.authorizeUrl as string };
}
