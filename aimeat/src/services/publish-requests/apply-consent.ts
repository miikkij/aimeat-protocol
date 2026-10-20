/**
 * @file src/services/publish-requests/apply-consent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The approved publish request for a consent to everyone: the consent is granted now,
 *   as the owner, through services/consent-write.ts grantConsent, the same function POST /v1/consent
 *   and aimeat_consent_grant run (secaudit 2026-10, grantConsent:wildcard-recipient-skips-publish-gate).
 *
 *   NOTHING WAS STORED WHILE IT WAITED. A consent has no level below `*` to keep it at, so the door
 *   that was asked granted nothing at all: this applier creates the record. The namespace the request
 *   names is checked against the approving account first, so an approval cannot open another
 *   account's data.
 * @structure applyConsentPublish(ctx, ownerGhii, request)
 * @usage PUBLISH_APPLIERS.consent (appliers.ts)
 * @version-history
 *   2026-10-20 — Initial (secaudit 2026-10, grantConsent:wildcard-recipient-skips-publish-gate).
 */
import type { PublishApplyResult, PublishRequest, PublishStoreCtx } from './store.js';
import { grantConsent } from '../consent-write.js';
import { namespaceOfOwner } from './apply-memory.js';

export async function applyConsentPublish(ctx: PublishStoreCtx, ownerGhii: string, request: PublishRequest): Promise<PublishApplyResult> {
  const namespace = String(request.target.namespace ?? '');
  const dataPattern = String(request.target.pattern ?? '');
  if (!namespace || !dataPattern || !namespaceOfOwner(namespace, ownerGhii)) {
    return { ok: false, reason: 'the data is not on this account' };
  }
  const expires = request.target.expires === undefined ? null : String(request.target.expires);
  // The owner in person: they approved it, so the wildcard gate is not asked again.
  const granted = await grantConsent(ctx, {
    ownerGaii: namespace, scopes: [], roles: ['owner'], collectionMethod: 'approved by the person in the publish request',
  }, {
    recipient: '*',
    dataPattern,
    purpose: String(request.target.purpose ?? 'Approved by the owner'),
    scope: String(request.target.reach ?? 'local'),
    expires,
  });
  return granted.ok ? { ok: true } : { ok: false, reason: granted.message };
}
