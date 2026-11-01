/**
 * @file src/services/datapackage/freshness-sweep.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The stale check (plan doc-mvwxcas3dom3, D6.2): the core job `core:datapackage-freshness`
 *   (services/core-jobs.ts, hourly) reads every catalogued data package that has a promise or a producer
 *   that runs on a schedule by nature, computes its freshness (./freshness-read.ts), and tells each owner
 *   once about the packages that turned stale.
 *
 *   ONE NOTICE PER STALE SPELL, NOT ONE PER CHECK. The owner's service-owned record
 *   `datapkg-freshness-notices` holds, per package, the last success it was told about. A package is
 *   told again only when it went stale after a newer success, so an hourly check of a package stale for
 *   a month sends one notice. A package no longer stale leaves the record. All of an owner's newly stale
 *   packages go in one notification.
 *
 *   A package nobody promised anything about, made by a person, an agent or an app, is not read: it is
 *   unscheduled for ever and there is nothing to tell. Withdrawn packages have no catalogue entry.
 *
 *   AFTER EACH CHECK the hooks registered with onFreshnessSwept get every package read and its
 *   freshness; the EXCHANGE projection updates a listing whose state changed.
 * @structure FRESHNESS_NOTICES_KEY · onFreshnessSwept · SweptPackage · sweepStalePackages · parseNotices
 * @usage const out = await sweepStalePackages(storage, config);
 * @version-history
 *   v1.1.0 — 2026-11-01 — onFreshnessSwept: hooks get the packages each check read (plan D6).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D6.2).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { allDatasetFacts, type DatasetFacts } from './catalogue-facts.js';
import { packageFreshness } from './freshness-read.js';
import { SCHEDULED_BY_NATURE, type Freshness } from './freshness.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { notify } from '../notify.js';
import { emitChange } from '../event-bus.js';
import { logger } from '../../utils/logger.js';

/** The owner's record of which stale packages were told about. Service-owned (utils/reserved-keys.ts). */
export const FRESHNESS_NOTICES_KEY = 'datapkg-freshness-notices';

interface Notices { packages: Record<string, { lastSuccessAt: string | null; notifiedAt: string }> }

export function parseNotices(v: unknown): Notices {
    const p = (v && typeof v === 'object' ? (v as Notices).packages : null);
    return { packages: p && typeof p === 'object' ? { ...p } : {} };
}

/** One package the check read, with the freshness it computed. */
export interface SweptPackage { ownerGhii: string; name: string; freshness: Freshness }

type SweptHook = (storage: Storage, swept: SweptPackage[]) => Promise<void>;
const sweptHooks: SweptHook[] = [];

/**
 * Run `hook` after every check with the packages it read. The EXCHANGE projection registers here
 * (services/exchange-projection.ts), so a listing follows its package's freshness without this file
 * importing the projection. A hook's failure is logged and the check goes on.
 */
export function onFreshnessSwept(hook: SweptHook): void {
    sweptHooks.push(hook);
}

/** Is there anything to promise or break for this package? */
function watched(f: DatasetFacts): boolean {
    return !!f.schedule || f.producerKind === 'dataproduct' || SCHEDULED_BY_NATURE.includes(f.producerKind ?? '');
}

/** Check every watched package and tell each owner once about the ones that turned stale. */
export async function sweepStalePackages(storage: Storage, config: AimeatConfig, now = new Date()): Promise<{ checked: number; stale: number; notified: number }> {
    const deps = { storage, config };
    const out = { checked: 0, stale: 0, notified: 0 };
    const byOwner = new Map<string, Array<{ name: string; title: string; lastSuccessAt: string | null; stale: boolean }>>();
    const swept: SweptPackage[] = [];
    for (const f of (await allDatasetFacts(storage)).filter(watched)) {
        let fr;
        try {
            fr = await packageFreshness(deps, f.ownerGhii, f.name, { ...(f.producerKind ? { schedule: f.schedule ?? '', producerKind: f.producerKind } : {}), now });
        } catch (err) {
            logger.warn('datapackage freshness sweep: a package could not be read', { owner: f.ownerGhii, package: f.name, error: String(err) });
            continue;
        }
        if (!fr) continue;
        out.checked++;
        const stale = fr.state === 'stale';
        if (stale) out.stale++;
        const list = byOwner.get(f.ownerGhii) ?? [];
        list.push({ name: f.name, title: f.title, lastSuccessAt: fr.last_success_at, stale });
        byOwner.set(f.ownerGhii, list);
        swept.push({ ownerGhii: f.ownerGhii, name: f.name, freshness: fr });
    }

    for (const hook of sweptHooks) {
        try { await hook(storage, swept); }
        catch (err) { logger.warn('datapackage freshness sweep: a hook on the checked packages failed', { error: String(err) }); }
    }

    for (const [ownerGhii, list] of byOwner) {
        let fresh: typeof list = [];
        try {
            await updateRecord(storage, ownerGhii, FRESHNESS_NOTICES_KEY, parseNotices, cur => {
                fresh = [];
                let changed = false;
                const packages = { ...cur.packages };
                for (const p of list) {
                    if (!p.stale) { if (packages[p.name]) { delete packages[p.name]; changed = true; } continue; }
                    const told = packages[p.name];
                    if (told && told.lastSuccessAt === p.lastSuccessAt) continue;
                    packages[p.name] = { lastSuccessAt: p.lastSuccessAt, notifiedAt: now.toISOString() };
                    fresh.push(p);
                    changed = true;
                }
                // Nothing to tell and nothing to forget: no write, so a quiet owner gets no record.
                return changed ? { packages } : UNCHANGED;
            }, { tag: FRESHNESS_NOTICES_KEY });
        } catch (err) {
            logger.warn('datapackage freshness sweep: the notice record could not be written; no notice this round', { owner: ownerGhii, error: String(err) });
            continue;
        }
        if (!fresh.length) continue;
        const names = fresh.map(p => p.title || p.name).join(', ');
        const one = fresh.length === 1;
        await notify(storage, ownerGhii, {
            type: 'datapackage_stale',
            title: one ? `Your data package "${names}" is out of date` : `${fresh.length} of your data packages are out of date`,
            body: one
                ? 'It has missed three updates its schedule promised. Readers keep getting the last version. Check what produces it, or change or remove the schedule.'
                : `They have missed three updates their schedule promised: ${names}. Readers keep getting the last version. Check what produces them, or change or remove the schedule.`,
            link: '/v1/profile#offers',
            i18n: one ? { key: 'datapackage_stale_one', vars: { name: names } } : { key: 'datapackage_stale_many', vars: { count: fresh.length, names } },
            actions: [{ id: 'open', label: 'See your data packages', kind: 'navigate', link: '/v1/profile#offers', i18n: { key: 'datapackage_stale.open' } }],
        });
        emitChange('notifications', ownerGhii);
        out.notified++;
    }
    if (out.stale) logger.info('datapackage freshness sweep', out);
    return out;
}
