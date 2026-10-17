/**
 * @file src/services/audience.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may see a thing: the ONE decision every content kind asks for the levels between
 *   private and public (plan doc-mvcn6c7e4e5q, V3.0).
 *
 *   A person sees four levels. Private and public each kind already decides its own way, because what
 *   "private" admits differs by kind (an owner's agents, a roster, a sharing group). The two levels in
 *   between were written out separately in each place, and they disagreed: a visitor from another node
 *   passed the skill check for 'members' and the workspace share check for 'account' but not the
 *   memory check, which held only because a visitor carries no scope. This file is the answer for both,
 *   so a new kind asks here instead of writing a fifth version.
 *
 *     members              any account of THIS node, and the agents and apps acting for one. Never
 *                          the anonymous identity, never a session signed in on another node.
 *     organism:<id>        the active members of one organism, and their agents and apps, minus an
 *                          agent the organism does not admit (agentAccess 'listed'). Same exclusions.
 *
 *   An operator gets no pass here: reading another person's organisation content is an operator
 *   override (services/operator-override.ts), decided and written down where it happens.
 *
 *   The audience is written as one string wherever a kind stores it: 'private' | 'members' | 'public'
 *   or 'organism:<id>'. parseAudience reads it back and refuses anything else.
 * @structure Audience · AudienceAuth · parseAudience · formatAudience · isNodeAccount · isOrganismMember · audienceAllows
 * @usage
 *   const a = parseAudience(app.access);          // { level: 'organism', organismId } | ...
 *   if (!(await audienceAllows(storage, a, req.auth))) → refuse
 * @version-history
 *   v1.0.1 — 2026-10-17 — The organism id grammar is utils/visibility-words.ts ORGANISM_ID_RE, which
 *     the request schemas and the tool catalog validate with too (V3.2).
 *   v1.0.0 — 2026-10-17 — Initial (plan doc-mvcn6c7e4e5q, V3.0).
 */
import type { Storage, OrganismRecord } from '../storage/interface.js';
import { agentBarred } from './organism-agent-access.js';
import { ORGANISM_ID_RE } from '../utils/visibility-words.js';

export type AudienceLevel = 'private' | 'members' | 'organism' | 'public';

export interface Audience {
  level: AudienceLevel;
  /** Present exactly when level is 'organism'. */
  organismId?: string;
}

/** The parts of a request's auth this decision reads. A route passes req.auth; MCP passes its session's. */
export interface AudienceAuth {
  sub?: string;
  owner?: string;
  anonymous?: boolean;
  federated?: boolean;
}

/** Read a stored or requested audience. Null for anything that is not one of the four forms. */
export function parseAudience(value: unknown): Audience | null {
  if (value === 'private' || value === 'members' || value === 'public') return { level: value };
  if (typeof value === 'string' && value.startsWith('organism:')) {
    const organismId = value.slice('organism:'.length);
    return ORGANISM_ID_RE.test(organismId) ? { level: 'organism', organismId } : null;
  }
  return null;
}

/** The one string an audience is stored as. */
export function formatAudience(a: Audience): string {
  return a.level === 'organism' ? `organism:${a.organismId}` : a.level;
}

/** Signed in on THIS node: not the shared anonymous identity, not a session from another node. */
export function isNodeAccount(auth: AudienceAuth | null | undefined): boolean {
  return !!auth && auth.anonymous !== true && auth.federated !== true && typeof auth.owner === 'string' && auth.owner.length > 0;
}

/**
 * Is this caller in the organism: its owner an active member, and, when the caller is an agent, an
 * agent the organism admits. False for an organism that does not exist.
 */
export async function isOrganismMember(
  storage: Storage, organismId: string, auth: AudienceAuth | null | undefined,
  known?: OrganismRecord | null,
): Promise<boolean> {
  if (!isNodeAccount(auth)) return false;
  const organism = known ?? await storage.getOrganism(organismId);
  if (!organism || organism.id !== organismId) return false;
  if (agentBarred(organism, auth!.sub)) return false;
  const m = await storage.getMembership(organismId, auth!.owner!);
  return !!m && m.status === 'active';
}

/**
 * Does the audience admit this caller? 'private' answers true only for the owner the caller names
 * (`ownerName`, the content owner's bare account name); a kind whose private level admits more asks
 * its own rule first and comes here for the levels in between.
 */
export async function audienceAllows(
  storage: Storage,
  audience: Audience | null,
  auth: AudienceAuth | null | undefined,
  opts: { ownerName?: string } = {},
): Promise<boolean> {
  if (!audience) return false;
  switch (audience.level) {
    case 'public': return true;
    case 'members': return isNodeAccount(auth);
    case 'organism': return !!audience.organismId && isOrganismMember(storage, audience.organismId, auth);
    case 'private': return isNodeAccount(auth) && !!opts.ownerName && auth!.owner === opts.ownerName;
  }
}
