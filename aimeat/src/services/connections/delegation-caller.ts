/**
 * @file src/services/connections/delegation-caller.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may publish through a delegation over a shared channel.
 *
 *   A delegation gives ONE app one action over a channel, and the app's users publish through it: a
 *   campaign where many people post through one app. The publish names the delegation by the app id
 *   and action in the request body, and those are labels a channel owner types, so the body alone
 *   does not say that the caller is the app or one of its users. This module answers that from the
 *   signed token instead (secaudit2026oct26, delegated-publish/app-id-not-bound-to-caller).
 *
 *   WHO PUBLISHES THROUGH IT, unchanged from before:
 *     - the app itself, through any user's grant for it (the token's signed `app` claim);
 *     - an ecosystem app the delegation names (the token's signed `eco_app` claim);
 *     - a person who uses the app (a live grant for it), in person or through their agents;
 *     - the channel owner, in person, through their agents or through their own apps.
 *   A caller that is none of these only wrote the app's name in the body, and is refused with a
 *   sentence that names the app to publish through.
 *
 *   THE LABEL. Delegations were written as free labels (`app:funvids` in the suite) and keep working
 *   as they are, with no stored change: `app:` and `eco:` in front are dropped, and the rest names an
 *   app the way the AI doors already accept a body app id (services/ai-app-id.ts namesSignedApp): its
 *   file name with or without `.html`, or its full `owner/filename`. A channel owner who types the full
 *   `owner/filename` binds the delegation to exactly that app.
 * @structure namesDelegationApp · delegationCallerRefusal
 * @usage const refusal = await delegationCallerRefusal(storage, config.nodeId, req.auth!, appId, action);
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26, delegated-publish/app-id-not-bound-to-caller).
 */
import type { Storage } from '../../storage/interface.js';
import type { VerifiedToken } from '../../auth/jwt.js';
import { namesSignedApp } from '../ai-app-id.js';
import { localAccountOf, ownerGhiiOf, resolveIdentity } from '../../utils/gaii.js';

/** The label without the `app:` or `eco:` a channel owner may have typed in front of it. */
function bareLabel(label: string): string {
  return label.trim().replace(/^(app|eco):/i, '');
}

/** True when a delegation's label names the signed app `signed` (`owner/filename`). */
export function namesDelegationApp(label: string, signed: string): boolean {
  const bare = bareLabel(label);
  return bare !== '' && namesSignedApp(bare, signed);
}

/** True when a delegation's label names the ecosystem app `ecoApp` (its global name). */
function namesEcoApp(label: string, ecoApp: string): boolean {
  return bareLabel(label).toLowerCase() === ecoApp.trim().toLowerCase();
}

export interface DelegationCallerRefusal { code: 'DELEGATION_NOT_FOR_CALLER'; reason: string }

/**
 * null when the caller may publish through the delegation (appId, action), or when there is no such
 * delegation (the publish gate answers that one as before). Otherwise the refusal to send.
 */
export async function delegationCallerRefusal(
  storage: Storage,
  nodeId: string,
  auth: VerifiedToken,
  appId: string,
  action: string,
): Promise<DelegationCallerRefusal | null> {
  const delegation = await storage.findDelegation(appId, action);
  if (!delegation) return null;
  const connection = await storage.getConnection(delegation.connectionId);
  if (!connection) return null;

  // The channel owner, and every principal acting for them.
  const callerOwner = ownerGhiiOf(resolveIdentity(auth, nodeId));
  if (callerOwner === ownerGhiiOf(connection.principal)) return null;

  const label = delegation.appId;
  const refusal: DelegationCallerRefusal = {
    code: 'DELEGATION_NOT_FOR_CALLER',
    reason: `The channel owner gave the action "${action}" to the app "${label}", so it is published through that app. `
      + 'Open that app, sign in to it, and publish from there. After that, your agents can publish through it for you too.',
  };

  // An app acts as itself: its own signed id, never the body's.
  if (auth.roles.includes('app')) return auth.app && namesDelegationApp(label, auth.app) ? null : refusal;
  if (auth.roles.includes('ecosystem')) return auth.eco_app && namesEcoApp(label, auth.eco_app) ? null : refusal;

  // A person who uses the app, in person or through an agent: a live grant for it on their account.
  const account = localAccountOf(callerOwner);
  if (!account) return refusal;
  const grants = await storage.listAppGrantsByOwner(account);
  return grants.some(g => !g.revoked && namesDelegationApp(label, g.app)) ? null : refusal;
}
