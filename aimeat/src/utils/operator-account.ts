/**
 * @file src/utils/operator-account.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Does this ACCOUNT run the node? A question about a stored owner record, never about a
 *   caller: which accounts are operators (to list them, mail them, find the first one), and which
 *   roles a sign-in mints from the record.
 *
 *   WHY ITS OWN NAME. "Is this caller the operator" is askOperator (services/operator-principal.ts),
 *   which asks the principal and the operator:admin word. Both questions were written
 *   `roles.includes('operator')`, so a reader could not tell a record read from a caller check, and
 *   the October 2026 audit found caller checks among them that refused the operator's agent on REST
 *   (secaudit 2026-10, C2). A record read says so by calling this.
 * @structure isOperatorAccount(record)
 * @usage const operators = (await storage.listOwners()).filter(isOperatorAccount);
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C2).
 */

/** True when the stored account record holds the operator role. */
export function isOperatorAccount(record: { roles?: readonly string[] | null } | null | undefined): boolean {
  return !!record?.roles?.includes('operator');
}
