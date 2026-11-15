/**
 * @file src/services/app-parties/move-to-tables.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The once-per-node boot step that moves an app's own users out of memory records into
 *   their tables (storage/types/app-parties.ts), 2026-11-15.
 *
 *   WHAT MOVES. Every `app-parties.<app key>` record that still holds a `parties` list: each party
 *   becomes an AppParty row under its own uid, and the record is rewritten on the version read with
 *   the registration only. Every `app-party-data.<app key>.<uid>.<key>` memory key whose app the
 *   records name and whose uid is a moved party (or `_shared`) becomes an AppPartyData row, and the key
 *   is deleted once its row is read back.
 *
 *   ON EVIDENCE ONLY (CLAUDE.md, Backend). A party whose address or name already has another uid in
 *   the app's rows, a record that changed between the read and the rewrite, and a data key whose app
 *   or party cannot be named stay exactly where they are, and one incident on the Security page names
 *   them. Nothing throws on data, and a second run (a step that was released) moves only what is left:
 *   importAppParty answers `present` for a row already there.
 * @structure APP_PARTIES_MOVED_KEY · APP_PARTY_MOVE_INCIDENT_TYPE · moveAppPartiesToTablesOnce
 * @usage await moveAppPartiesToTablesOnce(storage, config);   // server-bootstrap/once-only-keep-steps.ts
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial.
 */
import type { Storage, MemoryRecord } from '../../storage/interface.js';
import { APP_PARTY_SHARED } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { claimOnceOnlyStep } from '../once-only-step.js';
import { recordSecurityIncident } from '../security-incident.js';
import { emitChange } from '../event-bus.js';
import { appKeySegment } from '../app/record-keys.js';
import {
    APP_PARTIES_PREFIX, PARTY_DATA_PREFIX, parseAppPartiesValue, parseLegacyParties, toPartyRow,
} from './contract.js';

/** The record under `system@<nodeId>` that says this node has run the step. */
export const APP_PARTIES_MOVED_KEY = 'migrations.app-parties-to-tables';

/** The Security page incident for what the step left in place. */
export const APP_PARTY_MOVE_INCIDENT_TYPE = 'app_party_move_left';

/** Records read per page of the scan. */
const PAGE = 500;

async function allUnder(storage: Storage, prefix: string): Promise<MemoryRecord[]> {
    const out: MemoryRecord[] = [];
    for (let offset = 0; ; offset += PAGE) {
        const { items } = await storage.listAllMemory({ prefix, limit: PAGE, offset, archived: 'include', excludeVersionRows: true });
        out.push(...items);
        if (items.length < PAGE) return out;
    }
}

/** Move the parties and their data to the tables, once per node. */
export async function moveAppPartiesToTablesOnce(
    storage: Storage, config: Pick<AimeatConfig, 'nodeId'>,
): Promise<{ ran: boolean; parties: number; data: number; left: number }> {
    const claim = await claimOnceOnlyStep(storage, `system@${config.nodeId}`, APP_PARTIES_MOVED_KEY);
    if (!claim) return { ran: false, parties: 0, data: 0, left: 0 };
    try {
        const left: string[] = [];
        let movedParties = 0;
        let movedData = 0;
        // app key segment → app id, and the uids each app's rows now hold, for the data keys below.
        const appOfSegment = new Map<string, string>();
        const uidsOf = new Map<string, Set<string>>();
        const owners = new Set<string>();

        for (const rec of await allUnder(storage, APP_PARTIES_PREFIX)) {
            const parties = parseLegacyParties(rec.value);
            const v = parseAppPartiesValue(rec.value);
            const appId = v.appId ?? parties[0]?.app;
            if (appId) appOfSegment.set(appKeySegment(appId), appId);
            if (!parties.length) continue;
            const held = new Set<string>();
            for (const p of parties) {
                const res = await storage.importAppParty(toPartyRow(p, rec.ownerGaii));
                if (res === 'conflict') { left.push(`${rec.ownerGaii} ${p.app} ${p.name}: its address or name has another person in the app's rows`); continue; }
                if (res === 'inserted') movedParties++;
                held.add(p.uid);
            }
            if (appId) uidsOf.set(appId, new Set([...(uidsOf.get(appId) ?? []), ...held]));
            owners.add(rec.ownerGaii);
            // The record keeps the registration and the parties that did not move; written on its version.
            const stay = parties.filter(p => !held.has(p.uid));
            const value = { ...(appId ? { appId } : {}), registration: v.registration, ...(stay.length ? { parties: stay } : {}) };
            const written = await storage.setMemoryIfVersion({ ...rec, value, version: rec.version + 1, updatedAt: new Date().toISOString() }, rec.version);
            if (!written) left.push(`${rec.ownerGaii} ${rec.key}: the record changed while it was moved; its parties are in the table and the record still lists them`);
        }

        for (const rec of await allUnder(storage, PARTY_DATA_PREFIX)) {
            // app-party-data.<app key segment>.<party uid>.<collection>
            const rest = rec.key.slice(PARTY_DATA_PREFIX.length).split('.');
            const [segment, partyUid, key] = rest.length === 3 ? rest as [string, string, string] : ['', '', ''];
            const appId = appOfSegment.get(segment);
            const known = !!appId && (partyUid === APP_PARTY_SHARED || !!uidsOf.get(appId)?.has(partyUid));
            if (!appId || !known || !key) { left.push(`${rec.ownerGaii} ${rec.key}: no app or registered person of this node is named by it`); continue; }
            const bytes = Buffer.byteLength(JSON.stringify(rec.value ?? null), 'utf8');
            const out = await storage.putAppPartyData({ appId, partyUid, key, ownerGhii: rec.ownerGaii, value: rec.value, bytes, updatedAt: rec.updatedAt }, Number.MAX_SAFE_INTEGER);
            // Deleted only when its row reads back.
            if (out.stored && await storage.getAppPartyData(appId, partyUid, key)) {
                await storage.deleteMemory(rec.ownerGaii, rec.key, rec.ownerGaii);
                movedData++;
            } else {
                left.push(`${rec.ownerGaii} ${rec.key}: its row did not read back; the key stays`);
            }
        }

        if (left.length) {
            await recordSecurityIncident(storage, config, {
                type: APP_PARTY_MOVE_INCIDENT_TYPE,
                code: 'APP_PARTY_MOVE_LEFT',
                actorGhii: `system@${config.nodeId}`,
                actorName: 'node',
                source: 'boot',
                detail: `${left.length} item(s) of the people registered to apps stayed in memory when they moved to their own tables on this start, and nothing about them was changed: `
                    + left.slice(0, 50).join('; ') + (left.length > 50 ? `; and ${left.length - 50} more` : '') + '. '
                    + 'The app does not see what stayed. Check each one: remove the leftover memory record, or ask the app\'s owner to register the person again.',
                params: { count: String(left.length) },
            });
        }
        for (const owner of owners) emitChange('app-parties', owner);
        await claim.finish({ at: new Date().toISOString(), parties: movedParties, data: movedData, left: left.length });
        if (movedParties || movedData || left.length) {
            logger.info(`App parties: ${movedParties} people and ${movedData} collections moved to their tables, ${left.length} left in memory`);
        }
        return { ran: true, parties: movedParties, data: movedData, left: left.length };
    } catch (err) {
        await claim.release();
        throw err;
    }
}
