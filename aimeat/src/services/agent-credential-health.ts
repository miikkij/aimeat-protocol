/**
 * @file src/services/agent-credential-health.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Can each of this account's agents still authenticate, and how do we know?
 *
 *   THE THING THIS ANSWERS. There is nowhere on this node today that says an agent's credential has
 *   died. A v1 agent holds a ninety-day bearer; when it expires the agent simply stops working, and
 *   the fleet view still shows it as an agent with tags and a trust score. Twelve agents were in
 *   that state and the only way to find out was to try one. So this is the reading the Agents
 *   section is built around, and it is deliberately computed rather than stored: a stored verdict
 *   goes stale in exactly the way the thing it describes does.
 *
 *   TWO CREDENTIAL FAMILIES, ONE QUESTION. A v1 agent's proof is a long-lived session, so the
 *   question is "does a live one exist and when does it end". A v2 agent's proof is a pinned key, so
 *   the question is "is the key there and does its card read", and its tokens are minted per use and
 *   are not evidence of anything. Reporting the same word for both would flatten the difference that
 *   matters when somebody is deciding what to fix.
 *
 *   ONE READ PER OWNER. `listActiveSessions(owner)` returns every live session for the account, and
 *   sessions carry the GAII, so the whole fleet is one query and a group-by rather than N.
 *
 * @structure CredentialHealth · credentialHealthForOwner(storage, config, agents)
 * @usage const health = await credentialHealthForOwner(storage, config, agents);
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V3: the Agents section).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, AgentRecord } from '../storage/interface.js';
import { readCardJws } from './agent-card.js';
import { getActiveConnectTunnelManager } from './connect-tunnel.js';
import { logger } from '../utils/logger.js';

/**
 * How long before a credential runs out do we start saying so. A week: long enough that somebody
 * who looks at this page weekly sees it before it bites, short enough that it is not permanently
 * amber on a ninety-day token.
 */
const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

export interface CredentialHealth {
  /** Which credential family this agent belongs to. */
  kind: 'device-token' | 'key-and-card';
  /**
   * The one word for the row.
   *   ok        — it can authenticate.
   *   expiring  — it can, and not for much longer.
   *   dead      — it cannot: the session ran out or was revoked.
   *   never     — it never connected, so there is nothing to have expired.
   *   unreadable — a v2 agent whose stored card cannot be parsed. Should not happen; said out loud.
   */
  state: 'ok' | 'expiring' | 'dead' | 'never' | 'unreadable';
  /** When the longest-lived session ends. Null for a v2 agent, whose tokens are minted per use. */
  expires_at: string | null;
  /**
   * Whole days until `expires_at`, rounded down, so 0 means "today". Null when there is nothing to
   * count down. It is here because a browser has to say this in the reader's own language, and a
   * sentence composed on the node can only be composed in one.
   */
  days_left: number | null;
  /** Live, non-revoked sessions. A v2 agent normally has one per hour of use and this varies. */
  live_sessions: number;
  /** v2 only: the node holds a pinned verification key for this agent. */
  key_pinned: boolean;
  /** v2 only: the stored card parses and names the same agent. */
  card_valid: boolean;
  /** Holding a tunnel socket at this moment. Not part of the verdict: offline is not unhealthy. */
  connected: boolean;
  /**
   * One English sentence, for a reader that has no locale file: an agent asking over MCP, a script,
   * a log line. The browser composes its own from `state`, `kind` and `days_left`.
   */
  summary: string;
}

export async function credentialHealthForOwner(
  storage: Storage, config: AimeatConfig, agents: AgentRecord[],
): Promise<Record<string, CredentialHealth>> {
  const out: Record<string, CredentialHealth> = {};
  if (agents.length === 0) return out;

  const owner = agents[0].owner;
  // An unreadable session table would make every agent look dead, which is a worse answer than a
  // logged failure and an empty read: the caller still gets a page, and an operator can find out.
  const sessions = await storage.listActiveSessions(owner).catch(err => {
    logger.warn('credential health: the session read failed, so every row will read as never-connected', { owner, error: String(err) });
    return [];
  });
  const now = Date.now();
  const liveByGaii = new Map<string, { count: number; latest: number }>();
  for (const s of sessions) {
    if (s.revoked) continue;
    const ends = Date.parse(s.expiresAt);
    if (!Number.isFinite(ends) || ends <= now) continue;
    const seen = liveByGaii.get(s.gaii) ?? { count: 0, latest: 0 };
    liveByGaii.set(s.gaii, { count: seen.count + 1, latest: Math.max(seen.latest, ends) });
  }

  const tunnels = getActiveConnectTunnelManager();

  for (const agent of agents) {
    const live = liveByGaii.get(agent.gaii);
    const connected = !!tunnels?.isConnected(agent.gaii);

    if (agent.identityVersion === 2) {
      const keyPinned = !!agent.publicKey;
      const read = agent.cardJws ? readCardJws(agent.cardJws) : null;
      const cardValid = !!read?.ok && read.card?.gaii === agent.gaii;
      // A v2 agent that never enrolled is `never`, not `dead`: nothing expired, it was simply never
      // finished. The two want different actions from the person reading the row.
      const state: CredentialHealth['state'] = !agent.enrolledAt
        ? 'never'
        : !keyPinned
          ? 'dead'
          : (agent.cardJws && !cardValid) ? 'unreadable' : 'ok';
      out[agent.gaii] = {
        kind: 'key-and-card', state,
        // A key-holding agent has no credential expiry to report: it mints one when it needs one.
        expires_at: null, days_left: null,
        live_sessions: live?.count ?? 0,
        key_pinned: keyPinned, card_valid: cardValid, connected,
        summary:
          state === 'never' ? 'Created, and its connector has not taken it on yet.'
            : state === 'dead' ? 'Its key is missing, so it cannot sign in. Create it again.'
              : state === 'unreadable' ? 'Its card cannot be read. Ask whoever runs this for help.'
                : connected ? 'Signs itself in with its own key, and is connected now.'
                  : 'Signs itself in with its own key whenever it needs to.',
      };
      continue;
    }

    // v1: the long-lived bearer. A live session row is the only evidence the node holds that the
    // credential still works, and its absence is exactly the state nothing used to report.
    //
    // `lastSeen` ALONE DOES NOT SAY IT EVER CONNECTED. Registration stamps `lastSeen: now` next to
    // `createdAt: now`, so a truthy `lastSeen` is true of an agent created a second ago and never
    // touched since. The middleware only moves it past `createdAt` on a real authenticated call, so
    // that comparison is the test. Getting it wrong told every unconnected agent that its sign-in
    // had run out, which sends its owner to reconnect something that was never connected.
    const everSignedIn = !!agent.lastSeen && !!agent.createdAt
      && Date.parse(agent.lastSeen) > Date.parse(agent.createdAt);
    const state: CredentialHealth['state'] = !live
      ? (everSignedIn ? 'dead' : 'never')
      : (live.latest - now < EXPIRING_SOON_MS ? 'expiring' : 'ok');
    // Floored, not rounded: a credential with nineteen hours left has none of tomorrow in it, and
    // "about 1 day" invites somebody to leave it until tomorrow. 0 reads as "today" everywhere.
    const days = live ? Math.max(0, Math.floor((live.latest - now) / 86_400_000)) : 0;
    out[agent.gaii] = {
      kind: 'device-token', state,
      expires_at: live ? new Date(live.latest).toISOString() : null,
      days_left: live ? days : null,
      live_sessions: live?.count ?? 0,
      key_pinned: false, card_valid: false, connected,
      summary:
        state === 'never' ? 'Never connected. Run the connect step to bring it in.'
          : state === 'dead' ? 'Its sign-in has run out, so it cannot get in any more. Connect it again.'
            : state === 'expiring'
              ? (days === 0
                ? 'Its sign-in runs out today. Connect it again now.'
                : `Its sign-in runs out in about ${days} day${days === 1 ? '' : 's'}. Connect it again before then.`)
              : `Signed in, good for about ${days} more day${days === 1 ? '' : 's'}.`,
    };
  }

  void config;
  return out;
}

/** How many agents are in each state, for a fleet heading that says the number without a scan. */
export function summariseCredentialHealth(health: Record<string, CredentialHealth>): Record<CredentialHealth['state'], number> {
  const counts: Record<CredentialHealth['state'], number> = { ok: 0, expiring: 0, dead: 0, never: 0, unreadable: 0 };
  for (const h of Object.values(health)) counts[h.state]++;
  return counts;
}
