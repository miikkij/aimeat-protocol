/**
 * @file src/services/app-grant-scopes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an app grant keeps when the node rewrites its words: the words the app declares
 *   or the owner approved on the consent screen, and the words the owner added to the grant by hand.
 *
 *   WHY THE SECOND KIND EXISTS. A grant follows the app's own declaration (`<meta name="aimeat-scopes">`)
 *   down: every refresh and every silent sign-in trims away a word the app no longer asks for
 *   (routes/app-grants.ts). That is right for the words the app asked for, and wrong for a word the
 *   OWNER added: connections:read-through, which reading a connected mailbox has needed since
 *   2026-09-24, is added by the owner's own tap to a grant whose app never declared it, and the next
 *   refresh would take it away again. So the grant records such words (`ownerAddedScopes`), and every
 *   rewrite keeps them until the owner takes them away, on the grants page or on the door that added
 *   them. The app's declaration still adds nothing: a word it asks for and the grant lacks goes to the
 *   consent screen, as before.
 * @structure READ_THROUGH_SCOPE · heldOwnerAdded(grant) · narrowToDeclared(stored, declared, ownerAdded)
 *   · afterApproval(approved, existing, shown)
 * @usage import { afterApproval, heldOwnerAdded } from '../services/app-grant-scopes.js';
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial.
 */

/** Reading what is in a connected account. The first word an owner adds to a grant by hand. */
export const READ_THROUGH_SCOPE = 'connections:read-through';

/** The part of a grant this module reads. */
export interface GrantWords { scopes?: string[] | null; ownerAddedScopes?: string[] | null }

/** The words the owner added to this grant by hand that it still holds. */
export function heldOwnerAdded(grant: GrantWords | null | undefined): string[] {
  const held = new Set(grant?.scopes ?? []);
  return [...new Set((grant?.ownerAddedScopes ?? []).filter(s => held.has(s)))];
}

/** A grant brought down to what its app declares: the stored words it declares, and the owner's own. */
export function narrowToDeclared(stored: string[], declared: string[], ownerAdded: string[]): string[] {
  return stored.filter(s => declared.includes(s) || ownerAdded.includes(s));
}

/**
 * A grant after an approval of `approved`: those words, and the words the owner added by hand that
 * the grant holds. `shown` is what a consent screen listed; a word the owner added that was on the
 * screen and left unticked is the owner taking it away, so it goes. Nothing was shown on a silent
 * sign-in, so there every word the owner added stays.
 */
export function afterApproval(
  approved: string[], existing: GrantWords | null | undefined, shown: string[] = [],
): { scopes: string[]; ownerAddedScopes: string[] } {
  const kept = heldOwnerAdded(existing).filter(s => approved.includes(s) || !shown.includes(s));
  return { scopes: [...new Set([...approved, ...kept])], ownerAddedScopes: kept };
}
