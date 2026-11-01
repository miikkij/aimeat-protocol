/**
 * @file src/services/app-parties/store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one record of an app's parties (./contract.ts), read and written on its version
 *   (services/record-cas.ts), and the node's setting as it stands for that app (D4.3): off, apps-ask or
 *   on, forced off on a node that shows its content to signed-in accounts only.
 * @structure readAppParties · changeAppParties · registrationMode · signupOpen · appIdOf
 * @usage const { registration, parties } = await readAppParties(storage, ownerGhii, appId);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D4.2, D4.3).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { signedInOnly } from '../../config-visibility.js';
import type { PartySelfRegistration } from '../../config-data-access.js';
import { appPartiesKey, parseAppPartiesValue, type AppPartiesValue, type AppPartyRegistration } from './contract.js';

/** `owner/filename`, the app id the roster and the record key use. */
export const appIdOf = (owner: string, filename: string): string => `${owner}/${filename}`;

export async function readAppParties(storage: Storage, ownerGhii: string, appId: string): Promise<AppPartiesValue> {
    return parseAppPartiesValue((await storage.getMemory(ownerGhii, appPartiesKey(appId)))?.value);
}

/** Change the app's record on its version. `mutate` answers UNCHANGED to write nothing. */
export async function changeAppParties(
    storage: Storage, ownerGhii: string, appId: string,
    mutate: (cur: AppPartiesValue) => AppPartiesValue | typeof UNCHANGED,
): Promise<AppPartiesValue> {
    return updateRecord(storage, ownerGhii, appPartiesKey(appId), parseAppPartiesValue, cur => {
        const next = mutate(cur);
        return next === UNCHANGED ? UNCHANGED : { ...next, appId };
    }, { tag: 'app-parties' });
}

/** The node's setting for app parties now: a closed node is always off. */
export function registrationMode(config: Pick<AimeatConfig, 'partySelfRegistration' | 'contentAccess'>): PartySelfRegistration {
    return signedInOnly(config) ? 'off' : (config.partySelfRegistration ?? 'off');
}

/**
 * May people sign up to this app now? The node allows it and the app's signup is open; under apps-ask
 * only a signup the operator approved (`decidedBy`), so one opened while the node was `on` waits.
 */
export function signupOpen(config: Pick<AimeatConfig, 'partySelfRegistration' | 'contentAccess'>, reg: AppPartyRegistration): boolean {
    const mode = registrationMode(config);
    if (mode === 'off' || reg.state !== 'open') return false;
    return mode === 'on' || !!reg.decidedBy;
}
