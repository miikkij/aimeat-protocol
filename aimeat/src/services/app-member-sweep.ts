/**
 * @file app-member-sweep.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Take the free access back when a membership term runs out.
 *
 *   Access itself stops on the clock: `getMember` returns nothing for a lapsed row, so a member who
 *   was not renewed is refused on their very next call whatever this sweep is doing. What the clock
 *   cannot do is withdraw the EXCHANGE grants, and those are the half that costs the provider money —
 *   a lapsed member with live grants keeps calling free, billed to the person who stopped selling to
 *   them. So the term ending and the grants ending are two acts, and this is the second one.
 *
 *   It is deliberately dumb: one prefix scan, no bookkeeping of its own, idempotent. A sweep that
 *   kept its own list of what it had already done would be a third copy of the truth, which is the
 *   thing this whole area exists to remove.
 * @structure sweepLapsedMemberships(storage, config) → { swept, revoked, failed }
 * @usage started from server-bootstrap/service-init.ts on a low-frequency timer
 * @version-history
 *   v1.0.0 — 2026-07-30 — Initial (TARGET-055): the expiry axis.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { listLapsed, removeMember, type AppMemberRecord } from './app-members.js';
import { syncGrantsForMember } from './grant-sync.js';
import { notify } from './notify.js';
import { logger } from '../utils/logger.js';

export interface SweepResult {
  swept: number;
  revoked: number;
  failed: number;
}

/** The app's owner, which is the first segment of `owner/file.html`. */
function ownerOf(appId: string): string {
  return String(appId).split('/')[0] ?? '';
}

/**
 * Withdraw everything a lapsed membership was carrying, then remove the row.
 *
 * The row goes rather than being marked: `since` belongs to a term that ended, and re-approving
 * somebody starts a fresh one. Leaving a dead row on the roster would also make the seat count wrong,
 * which is the kind of quiet arithmetic error that only shows up when a full app refuses somebody.
 */
export async function sweepLapsedMemberships(
  storage: Storage, config: AimeatConfig, appId?: string,
): Promise<SweepResult> {
  let lapsed: AppMemberRecord[];
  try {
    const all = await listLapsed(storage);
    lapsed = appId ? all.filter(r => r.appId === appId) : all;
  } catch (err) {
    logger.warn('app-member sweep: could not read the roster, leaving everything as it is', { error: String(err) });
    return { swept: 0, revoked: 0, failed: 0 };
  }
  const out: SweepResult = { swept: 0, revoked: 0, failed: 0 };

  for (const rec of lapsed) {
    const owner = ownerOf(rec.appId);
    if (!owner) continue;
    try {
      if (rec.offerings.length) {
        const sync = await syncGrantsForMember(storage, {
          providerOwner: owner.toLowerCase(),
          providerGhii: `${owner}@${config.nodeId}`,
          consumer: `${rec.owner}@${config.nodeId}`,
          appId: rec.appId,
          role: rec.role,
          // Nothing carried: the declarative form of "take it all back".
          offeringIds: [],
          note: 'membership term ended',
        });
        out.revoked += sync.revoked.length;
        out.failed += sync.failed.length;
        // A grant that would not come back means this account may still be calling free, which is
        // worth saying out loud rather than counting as done.
        if (sync.failed.length) {
          logger.warn('app-member sweep: a lapsed membership kept some free access', {
            appId: rec.appId, member: rec.owner, failed: sync.failed.length,
          });
        }
      }
      await removeMember(storage, rec.appId, rec.owner);
      out.swept += 1;

      try {
        await notify(storage, `${rec.owner}@${config.nodeId}`, {
          type: 'app_member_expired',
          title: `Your access to ${rec.appId.split('/')[1]?.replace(/\.html?$/i, '') ?? rec.appId} has ended`,
          body: rec.renewal === 'self-serve'
            ? 'The term ran out. You can take another one whenever you like.'
            : 'The term ran out. Ask the owner if you need it back.',
          link: `/v1/apps/${encodeURIComponent(owner)}/${encodeURIComponent(rec.appId.split('/')[1] ?? '')}?mode=inline`,
        });
      } catch (err) {
        // The membership ended whether or not a bell rang.
        logger.warn('app-member sweep: expiry notification failed', { error: String(err) });
      }
    } catch (err) {
      out.failed += 1;
      logger.warn('app-member sweep: could not finish one lapsed membership', {
        appId: rec.appId, member: rec.owner, error: String(err),
      });
    }
  }

  if (out.swept) {
    logger.info('app-member sweep: lapsed memberships closed', out as unknown as Record<string, unknown>);
  }
  return out;
}
