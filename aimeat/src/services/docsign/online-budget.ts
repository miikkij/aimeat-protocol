/**
 * @file src/services/docsign/online-budget.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How many outbound requests one signature check may still make to the addresses the
 *   checked file's certificates name: issuer certificates (chain.ts) and revocation answers
 *   (revocation.ts).
 *
 *   Each helper had its own small cap (three issuer fetches per chain, two OCSP and two CRL per
 *   certificate), but a check runs them once per signature field, and the file decides how many
 *   fields there are and which public hosts they name. The budget is per check, set by
 *   docsign.max_fetches, and carried with AsyncLocalStorage so the helpers between validatePdf and the
 *   fetches keep their signatures (secaudit2026oct26, validatePdf:no-outbound-budget).
 *
 *   Outside a check, and with the setting at 0, there is no budget and every fetch goes ahead as
 *   before. The EU trusted lists are not counted: their addresses come from the node's own setting,
 *   not from the file, and they are cached for the whole node.
 * @structure withOnlineBudget · takeOnlineFetch · BUDGET_SPENT_NOTE
 * @usage return withOnlineBudget(config.docsignMaxFetches, () => check());
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const budget = new AsyncLocalStorage<{ left: number }>();

/** What the report says where the budget stopped a lookup. */
export const BUDGET_SPENT_NOTE = 'this check made all the outbound requests one check may make (docsign.max_fetches), so this one was not made';

/** Run `fn` with a budget of `max` outbound requests; 0 is no limit. */
export function withOnlineBudget<T>(max: number, fn: () => Promise<T>): Promise<T> {
  return max > 0 ? budget.run({ left: max }, fn) : fn();
}

/** True when one more outbound request may be made, and counts it; false when the budget is spent. */
export function takeOnlineFetch(): boolean {
  const b = budget.getStore();
  if (!b) return true;
  if (b.left <= 0) return false;
  b.left--;
  return true;
}
