/**
 * @file owner-key-sign-in.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether the node under test still takes the owner-key sign-in (POST /v1/auth/token
 *   with an owner name and an account-key signature), so a suite that sends one can expect the exact
 *   answer instead of "one of two".
 *
 *   WHY. The sign-in is deprecated and removed in OWNER_KEY_LOGIN_REMOVED_IN (4.0.0) whatever
 *   security.owner_key_login says; before that release the setting decides (src/config-security.ts
 *   ownerKeyLoginAllowed). Two suites accepted "403 or 410" and "401 or 410" without asking which
 *   applied, so a 3.x node that answered 410 with the sign-in on, or a 4.0.0 node that still checked
 *   the signature, passed them (docs-audit 2026-10, 4.0-testimuutokset.md §4 item 2). The release is
 *   read from GET /v1/build (helpers/node-release.ts) and the setting from GET /v1/admin/config, so
 *   both halves come from the node and not from the test process's environment.
 * @structure ownerKeySignInOn(base, operatorToken) · OWNER_KEY_LOGIN_REMOVED_IN (re-exported)
 * @usage
 *   import { ownerKeySignInOn, OWNER_KEY_LOGIN_REMOVED_IN } from './helpers/owner-key-sign-in.js';
 *   const on = await ownerKeySignInOn(BASE, operatorToken);
 *   if (on) { ...expect the 3.x answer } else { ...expect 410 OWNER_KEY_LOGIN_OFF }
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial (4.0-testimuutokset.md §4 item 2).
 */
import { OWNER_KEY_LOGIN_REMOVED_IN } from '../../src/config-security.js';
import { removedOn } from './node-release.js';

export { OWNER_KEY_LOGIN_REMOVED_IN };

/**
 * True when the node at `base` runs a release before OWNER_KEY_LOGIN_REMOVED_IN AND has
 * security.owner_key_login on. Reading the setting needs an operator's bearer; a caller that is not
 * one gets a throw, never a guess.
 */
export async function ownerKeySignInOn(base: string, operatorToken: string): Promise<boolean> {
    if (await removedOn(base, OWNER_KEY_LOGIN_REMOVED_IN)) return false;
    const res = await fetch(`${base}/v1/admin/config`, { headers: { Authorization: `Bearer ${operatorToken}` } });
    const body = await res.json() as { data?: { schema?: Record<string, { value?: unknown }> } };
    const value = body?.data?.schema?.['security.owner_key_login']?.value;
    if (!res.ok || typeof value !== 'boolean') {
        throw new Error(`GET /v1/admin/config answered ${res.status} without security.owner_key_login (the caller must be an operator)`);
    }
    return value;
}
