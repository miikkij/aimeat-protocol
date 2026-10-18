/**
 * @file src/services/openrouter-settings-migration.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One-time change that follows the own-key model ruling of 2026-10-02 (Jouni): an
 *   owner's own key uses the node's default model unless the owner chose a model, and a free model
 *   only when chosen.
 *
 *   WHAT IT CLEARS. Until 2026-10-02 PUT /v1/openrouter/settings with a key and no model created
 *   the settings record with `model: 'openrouter/free'` (the "vendor-neutral default"), and
 *   prepareAiCall read that before the node's default (AIMEAT_MODEL_DEFAULT_CHAT). Measured on a
 *   hosted place: the owner saved a capped test key, one task answered in broken Finnish, and neither
 *   key spent anything. Every record written that way holds exactly that value with no
 *   `modelChosen` mark, which is the positive evidence this acts on; a record whose model the owner
 *   chose through the same route since carries `modelChosen: true` and is left alone.
 *
 *   WHAT IT CANNOT TELL. An owner who typed 'openrouter/free' on purpose before 2026-10-02 looks the
 *   same as one who never chose, and loses that choice: on a node with a default chat model their own
 *   key now thinks with the default, and on a node without one nothing changes (the free router is
 *   still the last fallback). They choose the free router again in one save.
 *
 *   The read side applies the same test (ai-model-defaults.ts holdsImplicitFreeModel), so a record
 *   this has not reached resolves the same way; this rewrite is what makes GET /v1/openrouter/settings
 *   and the AI page stop showing a model the node does not serve.
 * @structure migrateImplicitFreeModelOnce()
 * @usage
 *   migrateImplicitFreeModelOnce(storage, config.nodeId).catch(err => logger.error(…));
 * @version-history
 *   v1.1.0 — 2026-10-18 — The mark is claimed before the work (services/once-only-step.ts), and each
 *     owner's record is written on the version that was read, so a save made meanwhile stands
 *     (check:atomic-writes).
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import type { Storage } from '../storage/interface.js';
import { holdsImplicitFreeModel } from './ai-model-defaults.js';
import { logger } from '../utils/logger.js';
import { claimOnceOnlyStep } from './once-only-step.js';
import { CAS_ATTEMPTS } from './record-cas.js';

export const IMPLICIT_FREE_MODEL_KEY = 'migrations.openrouter-implicit-free-model';
const SETTINGS_KEY = 'openrouter.settings';

/**
 * Clear the free router nobody chose from one owner's settings record, on the version that was read:
 * a save that lands after the read makes the write fail, and the record is read and tested again, so
 * the owner's save stands. True when it cleared something.
 */
async function clearImplicitFreeModel(storage: Storage, gaii: string): Promise<boolean> {
    for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
        const rec = await storage.getMemory(gaii, SETTINGS_KEY);
        if (!rec || !rec.value || typeof rec.value !== 'object') return false;
        const prefs = rec.value as Record<string, unknown>;
        if (!holdsImplicitFreeModel(prefs)) return false;
        const rest = { ...prefs };
        delete rest.model;
        const next = { ...rec, key: SETTINGS_KEY, value: rest, version: rec.version + 1, updatedAt: new Date().toISOString() };
        const written = storage.setMemoryIfVersion ? !!await storage.setMemoryIfVersion(next, rec.version) : (await storage.setMemory(next), true);
        if (written) return true;
    }
    throw new Error(`${gaii} ${SETTINGS_KEY} changed under every one of ${CAS_ATTEMPTS} attempts; the next boot tries again`);
}

/**
 * Once per node: every owner's settings record that holds the free router nobody chose loses its
 * `model`, so the node's default applies. Returns how many records it changed. Running it again
 * after a partial run is safe: a record it cleared no longer holds the value. The mark is claimed
 * before the work (services/once-only-step.ts), so of two node processes starting together one runs it.
 */
export async function migrateImplicitFreeModelOnce(
    storage: Storage, nodeId: string,
): Promise<{ ran: boolean; cleared: number }> {
    const claim = await claimOnceOnlyStep(storage, `system@${nodeId}`, IMPLICIT_FREE_MODEL_KEY);
    if (!claim) return { ran: false, cleared: 0 };
    let cleared = 0;
    try {
        for (const owner of await storage.listOwners()) {
            if (await clearImplicitFreeModel(storage, `${owner.name}@${nodeId}`)) cleared++;
        }
        await claim.finish({ at: new Date().toISOString(), cleared });
    } catch (err) {
        await claim.release();
        throw err;
    }
    if (cleared > 0) logger.info(`AI settings: the free router nobody chose was cleared from ${cleared} owner record(s); the node's default model applies`);
    return { ran: true, cleared };
}
