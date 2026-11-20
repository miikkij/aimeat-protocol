/**
 * @file src/services/ai-standing/words.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which permissions an owner may give every one of their AIs at once ("Allow always"),
 *   and what the node lets them give.
 *
 *   WHY. Jouni, 2026-11-20: "jos tekoälylle on annettu oikeudet toimia itsenäisemmin niin silloin
 *   ihmishyväksyntää ei tarvita välissä ja se kirjataan vain semmoisenaan", configurable on the node
 *   and by the owner (decision-ai-ei-kysy-kahdesti-itsen-isyys-s-det-n-noden-ja-omistajan-t). An
 *   agent holding `*` already does everything a wildcard carries. What still stops it is a word no
 *   wildcard carries (utils/scope-coverage.ts SCOPES_OUTSIDE_WILDCARD) or one of the powerful words
 *   the person ticks by name (config/posture.ts POWERFUL_AGENT_SCOPES). Those are the words this
 *   setting gives, to every agent of the owner at once.
 *
 *   NEVER GIVEN THIS WAY. The operator's own words (permission-ask.ts OPERATOR_WORDS: nothing to give
 *   on an account that does not run the node), account security, writing the server-trusted records,
 *   and the two words that change agents' permissions: an AI that may widen permissions on its own is
 *   the autonomy escalation services/gate-policy.ts keeps on its floor.
 *
 *   THE NODE DECIDES THE CEILING. config.standingEnabled switches the setting off for everyone;
 *   config.standingMoney and config.standingDelete let owners give the money and the delete words
 *   this way too (both off by default: the operator decides whether an owner may take money and
 *   deletion off the list of things that wait for a person). The operator's ceiling on what any agent
 *   may hold (scopes.max_agent_scopes) holds as well.
 * @structure STANDING_NEVER · STANDING_MONEY · STANDING_DELETE · StandingClass · standingCandidates() ·
 *   standingClassOf(word) · standingRefusal(config, word) · mayStand(config, word)
 * @usage if (mayStand(config, 'publish:public')) { ... }
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-toimii-itsen-isesti-omistajan-asetuksella-salli-aina-ja-k).
 */
import type { AimeatConfig } from '../../config.js';
import { POWERFUL_AGENT_SCOPES } from '../../config/posture.js';
import {
  SCOPES_OUTSIDE_WILDCARD, ACCOUNT_SECURITY_SCOPE, WRITE_RESERVED_SCOPE, PERMISSIONS_ADD_SCOPE, exceedsCeiling,
} from '../../utils/scope-coverage.js';
import { OPERATOR_WORDS } from '../permission-ask.js';

/** Words no owner gives every AI at once, whatever the node says. */
export const STANDING_NEVER: readonly string[] = [
  ...OPERATOR_WORDS,
  ACCOUNT_SECURITY_SCOPE,
  WRITE_RESERVED_SCOPE,
  PERMISSIONS_ADD_SCOPE,
  'agent:permissions',
];

/** The money words: given this way only when the node allows it (config.standingMoney). */
export const STANDING_MONEY: readonly string[] = ['commerce:psp', 'commerce:beneficiary-verify'];

/** The delete words: given this way only when the node allows it (config.standingDelete). */
export const STANDING_DELETE: readonly string[] = ['memory:purge', 'agent:delete', 'messages:delete-as-owner'];

export type StandingClass = 'money' | 'delete' | 'other';

/** Every word the setting can name, in a stable order: the words a person gives by name, less the never-list. */
export function standingCandidates(): string[] {
  const out: string[] = [];
  for (const w of [...SCOPES_OUTSIDE_WILDCARD, ...POWERFUL_AGENT_SCOPES]) {
    if (!STANDING_NEVER.includes(w) && !out.includes(w)) out.push(w);
  }
  return out;
}

export function standingClassOf(word: string): StandingClass {
  if (STANDING_MONEY.includes(word)) return 'money';
  if (STANDING_DELETE.includes(word)) return 'delete';
  return 'other';
}

type StandingConfig = Pick<AimeatConfig, 'standingEnabled' | 'standingMoney' | 'standingDelete' | 'maxAgentScopes'>;

/**
 * Why `word` cannot be given to every AI at once on this node, or null when it can. The codes are the
 * ones the route answers with, so a refusal names the reason the person can act on.
 */
export function standingRefusal(config: StandingConfig, word: string): { code: string; message: string } | null {
  if (config.standingEnabled === false) {
    return { code: 'STANDING_OFF', message: 'This node does not let an owner give permissions to every AI at once. Its operator decides this in Config, under scopes.standing_enabled.' };
  }
  if (!standingCandidates().includes(word)) {
    return { code: 'STANDING_WORD_NOT_GIVEN', message: `${word} is not given to every AI at once: either a wildcard already carries it, or only the account holder in person may use it.` };
  }
  const cls = standingClassOf(word);
  if (cls === 'money' && config.standingMoney !== true) {
    return { code: 'STANDING_MONEY_OFF', message: `${word} handles money. On this node it is given one agent at a time; the operator decides this in Config, under scopes.standing_money.` };
  }
  if (cls === 'delete' && config.standingDelete !== true) {
    return { code: 'STANDING_DELETE_OFF', message: `${word} deletes. On this node it is given one agent at a time; the operator decides this in Config, under scopes.standing_delete.` };
  }
  if (config.maxAgentScopes?.length && exceedsCeiling(config.maxAgentScopes, [word]).length > 0) {
    return { code: 'STANDING_OVER_CEILING', message: `${word} is above what an agent may hold on this node (scopes.max_agent_scopes).` };
  }
  return null;
}

/** May an owner give `word` to every AI at once on this node? */
export function mayStand(config: StandingConfig, word: string): boolean {
  return standingRefusal(config, word) === null;
}
