/**
 * @file local-identity.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What class of identity an id names, and whether that identity actually exists on THIS
 *   node. Two questions, one answer each, asked by every surface that takes an id from a caller: the
 *   address book (services/contacts.ts) and direct-message send (services/message-send.ts).
 *
 *   IT LIVES IN ITS OWN MODULE because those two cannot import each other — contacts reaches the
 *   outbound service, and the outbound service sends messages — and because the check had already
 *   been written once, for contacts, while the send path went on accepting names nobody had ever
 *   registered. One question with two implementations is how the second one stays wrong.
 *
 *   EXISTENCE IS ONLY ASKED OF A LOCAL ID. A federated identity lives on a node we cannot
 *   interrogate, and refusing it would make everyone off this node unaddressable, so `null` says
 *   "not ours to judge" and is never read as "no".
 *
 *   THE OWNER IS NOT THE RECIPIENT. An agent and an app have no mailbox of their own — their mail is
 *   delivered to the human who owns them — so a check that stops at the owner passes for every name
 *   under that owner, including the ones that do not exist. Each kind has its own record, and that
 *   record is what is asked for here.
 * @structure IdentityKind; MAIL_PREFIX; identityKind(id); isIdentityShaped(id);
 *   localIdentityExists(storage, config, id) → true | false | null
 * @usage
 *   const exists = await localIdentityExists(storage, config, recipientGhii);
 *   if (exists === false) return { ok: false, code: 'RECIPIENT_NOT_FOUND' };
 * @version-history
 *   v1.0.0 — 2026-09-06 — Extracted from services/contacts.ts so the send path can ask the same
 *     question. aimeat_dm_send answered `delivered`, with a timestamp and a readable thread, for
 *     `<name>#<owner>@<node>` where the owner existed and the agent never had.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGaiiLoose, isValidGAII, isValidGEAI, isValidGHII } from '../utils/gaii.js';

/** The four things an address can be. `mail` is a person this node has no identity for. */
export type IdentityKind = 'geai' | 'gaii' | 'ghii' | 'mail';

/**
 * The address-book id of a person with no identity here. The prefix is load-bearing three times
 * over: identityKind classifies anything without '#' or 'eco:' as a GHII, the Postgres consent key
 * is a `::` string join, and every grant surface needs a way to say "you cannot grant to this one".
 */
export const MAIL_PREFIX = 'mail:';

/** The identity class of an id: person-without-identity, ecosystem app, agent, or human. */
export function identityKind(id: string): IdentityKind {
  if (id.startsWith(MAIL_PREFIX)) return 'mail';
  if (id.startsWith('eco:')) return 'geai';
  if (id.includes('#')) return 'gaii';
  return 'ghii';
}

/**
 * Is this even shaped like an identity?
 *
 * Asked of EVERY id, local or federated, and it is the check that was missing. Existence can only
 * be asked of a local id, so without a shape test anything with an `@` in it was admitted as "a
 * GHII on some other node" — an email address landed in the address book as a person on a node
 * called `example.com`, which every consumer then read as a human and failed on. The node part
 * has a grammar (hyphen-separated lowercase segments, two at minimum, no dots); a mail host does
 * not fit it.
 */
export function isIdentityShaped(id: string): boolean {
  const kind = identityKind(id);
  if (kind === 'gaii') return isValidGAII(id);
  if (kind === 'geai') return isValidGEAI(id);
  if (kind === 'ghii') return isValidGHII(id);
  return false;
}

/**
 * Does this identity exist on this node?
 *
 * `true` it is here, `false` it is not, `null` it is somebody else's node and this is not our
 * question. The three kinds each have their own record; until this existed only GHII was checked,
 * so a contact naming an app that had never been onboarded, under an owner who had never
 * registered, was accepted and stored.
 */
export async function localIdentityExists(
  storage: Storage, config: AimeatConfig, id: string,
): Promise<boolean | null> {
  const kind = identityKind(id);
  const { owner, node } = parseGaiiLoose(id);
  if (node !== config.nodeId) return null;          // not ours to judge
  if (kind === 'ghii') return !!(await storage.getOwner(owner));
  if (kind === 'gaii') return !!(await storage.getAgent(id));
  if (kind === 'geai') return !!(await storage.getEcosystemApp(id));
  return null;
}

/**
 * Why a local id could not be reached, in the words of whoever typed it.
 *
 * A bare "no such recipient" is the least useful true sentence available here: the address the
 * sender wrote is nearly right, and the part that is wrong is the part this can name. The owner is
 * confirmed present before it is mentioned, so the line never implies an account that is not there.
 */
export function missingIdentityReason(id: string): string {
  const kind = identityKind(id);
  const { agent, owner, node } = parseGaiiLoose(id);
  if (kind === 'gaii' || kind === 'geai') {
    const what = kind === 'gaii' ? 'agent' : 'app';
    return `No ${what} named "${agent}" belongs to ${owner} on ${node}. `
      + `The account exists; this ${what} does not. Check the name — one person can have many, and none of them is the account itself.`;
  }
  return `No account named "${owner}" on ${node}.`;
}
