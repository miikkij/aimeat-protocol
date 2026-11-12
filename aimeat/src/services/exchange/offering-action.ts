/**
 * @file src/services/exchange/offering-action.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The extension action behind an ext-action offering, read live from the provider's
 *   extension. GET /v1/exchange/offerings/:id and aimeat_exchange_offering_get both read it here
 *   (CLAUDE.md, Backend: one capability, one implementation); each surface builds its own capability
 *   block and call recipe from the action.
 * @structure offeringExtAction
 * @usage const act = await offeringExtAction(storage, offering);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial (structure programme unit 2).
 */
import type { Storage, ExtensionRecord } from '../../storage/interface.js';

export type OfferingExtAction = ExtensionRecord['actions'][number];

/** The action an offering names on its extension, or undefined when the extension or the action is gone. */
export async function offeringExtAction(
    storage: Storage, offering: { ext: string; action: string },
): Promise<OfferingExtAction | undefined> {
    const extRec = await storage.getExtension(offering.ext);
    return extRec?.actions.find(a => a.id === offering.action);
}
