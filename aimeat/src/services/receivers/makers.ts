/**
 * @file src/services/receivers/makers.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The receivers a maker made, for the moment the maker is removed (developer ruling 3 of
 *   2026-11-08, decision-secaudit2026nov08-three-rulings-for-fix-round-14-code-key-fi).
 *
 *   A receiver belongs to its owner, not to the agent or ecosystem app that made it, so it keeps working
 *   when that maker is deleted (builtin-skills.receivers.ts section 3). The maker was answered the key
 *   once, in plain text. So the owner is told, before and after: the delete view counts what the maker
 *   made and offers one press to pause it (public/views/profile/receivers/maker-receivers.js), the
 *   delete answer names it (`receivers_kept`), and the owner gets one notice that says the receivers
 *   go on and where to pause them. Nothing is paused for the owner: the node never stops the owner's
 *   receiver on its own.
 * @structure KeptReceivers · receiversMadeBy(storage, ownerGhii, maker) · noticeReceiversKept(storage, ownerGhii, label, kept)
 * @usage
 *   const kept = await receiversMadeBy(storage, ownerGhii, agent.gaii);     // before the delete
 *   await noticeReceiversKept(storage, ownerGhii, agent.name, kept);         // after it
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14, maker-lifecycle-not-surfaced).
 */
import type { Storage } from '../../storage/interface.js';
import { effectiveState } from './contract.js';
import { listReceivers } from './store.js';
import { notify } from '../notify.js';
import { logger } from '../../utils/logger.js';

/** The receivers one maker made, as the delete answer carries them. */
export interface KeptReceivers {
    count: number;
    receivers: Array<{ name: string; display_name: string; state: string }>;
}

/** The owner's receivers whose maker (createdBy) is `maker`, an agent's GAII or an ecosystem app's GEAI. */
export async function receiversMadeBy(storage: Storage, ownerGhii: string, maker: string): Promise<KeptReceivers> {
    const mine = (await listReceivers(storage, ownerGhii)).filter(r => r.createdBy === maker);
    return {
        count: mine.length,
        receivers: mine.map(r => ({ name: r.name, display_name: r.displayName, state: effectiveState(r) })),
    };
}

/** How many names the notice lists before it says "and N more". */
const NAMES_SHOWN = 5;

/**
 * Tell the owner that the receivers a removed maker made keep working. Nothing is sent when it made
 * none. `label` is the agent's or the app's name as the owner knows it. Never throws.
 */
export async function noticeReceiversKept(storage: Storage, ownerGhii: string, label: string, kept: KeptReceivers): Promise<void> {
    if (kept.count === 0) return;
    const shown = kept.receivers.slice(0, NAMES_SHOWN).map(r => r.display_name || r.name);
    const names = kept.count > NAMES_SHOWN ? `${shown.join(', ')} (+${kept.count - NAMES_SHOWN})` : shown.join(', ');
    await notify(storage, ownerGhii, {
        type: 'receivers_kept_after_maker',
        title: `${label} is removed, and the receivers it made keep working`,
        body: `${label} made ${kept.count} receiver(s): ${names}. They are yours, so they keep working: a program that holds a receiver's key still writes into your data. If you do not know that program, pause or delete the receiver on the Receivers page.`,
        link: '/v1/profile?tab=receivers',
        i18n: { key: 'receivers_kept_after_maker', vars: { maker: label, count: kept.count, names } },
    }).catch((err: unknown) => logger.warn('receivers: the owner could not be told about the receivers a removed maker made', { maker: label, error: String(err) }));
}
