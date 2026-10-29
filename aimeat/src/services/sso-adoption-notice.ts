/**
 * @file src/services/sso-adoption-notice.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The person is told when their organisation's SAML sign-in opened their account without
 *   their two-step code (secaudit2026oct26, scim-users.ts createUser adoption-skips-second-factor).
 *
 *   An account the organisation's directory adopted through SCIM is opened by the organisation's
 *   sign-in through the adoption key: the directory vouches for the account, and lifecycle authority
 *   moved to the connection at adoption.
 *
 *   THE FIRST SIGN-IN ASKS THE CODE (developer's decision, 2026-10-29). When the adopted account has
 *   two-step sign-in, the first organisation sign-in into it asks the person's code once, as the
 *   password, the sign-in link and an address match do (adoptionAsksCode; the SAML ACS then starts the
 *   code step, which saves the link after a correct code). After that the linked identity signs in
 *   without the code. "Adopted" needs positive evidence: the marker `scimadopted:<connection>` that
 *   SCIM adoption writes since this change, or an account created before the connection, which that
 *   connection's SCIM cannot have created. An adoption that already completed an organisation sign-in
 *   on the connection (its `saml:<connection>` key is set) is not asked.
 *
 *   THE NOTICE. An account with two-step sign-in that is opened through the adoption key without the
 *   code (no evidence of adoption: an account the directory made, which the person armed later) gets
 *   a bell notice that says so, once, at the sign-in that linked the organisation's identity.
 * @structure SSO_SIGNED_IN_PAST_CODE_TYPE · tellSignedInPastCode · adoptedMarkerKey · adoptionAsksCode
 * @usage if (result.adoptedNow && twoStepArmed(result.ghii)) void tellSignedInPastCode(storage, result.ghii, conn);
 *   mapExternalIdentity(storage, { …, adoptionAsksCode: (a) => adoptionAsksCode(storage, conn, a, providerId) });
 * @version-history
 *   2026-10-29 — adoptedMarkerKey and adoptionAsksCode: the first organisation sign-in into an adopted
 *     account with two-step sign-in asks the code once (secaudit2026oct26 round 8c, adoption-skips-second-factor).
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import type { Storage, GHIIRecord, SsoConnectionRecord } from '../storage/interface.js';
import { notify } from './notify.js';
import { twoStepArmed } from './passkeys.js';
import { logger } from '../utils/logger.js';

export const SSO_SIGNED_IN_PAST_CODE_TYPE = 'sso_signed_in_past_code';

/**
 * The externalIdentities key SCIM adoption writes on the adopted account, valued with the adoption
 * time. It is evidence only: no sign-in looks an account up by it.
 */
export const adoptedMarkerKey = (connectionId: string): string => `scimadopted:${connectionId}`;

/**
 * Whether this organisation sign-in, matched to `account` through the adoption key, asks the account's
 * two-step code first. True only for an account with two-step sign-in, with no `providerId` identity
 * linked yet on it (the adoption has not completed an organisation sign-in), and with positive
 * evidence that the connection adopted it rather than made it: the adoption marker, or an account
 * created before the connection.
 */
export async function adoptionAsksCode(
  storage: Storage, conn: Pick<SsoConnectionRecord, 'id' | 'createdAt'>, account: GHIIRecord, providerId: string,
): Promise<boolean> {
  if (!twoStepArmed(account)) return false;
  const ids = account.externalIdentities ?? {};
  if (ids[providerId]) return false;
  if (ids[adoptedMarkerKey(conn.id)]) return true;
  const owner = await storage.getOwner(account.ownerName);
  const madeAt = Date.parse(owner?.createdAt ?? '');
  const connAt = Date.parse(conn.createdAt ?? '');
  return Number.isFinite(madeAt) && Number.isFinite(connAt) && madeAt < connAt;
}

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
