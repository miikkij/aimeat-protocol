/**
 * @file src/utils/same-account.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Do two names point at the same ACCOUNT of this node? The question "is the caller this
 *   app's (or this extension's) owner" asks it. Each side may be a bare account name, a GHII, a GAII
 *   or a GEAI; both are cut to the account name with localAccountName, which keeps another node's
 *   identity whole so a visitor never matches the local account of the same name, and compared
 *   without letter case, as account names are.
 *
 *   WHY. Seven copies of the app-owner test compared names in different ways: some exactly, one in
 *   lower case, some after cutting at the `@` and some not (secaudit 2026-10, C8).
 * @structure isSameAccount(a, b)
 * @usage if (!isSameAccount(callerOwner, app.ownerName)) return refuse();
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial (secaudit 2026-10, C8).
 */
import { localAccountName } from './gaii.js';

/** True when both name the same account of this node. An empty or missing name matches nothing. */
export function isSameAccount(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return localAccountName(a).toLowerCase() === localAccountName(b).toLowerCase();
}
