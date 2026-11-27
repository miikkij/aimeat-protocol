/**
 * @file src/services/operator-services/entries.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The entries of agents.operator_services as the running node reads them. The static
 *   check ran when the setting was written (config/operator-services.ts); this adds what depends on
 *   the running node and is asked on every read, because the node's maximum agent scopes can change
 *   after the write: every word inside config.maxAgentScopes, and every word one the node knows (a
 *   word some MCP tool or the node's default agent scopes name). An entry whose words fail now is
 *   not offered: the provisioning branch falls through, and the sweep NARROWS its agents to the
 *   words that still pass (it does not end them): each loses the words the service gave that no
 *   longer pass, and keeps what the person added (services/operator-services/sweep.ts).
 *
 *   THE PRIVATE-READ EXCEPTION. A word no wildcard carries is never an entry's to give, with one named
 *   exception (config/operator-services.ts OPERATOR_SERVICE_OUTSIDE_WILDCARD_ALLOWED, ruling
 *   2026-11-26): memory:read-as-owner, when the entry also gives `private_read_reason`. entryNow()
 *   reads any other such word as over the node's maximum, so allowedScopes, the approval, the sweep
 *   and the required-agent check all see the exception in one place.
 * @structure ServiceEntryNow · knownScopeWords · entryNow · entriesNow · privateReadGranted · inAudience ·
 *   isRequired · entryById
 * @usage const entry = entryById(config, 'desk-helper'); if (entry?.usable) ...
 * @version-history
 *   v1.1.0 — 2026-11-26 — inAudience, isRequired and privateReadGranted: the phase-2 policy, read at
 *     request time; entryNow passes an outside-wildcard word only as the private-read exception.
 *   v1.0.2 — 2026-11-26 — A known word is a word of the scope vocabulary (utils/scope-vocabulary.ts), not of the MCP tool table.
 *   v1.0.1 — 2026-11-26 — The header says what the sweep does with an entry the node's maximum narrowed.
 *   v1.0.0 — 2026-11-26 — Initial (wish-situatedai-koko-henkil-st-lle-ilman-henkil-kohtaisia-hyv-ksy).
 */
import type { AimeatConfig } from '../../config.js';
import type { OperatorServiceEntry } from '../../config/operator-services.js';
import { operatorServiceProblem, OPERATOR_SERVICE_OUTSIDE_WILDCARD_ALLOWED, PRIVATE_READ_WORD } from '../../config/operator-services.js';
import { exceedsCeiling, isOutsideWildcard } from '../../utils/scope-coverage.js';
import { SCOPE_VOCABULARY } from '../../utils/scope-vocabulary.js';

/** An entry as the running node reads it. */
export interface ServiceEntryNow extends OperatorServiceEntry {
  /** The entry's words that pass the node's maximum and are known to the node now. */
  allowedScopes: string[];
  /** Enabled, and every word passes now: the branch may approve for it. */
  usable: boolean;
  /** Why it is not usable, when it is enabled and is not. */
  problem?: string;
}

/** Every word the node knows: its scope vocabulary (utils/scope-vocabulary.ts), and its default agent scopes. */
export function knownScopeWords(config: Pick<AimeatConfig, 'defaultAgentScopes'>): Set<string> {
  return new Set([...SCOPE_VOCABULARY, ...config.defaultAgentScopes]);
}

/** One entry, checked against the running node. */
export function entryNow(config: Pick<AimeatConfig, 'maxAgentScopes' | 'defaultAgentScopes'>, e: OperatorServiceEntry): ServiceEntryNow {
  const words = knownScopeWords(config);
  // A word no wildcard carries passes only as the named exception, memory:read-as-owner with its
  // reason (privateReadGranted); any other such word is read as over the node's maximum, so it is
  // never granted and the sweep takes it back.
  const over = new Set([
    ...exceedsCeiling(config.maxAgentScopes, e.scopes),
    ...e.scopes.filter((s) => isOutsideWildcard(s) && !(s === PRIVATE_READ_WORD && privateReadGranted(e))),
  ]);
  const unknown = e.scopes.filter((s) => !words.has(s));
  const allowedScopes = e.scopes.filter((s) => !over.has(s) && words.has(s));
  const problem = over.size > 0
    ? `${[...over].join(', ')} is outside the most this node allows an agent (scopes.max_agent_scopes).`
    : unknown.length > 0 ? `${unknown.join(', ')} is no permission this node knows.` : undefined;
  return { ...e, allowedScopes, usable: e.enabled && !problem, ...(problem ? { problem } : {}) };
}

/**
 * Every entry of the setting, checked now. A running value the static check refuses (written by a
 * path that skipped it) is read as no entries, the safe direction.
 */
export function entriesNow(config: Pick<AimeatConfig, 'operatorServices' | 'maxAgentScopes' | 'defaultAgentScopes'>): ServiceEntryNow[] {
  const list = config.operatorServices ?? [];
  if (operatorServiceProblem(list) !== null) return [];
  return list.map((e) => entryNow(config, e));
}

/**
 * The private-read exception (ruling 2026-11-26): the entry names memory:read-as-owner and gives the
 * reason the person reads. Only this word, and only with its reason, passes outside the wildcard.
 */
export function privateReadGranted(entry: Pick<OperatorServiceEntry, 'scopes' | 'private_read_reason'>): boolean {
  return OPERATOR_SERVICE_OUTSIDE_WILDCARD_ALLOWED.includes(PRIVATE_READ_WORD)
    && entry.scopes.includes(PRIVATE_READ_WORD)
    && typeof entry.private_read_reason === 'string' && entry.private_read_reason.trim().length > 0;
}

/** Is `account` in the entry's audience? "all" (the default) covers every account. Read at request time. */
export function inAudience(entry: Pick<OperatorServiceEntry, 'audience'>, account: string): boolean {
  const a = entry.audience;
  return !a || a === 'all' || a.accounts.includes(account);
}

/** Is the entry required? Read at request time from the present setting. */
export function isRequired(entry: Pick<OperatorServiceEntry, 'required'> | null | undefined): boolean {
  return entry?.required === true;
}

/** The entry with this id, checked now, or null. */
export function entryById(config: Pick<AimeatConfig, 'operatorServices' | 'maxAgentScopes' | 'defaultAgentScopes'>, id: string): ServiceEntryNow | null {
  return entriesNow(config).find((e) => e.id === id) ?? null;
}
