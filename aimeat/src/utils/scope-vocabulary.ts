/**
 * @file src/utils/scope-vocabulary.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's scope vocabulary on the server: every permission word an owner can give an
 *   agent. The source of truth is the agent page's scope model, SCOPE_DOMAINS in
 *   public/views/profile/agents/scope-model.js, the list check:scope-parity reads
 *   (scripts/inventory/scope-vocabulary.ts readVocabulary) and scope-vocabulary-parity holds to the
 *   words the node enforces. That file is browser JavaScript a server module does not import, so this
 *   is its mirror, and test/unit/scope-vocabulary-mirror.test.ts asserts the two hold the same words:
 *   a word added to one and not the other fails that test.
 *
 *   Read by the operator-services validator (config/operator-services.ts), which refuses an entry word
 *   the vocabulary does not know.
 * @structure SCOPE_VOCABULARY_DOMAINS · SCOPE_VOCABULARY · isVocabularyWord
 * @usage if (!isVocabularyWord(word)) refuse();
 * @version-history
 *   v1.1.0 — 2026-11-26 — operator:service-provision, as the agent page's operator row now lists it.
 *   v1.0.0 — 2026-11-26 — Initial (operator services: a known word is a vocabulary word, F1).
 */

/** Domain → its permissions, as SCOPE_DOMAINS lists them. */
export const SCOPE_VOCABULARY_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  memory: ['read', 'write', 'delete', 'purge', 'read-as-owner', 'write-as-owner', 'write-reserved'],
  storage: ['read', 'write'],
  ai: ['use'],
  work: ['request', 'read', 'accept', 'publish'],
  social: ['read', 'write', 'members'],
  messages: ['send', 'read', 'send-as-owner', 'read-as-owner', 'delete-as-owner', 'organize-as-owner'],
  contacts: ['read'],
  wallet: ['read'],
  consent: ['manage', 'read-as-owner', 'groups'],
  share: ['manage'],
  tunnel: ['connect'],
  catalogue: ['read'],
  task: ['read', 'write'],
  workflow: ['read', 'write'],
  finance: ['read', 'write'],
  outbound: ['send'],
  signals: ['read', 'write'],
  company: ['read', 'write'],
  connections: ['read', 'write', 'use', 'read-through', 'read-as-owner'],
  mcp: ['read', 'use', 'manage'],
  notifications: ['send'],
  exchange: ['read', 'invoke', 'write', 'grant', 'beneficiary'],
  commerce: ['sell', 'buy', 'psp', 'beneficiary-verify'],
  organism: ['read', 'write', 'invite', 'rows', 'direct'],
  provenance: ['write'],
  cortex: ['write'],
  ext: ['write', 'invoke'],
  packages: ['read', 'write'],
  secrets: ['manage', 'share'],
  help: ['ask', 'answer'],
  publish: ['public'],
  party: ['manage'],
  csm: ['write'],
  receivers: ['read', 'manage'],
  agent: ['read', 'write', 'permissions', 'permissions-add', 'delete'],
  app: ['write', 'manage'],
  capability: ['write'],
  account: ['security'],
  operator: ['organism-repair', 'admin', 'service-provision'],
  compliance: ['read', 'write'],
  site: ['layout-write', 'theme-write'],
};

/** Every word of the vocabulary, `domain:permission`. */
export const SCOPE_VOCABULARY: readonly string[] = Object.freeze(
  Object.entries(SCOPE_VOCABULARY_DOMAINS).flatMap(([d, ps]) => ps.map((p) => `${d}:${p}`)),
);

/** True for a word of the vocabulary. */
export function isVocabularyWord(word: string): boolean {
  return SCOPE_VOCABULARY.includes(word);
}
