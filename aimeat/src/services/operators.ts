/**
 * @file operators.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who the operators of this node are.
 *
 *   The question was answered in three places and two of them disagreed with each other:
 *   services/feedback.ts took the FIRST owner holding the role and notified only that one, while
 *   services/federation-book.ts enumerated them all for the node card. On a node with two operators
 *   the first one silently absorbed every blocker report.
 *
 *   It is one question, so it is one function. `support@operators` needs the full list by
 *   definition — the whole point of the address is that the sender does not have to know which
 *   person is on duty — and everything else is better off with the list too.
 * @structure
 *   - listOperatorGhiis() — every operator's GHII on this node
 *   - findOperatorGhii() — the first, for a single-recipient notification
 * @usage const operators = await listOperatorGhiis(storage, config);
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial, for support@operators; feedback.ts and federation-book.ts fold in.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';

/**
 * Every operator's GHII on this node, in owner-name order so the list is stable between calls.
 *
 * `anonymous` is excluded: it is the placeholder account for unauthenticated activity, and if it
 * ever holds the role, addressing mail to it is not what anyone meant.
 */
export async function listOperatorGhiis(storage: Storage, config: AimeatConfig): Promise<string[]> {
  const owners = await storage.listOwners();
  return owners
    .filter(o => o.name !== 'anonymous' && o.roles?.includes('operator'))
    .map(o => o.name)
    .sort()
    .map(name => `${name}@${config.nodeId}`);
}

/** The first operator, for a notification that genuinely has one recipient. Null on a node with
 *  none — which is a real state (a fresh node before its first owner registers), not an error. */
export async function findOperatorGhii(storage: Storage, config: AimeatConfig): Promise<string | null> {
  const operators = await listOperatorGhiis(storage, config);
  return operators[0] ?? null;
}
