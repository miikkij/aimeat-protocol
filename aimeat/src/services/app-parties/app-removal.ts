/**
 * @file src/services/app-parties/app-removal.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an app's own users leave behind when the app itself is deleted
 *   (services/app/lifecycle.ts deleteOwnedApp): every party row with the collections it kept, the
 *   collections the app shared, the parties' roster rows and the app's signup record. Nobody is asked:
 *   the app's owner removed the app. Its own file, apart from ./owner.ts, because the owner's routes
 *   reach the roster context, whose audit reaches the app lifecycle, and lifecycle calls this.
 * @structure removeAppPartiesOfApp
 * @usage await removeAppPartiesOfApp(storage, nodeId, ownerName, ownerGhii, filename);
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial: a deleted app's people went nowhere until now.
 */
import type { Storage } from '../../storage/interface.js';
import { removeMember } from '../app/members.js';
import { partyRefOf } from '../parties/contract.js';
import { emitChange } from '../event-bus.js';
import { appPartiesKey } from './contract.js';
import { appIdOf } from './store.js';

/** Remove everything the app's own users left in it. Answers how many people and collections went. */
export async function removeAppPartiesOfApp(
    storage: Storage, nodeId: string, ownerName: string, ownerGhii: string, filename: string,
): Promise<{ parties: number; data: number }> {
    const appId = appIdOf(ownerName, filename);
    const { parties, data } = await storage.deleteAppPartiesByApp(appId);
    for (const p of parties) await removeMember(storage, appId, partyRefOf(ownerName, p.name, nodeId));
    await storage.deleteMemory(ownerGhii, appPartiesKey(appId), ownerGhii);
    if (parties.length || data) emitChange('app-parties', ownerGhii);
    return { parties: parties.length, data };
}
