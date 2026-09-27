/**
 * @file src/services/design-book/component-notice.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Telling a proposer that their stored component no longer passes the bench.
 *
 *   A component is benched when it is proposed and stored as it passed. The bench learns with a
 *   deploy, and a stored component that stops passing is left out of the search and the map, and
 *   nobody can take it (component.ts componentBench). Its proposer is not asked to look: the node
 *   tells them ONCE, the first time it finds the part failing, in their notifications, with the
 *   bench's reason and the address of the page that shows it. It looks at boot, which follows the
 *   deploy that changed the bench, and in the nightly Design Book round.
 *
 *   ONCE PER STORED BODY. A notice record (`atelier.book.notice.<id>`, under the Book's own system
 *   identity, private) keeps the digest of the body that was reported, so the next round and the
 *   next boot say nothing more about it, and a new body that fails after a later deploy is a new
 *   thing to say. It goes when the part is deleted (service.ts delete). A retired part, and a part
 *   the node itself holds, is nobody's to be told about.
 * @structure COMPONENT_FAILING_NOTICE · noticeFailingComponents(storage, config)
 * @usage await noticeFailingComponents(storage, config);   // lifecycle.ts: the nightly round; service-init.ts: boot
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { logger } from '../../utils/logger.js';
import { systemGhiiFor } from '../compliance-register.js';
import { notify } from '../notify.js';
import { componentBench, componentDigest } from './component.js';
import { noticeKey, PART_KEY_PREFIX, PART_KEY_RE, type DesignBookPart } from './service.js';

/** The notification's type: `app_` puts it with the owner's app notifications (notification-settings.ts groupOfType). */
export const COMPONENT_FAILING_NOTICE = 'app_designbook_component_failing';

/** A stored value as an object: the part record is JSON text, the notice record an object. */
function valueOf<T>(value: unknown): T | null {
  if (typeof value !== 'string') return (value ?? null) as T | null;
  // eslint-disable-next-line aimeat/no-silent-catch -- an unreadable record reads as none: a part has no body to bench, a notice was not given
  try { return JSON.parse(value) as T; } catch { return null; }
}

/**
 * Every stored component that no longer passes the bench, and its proposer told once about each
 * stored body. Answers how many fail (retired parts aside) and how many proposers were told now.
 */
export async function noticeFailingComponents(storage: Storage, config: AimeatConfig): Promise<{ failing: number; noticed: number }> {
  const system = systemGhiiFor(config.nodeId);
  const out = { failing: 0, noticed: 0 };
  // The Book lives under the node's own system identity, which no token can act as (service.ts).
  const records = await storage.listMemory(systemGhiiFor(config.nodeId), { prefix: PART_KEY_PREFIX, tags: ['designbook'] });
  for (const record of records) {
    if (!PART_KEY_RE.test(record.key)) continue;
    const part = valueOf<DesignBookPart>(record.value);
    if (part?.kind !== 'component' || part.status === 'retired') continue;
    const bench = componentBench(part.body);
    if (bench.passes) continue;
    out.failing++;
    const owner = part.proposed_by_owner;
    if (!owner || owner === system) continue;

    const digest = componentDigest(part.body);
    const key = noticeKey(part.id);
    const prior = await storage.getMemory(systemGhiiFor(config.nodeId), key);
    if (valueOf<{ digest?: string }>(prior?.value)?.digest === digest) continue;

    const sent = await notify(storage, owner, {
      type: COMPONENT_FAILING_NOTICE,
      title: `Your Design Book component "${part.id}" no longer passes the bench`,
      body: `The bench says: ${bench.why}\n\nUntil it passes, nobody can take it, and the search and the map leave it out. `
        + 'Fix it as the bench says and propose it again under the same id (aimeat_designbook_propose). '
        + 'aimeat_designbook_get shows you its markup and stylesheet as stored.',
      link: `/v1/designbook/${encodeURIComponent(part.id)}/preview`,
    });
    // A notice neither stored nor muted by the owner is tried again on the next round.
    if (!sent.stored && !sent.muted) continue;
    const now = new Date().toISOString();
    await storage.setMemory({
      key,
      ownerGaii: system,
      value: { spec: 'aimeat.designbook.notice/v1', id: part.id, owner, digest, why: bench.why, noticed_at: now },
      visibility: 'private',
      tags: ['designbook', 'notice'],
      ttlHours: null,
      version: prior ? prior.version + 1 : 1,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
    });
    out.noticed++;
  }
  if (out.failing > 0) logger.info(`design-book: ${out.failing} stored component(s) no longer pass the bench; ${out.noticed} proposer(s) told now`);
  return out;
}
