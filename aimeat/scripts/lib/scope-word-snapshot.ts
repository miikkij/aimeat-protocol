/**
 * @file scripts/lib/scope-word-snapshot.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pure half of check:scope-words: which scope words were added to an MCP tool or a
 *   REST route that already existed, and whether each addition is answered by a keep-working step this
 *   change brings, or by a reason written down for it. scripts/check-scope-words.ts reads the code and
 *   the snapshot; this module decides.
 * @structure WordMap · ScopeWordSnapshot · ScopeKeepStep · addedWords · answerAddition · routeScopeWords ·
 *   sortedWordMap
 * @usage import { addedWords, answerAddition } from './lib/scope-word-snapshot.js';
 * @version-history
 *   v1.0.0 -- 2026-11-21 -- Initial (docs/pitfalls.md §119 and §6, third bullet, now deleted).
 */

/** Tool name or route key → the scope words it requires, sorted. */
export type WordMap = Record<string, string[]>;

/** security/scope-word-snapshot.json. */
export interface ScopeWordSnapshot {
  note: string;
  /** The once-only keys of the keep-working steps that existed when the snapshot was written. */
  steps: string[];
  /** `<tool or route> <word>` → why this word was added without a step (a narrowing on purpose). */
  accepted: Record<string, string>;
  tools: WordMap;
  routes: WordMap;
}

/** One once-per-node step that hands words to principals approved before the words were asked. */
export interface ScopeKeepStep {
  /** The step's once-only record key (services/once-only-step.ts). */
  key: string;
  /** The function the boot calls (server-bootstrap/service-init.ts or once-only-keep-steps.ts). */
  run: string;
  /** The file that holds it. */
  file: string;
  /** Every word the step may hand out. */
  words: readonly string[];
}

/** One word on one tool or route that the snapshot did not have there. */
export interface Addition { surface: 'tool' | 'route'; key: string; word: string }

/** Words in `current` that `snapshot` did not have for the same key. A key the snapshot never had is new, not narrowed. */
export function addedWords(surface: Addition['surface'], snapshot: WordMap, current: WordMap): Addition[] {
  const out: Addition[] = [];
  for (const [key, words] of Object.entries(current)) {
    const before = snapshot[key];
    if (!before) continue;
    for (const word of words) if (!before.includes(word)) out.push({ surface, key, word });
  }
  return out;
}

/**
 * What answers one addition: `accepted` when a reason is written for it, the key of a step this
 * change brings (not in the snapshot's `steps`) that hands the word out, or null when nothing does.
 * A step the snapshot already knows has run on every node that booted since, once, so it cannot
 * carry a word added after it.
 */
export function answerAddition(
  add: Addition, steps: readonly ScopeKeepStep[], snapshot: Pick<ScopeWordSnapshot, 'steps' | 'accepted'>,
): string | null {
  if (snapshot.accepted[`${add.key} ${add.word}`]) return 'accepted';
  const known = new Set(snapshot.steps);
  const step = steps.find(s => !known.has(s.key) && s.words.includes(add.word));
  return step ? step.key : null;
}

/** The scope words a route's middleware section names literally: requireScope('x') and requireRestScope('x'). */
export function routeScopeWords(chain: string): string[] {
  const words = new Set<string>();
  for (const m of chain.matchAll(/\brequire(?:Rest)?Scope\(\s*(['"`])([a-z][\w:.*-]*)\1/g)) words.add(m[2]);
  return [...words].sort();
}

/** A word map with its keys and word lists sorted, so the snapshot file diffs cleanly. */
export function sortedWordMap(map: WordMap): WordMap {
  return Object.fromEntries(Object.keys(map).sort().map(k => [k, [...new Set(map[k])].sort()]));
}
