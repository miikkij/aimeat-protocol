/**
 * @file src/services/sso-adoption-notice.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The person is told when their organisation's SAML sign-in opened their account without
 *   their two-step code (secaudit2026oct26, scim-users.ts createUser adoption-skips-second-factor).
 *
 *   An account the organisation's directory adopted through SCIM is opened by the organisation's
 *   sign-in through the adoption key: the directory vouches for the account, and lifecycle authority
 *   moved to the connection at adoption. On an account with two-step sign-in that first sign-in does
 *   not ask the code, which the password, the sign-in link and an address match all ask. The sign-in
 *   stays as it is, and the person gets a bell notice that says so, once, at the sign-in that linked
 *   the organisation's identity; the sign-ins after it go through the linked identity.
 * @structure SSO_SIGNED_IN_PAST_CODE_TYPE · tellSignedInPastCode
 * @usage if (result.adoptedNow && twoStepArmed(result.ghii)) void tellSignedInPastCode(storage, result.ghii, conn);
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import type { Storage, GHIIRecord, SsoConnectionRecord } from '../storage/interface.js';
import { notify } from './notify.js';
import { logger } from '../utils/logger.js';

export const SSO_SIGNED_IN_PAST_CODE_TYPE = 'sso_signed_in_past_code';

/** Tell the person, in the bell. Never throws: the sign-in already stands. */
export async function tellSignedInPastCode(
  storage: Storage, ghii: Pick<GHIIRecord, 'ghii'>, conn: Pick<SsoConnectionRecord, 'id' | 'name'>,
): Promise<void> {
  const organisation = conn.name || conn.id;
  try {
    await notify(storage, ghii.ghii, {
      type: SSO_SIGNED_IN_PAST_CODE_TYPE,
      title: `${organisation} sign-in opened your account without your code`,
      body: `Your organisation's directory manages your account, so the sign-in of ${organisation} opened it `
        + 'without your two-step sign-in code. If this was not you, change your password on your Access page '
        + 'and tell your organisation.',
      link: '/v1/profile#access',
      i18n: { key: SSO_SIGNED_IN_PAST_CODE_TYPE, vars: { organisation } },
      actions: [{ id: 'open', label: 'Open the Access page', kind: 'navigate', link: '/v1/profile#access', i18n: { key: `${SSO_SIGNED_IN_PAST_CODE_TYPE}.open` } }],
    });
  } catch (err) {
    logger.warn('sso-adoption-notice: the person could not be told', { account: ghii.ghii, connection: conn.id, error: String(err) });
  }
}
