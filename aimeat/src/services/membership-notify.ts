/**
 * @file membership-notify.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Tells someone they were let into an app, or that it was taken back. This is the one
 *   half of in-app membership that an app CANNOT build for itself, and the reason is structural, not
 *   an oversight: `ctx.notify` in the extension sandbox writes to the CALLER's owner, so at approval
 *   time the owner notifies themselves and at request time the applicant notifies themselves, wrong
 *   in both directions; and POST /v1/notifications is deliberately self-targeted, with no surface for
 *   pushing at arbitrary owners. So the node has to do it.
 *
 *   The delicate part is doing it without reopening what that route closed. This never takes a
 *   recipient from a caller. It hangs off an event the node has ALREADY authorised and both sides of
 *   which it verified: a provider issuing or withdrawing a zero-priced EXCHANGE grant. The recipient
 *   is that grant's consumer, so the only person who can be notified is someone the caller
 *   demonstrably just granted (or withdrew) something to. There is no way to name a third party.
 *
 *   Coalescing matters as much as the message. Approving one member commonly issues a grant per
 *   offering — twelve, in the app this was measured against — and twelve "you were approved" bells
 *   for one decision is spam that trains people to ignore the channel. A notification is sent when a
 *   relationship BEGINS and when it ENDS: the first active grant for a (provider, consumer, app)
 *   triple, and the removal of the last one.
 * @structure notifyGrantIssued() · notifyGrantsRevoked() · coalesceKey()
 * @usage await notifyGrantIssued(storage, config, { provider, consumer, appId, capability, existing });
 * @version-history
 *   v1.0.0 — 2026-07-30 — Initial (TARGET-055 phase 2): membership decisions reach the member.
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import type { MeteredEntitlement } from './metered-entitlements.js';
import { notify } from './notify.js';
import { logger } from '../utils/logger.js';

/** The owner behind any principal string (`alice`, `alice@node`, `bot#alice@node`). */
export function ownerOfPrincipal(principal: string): string {
  const s = String(principal || '');
  const afterHash = s.includes('#') ? s.slice(s.indexOf('#') + 1) : s;
  return afterHash.split('@')[0].toLowerCase();
}

/**
 * What counts as "the same membership" for coalescing. An approval inside an app is one decision
 * however many listings it has to carry, so the app id is the key; a provider carrying someone
 * directly, outside any app, is its own single relationship.
 * @param {string|null|undefined} appId
 * @returns {string}
 */
export function coalesceKey(appId: string | null | undefined): string {
  return appId && appId.trim() ? appId.trim() : '(direct)';
}

/** A deep link to the app when the grant names one, else the consumer's own entitlements page. */
function targetLink(appId: string | null): string {
  if (appId && appId.includes('/')) {
    const [owner, filename] = appId.split('/');
    return `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(filename)}?mode=inline`;
  }
  return '/v1/profile?tab=exchange';
}

/**
 * A provider let someone in. Sent only when this is the FIRST active grant of that membership, so a
 * twelve-offering approval rings once.
 *
 * `existing` is the provider's grants as they were BEFORE this one was written; the caller passes it
 * because it already holds the list, and reading it again here would race with the write.
 */
export async function notifyGrantIssued(
  storage: Storage, config: AimeatConfig,
  input: { providerOwner: string; consumerGaii: string; appId: string | null; capabilityLabel: string; existing: MeteredEntitlement[] },
): Promise<boolean> {
  const key = coalesceKey(input.appId);
  const consumerOwner = ownerOfPrincipal(input.consumerGaii);
  // Already carrying this person for this app: an extra listing on a decision already announced.
  const already = input.existing.some(g =>
    g.state === 'active'
    && ownerOfPrincipal(g.consumerGaii) === consumerOwner
    && coalesceKey(g.grant?.reason?.appId ?? g.appId ?? null) === key);
  if (already) return false;
  // Never notify a provider about themselves; the grant routes refuse self-grants, but an agent of
  // the provider resolving to the same owner would otherwise slip through.
  if (consumerOwner === String(input.providerOwner).toLowerCase()) return false;

  try {
    await notify(storage, `${consumerOwner}@${config.nodeId}`, {
      type: 'app_member_approved',
      title: input.appId ? `You were approved for ${input.appId.split('/').pop()}` : `${input.providerOwner} is carrying your calls`,
      body: `${input.providerOwner} approved you, so ${input.capabilityLabel} is free for you. They carry the cost.`,
      link: targetLink(input.appId),
    });
    return true;
  } catch (err) {
    // A membership decision must not fail because a bell could not be rung.
    logger.warn('membership-notify: approval notification failed, the grant itself stands', { error: String(err) });
    return false;
  }
}

/**
 * A provider took access back. One notification per person however many listings went with it, and
 * only when NOTHING of that membership is left: withdrawing one offering of twelve is a change to a
 * membership, not the end of one, and telling someone they were removed when they were not is worse
 * than staying quiet.
 *
 * `remaining` is the provider's grants AFTER the withdrawal.
 */
export async function notifyGrantsRevoked(
  storage: Storage, config: AimeatConfig,
  input: { providerOwner: string; revoked: MeteredEntitlement[]; remaining: MeteredEntitlement[] },
): Promise<number> {
  /** consumerOwner|key → how many of theirs went */
  const byMembership = new Map<string, { consumerOwner: string; appId: string | null; count: number }>();
  for (const g of input.revoked) {
    const appId = g.grant?.reason?.appId ?? g.appId ?? null;
    const consumerOwner = ownerOfPrincipal(g.consumerGaii);
    const id = consumerOwner + '|' + coalesceKey(appId);
    const prev = byMembership.get(id);
    if (prev) prev.count += 1;
    else byMembership.set(id, { consumerOwner, appId, count: 1 });
  }

  let sent = 0;
  for (const [id, m] of byMembership) {
    const key = id.slice(id.indexOf('|') + 1);
    const stillCarried = input.remaining.some(g =>
      g.state === 'active'
      && ownerOfPrincipal(g.consumerGaii) === m.consumerOwner
      && coalesceKey(g.grant?.reason?.appId ?? g.appId ?? null) === key);
    if (stillCarried) continue;
    if (m.consumerOwner === String(input.providerOwner).toLowerCase()) continue;
    try {
      await notify(storage, `${m.consumerOwner}@${config.nodeId}`, {
        type: 'app_member_revoked',
        title: m.appId ? `Your free access to ${m.appId.split('/').pop()} ended` : `${input.providerOwner} stopped carrying your calls`,
        body: `${input.providerOwner} withdrew the free access they were carrying${m.count > 1 ? ` (${m.count} capabilities)` : ''}. You can still call, at list price.`,
        link: targetLink(m.appId),
      });
      sent += 1;
    } catch (err) {
      logger.warn('membership-notify: withdrawal notification failed, the revoke itself stands', { error: String(err) });
    }
  }
  return sent;
}
