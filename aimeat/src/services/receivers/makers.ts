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
 *
 *   A KEY HOLDER IS TOLD OF THE SAME WAY. An agent or app that rotated a receiver another principal
 *   made was answered its current key in plain text just as a maker is (./manage.ts rotateKey), so a
 *   receiver whose working key it was answered (ReceiverRecord.keyAnsweredTo, and the replaced key's
 *   holder while its overlap lasts) is listed too, with `why: 'key'`, and the owner gets a notice of
 *   its own for those (secaudit2026nov08b round 15, rotated-key-holder-not-surfaced).
 * @structure KeptReceivers · receiversMadeBy(storage, ownerGhii, maker) · noticeReceiversKept(storage, ownerGhii, label, kept)
 * @usage
 *   const kept = await receiversMadeBy(storage, ownerGhii, agent.gaii);     // before the delete
 *   await noticeReceiversKept(storage, ownerGhii, agent.name, kept);         // after it
 * @version-history
 *   v1.1.1 — 2026-11-08 — The notices' English words say incoming webhook and API key; the notice
 *     types and i18n keys stay (secaudit2026nov08b round 15b).
 *   v1.1.0 — 2026-11-08 — Receivers whose working key the removed principal was answered are listed
 *     (`why: 'key'`) with a notice of their own (secaudit2026nov08b round 15).
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14, maker-lifecycle-not-surfaced).
 */
import type { Storage } from '../../storage/interface.js';
import { effectiveState, keyHoldersOf } from './contract.js';
import { listReceivers } from './store.js';
import { notify } from '../notify.js';
import { logger } from '../../utils/logger.js';

/** The receivers one maker made or holds the key of, as the delete answer carries them. */
export interface KeptReceivers {
    count: number;
    /** `why`: 'made' when the principal made it, 'key' when it was only answered its working key. */
    receivers: Array<{ name: string; display_name: string; state: string; why: 'made' | 'key' }>;
}

/**
 * The owner's receivers whose maker (createdBy) is `maker`, an agent's GAII or an ecosystem app's GEAI,
 * and those whose working key `maker` was answered.
 */
export async function receiversMadeBy(storage: Storage, ownerGhii: string, maker: string): Promise<KeptReceivers> {
    const now = Date.now();
    const mine = (await listReceivers(storage, ownerGhii)).filter(r => r.createdBy === maker || keyHoldersOf(r, now).includes(maker));
    return {
        count: mine.length,
        receivers: mine.map(r => ({
            name: r.name, display_name: r.displayName, state: effectiveState(r),
            why: r.createdBy === maker ? 'made' as const : 'key' as const,
        })),
    };
}

/** How many names the notice lists before it says "and N more". */
const NAMES_SHOWN = 5;

function namesOf(list: KeptReceivers['receivers']): string {
    const shown = list.slice(0, NAMES_SHOWN).map(r => r.display_name || r.name);
    return list.length > NAMES_SHOWN ? `${shown.join(', ')} (+${list.length - NAMES_SHOWN})` : shown.join(', ');
}

/**
 * Tell the owner that the receivers a removed maker made, or holds the key of, keep working. Nothing
 * is sent when there are none. `label` is the agent's or the app's name as the owner knows it. Never
 * throws.
 */
export async function noticeReceiversKept(storage: Storage, ownerGhii: string, label: string, kept: KeptReceivers): Promise<void> {
    const made = kept.receivers.filter(r => r.why === 'made');
    const held = kept.receivers.filter(r => r.why === 'key');
    const failed = (err: unknown) => logger.warn('receivers: the owner could not be told about the receivers a removed maker made', { maker: label, error: String(err) });
    if (made.length) {
        const names = namesOf(made);
        await notify(storage, ownerGhii, {
            type: 'receivers_kept_after_maker',
            title: `${label} is removed, and the incoming webhooks it made keep working`,
            body: `${label} made ${made.length} incoming webhook(s): ${names}. They are yours, so they keep working: a program that holds a webhook's API key still writes into your data. If you do not know that program, pause or delete the webhook on the Incoming webhooks page.`,
            link: '/v1/profile?tab=receivers',
            i18n: { key: 'receivers_kept_after_maker', vars: { maker: label, count: made.length, names } },
        }).catch(failed);
    }
    if (held.length) {
        const names = namesOf(held);
        await notify(storage, ownerGhii, {
            type: 'receivers_key_kept_after_holder',
            title: `${label} is removed, and the incoming webhooks whose API key it changed keep working`,
            body: `${label} changed the API key of ${held.length} incoming webhook(s) and got the new API key: ${names}. They are yours, so they keep working: a program that holds a webhook's API key still writes into your data. If you do not know that program, change the API key or pause the webhook on the Incoming webhooks page.`,
            link: '/v1/profile?tab=receivers',
            i18n: { key: 'receivers_key_kept_after_holder', vars: { maker: label, count: held.length, names } },
        }).catch(failed);
    }
}
