/**
 * @file src/routes/extensions/priced-binding.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Is this raw extension action the thing a PRICED app-tool actually sells? If it is,
 *   the raw door onto it must not be free — otherwise every priced app on the node has a bypass
 *   sitting beside its own front door, and the buyer who paid is the only one who paid.
 *
 *   Measured on aimeat.io on 2026-07-27: `nuotta.html/search` sold `ext:kaiku-signals:search` for
 *   0.01 EUR while any signed-in principal could POST `/v1/ext/kaiku-signals/search` and get the
 *   identical answer for nothing. The paywall was not broken — it was inert, because that action
 *   declared no `commercial` block. Nothing about that was specific to one app: the same shape is
 *   available to every owner who binds an extension action into a priced tool, which is the
 *   documented way to build one.
 *
 *   So the rule is a NODE rule, not a per-extension switch an owner has to remember: an action that
 *   backs a priced app-tool is charged on that app-tool's own coordinate, whichever door it is
 *   reached through. A contract holder pays once, at the price they agreed; everyone else gets 402
 *   pointing at the listing they can contract.
 *
 *   Only the extension's OWN owner is consulted. `action_id` names a capability, and a capability
 *   reference resolves inside its owner's namespace — a stranger cannot bind someone else's
 *   extension into their manifest and start charging for it. Scanning one owner also keeps this
 *   bounded on a hot path; the answer is cached, and the manifest that decides it changes only when
 *   its owner republishes.
 *   ONE action can back SEVERAL priced tools — the same capability sold under two names, or the
 *   same app-tool priced in a second app. So this answers with the whole set, and the caller
 *   settles whichever of them the caller actually contracted; picking the first match would charge
 *   a customer against a product they never bought.
 * @structure pricedAppToolsFor(storage, ownerGhii, extName, actionId) → PricedBinding[]
 * @usage const sold = await pricedAppToolsFor(storage, `${owner}@${config.nodeId}`, ext.name, action.id);
 * @version-history
 *   v1.0.0 — 2026-07-27 — Initial: close the free raw door onto every priced app-tool on the node.
 */
import type { Storage } from '../../storage/interface.js';
import { AppToolsDocSchema, isToolPriced } from '../../models/app-tool-schemas.js';
import { cached, TTL } from '../../services/cache.js';
import { logger } from '../../utils/logger.js';

/** The app-tool an extension action is sold as. */
export interface PricedBinding {
  /** App id — a filename with its extension, e.g. `nuotta.html`. */
  appId: string;
  /** Tool name within that app's manifest. */
  tool: string;
}

const APP_TOOLS_PREFIX = 'apps.';
const APP_TOOLS_SUFFIX = '.tools';


/**
 * Every priced app-tool that sells this extension action. Empty is the common answer and means
 * the action stays as free or as commercial as its own manifest says.
 *
 * A read failure returns empty — the action then falls through to its declared terms. That is the
 * safe direction for availability and the unsafe one for revenue, so it is logged loudly rather
 * than swallowed: a storage hiccup must be visible as a hiccup, not as a quiet free hour.
 */
export async function pricedAppToolsFor(
  storage: Storage, ownerGhii: string, extName: string, actionId: string,
): Promise<PricedBinding[]> {
  const binding = `ext:${extName}:${actionId}`;
  try {
    return await cached(`pricedbinding:${ownerGhii}:${binding}`, TTL.dashboard, async () => {
      // The manifests live in the owner's own memory namespace under `apps.{appId}.tools`, keyed by
      // GHII — the caller resolves that, because only it knows the node id.
      const records = await storage.listMemory(ownerGhii, { prefix: APP_TOOLS_PREFIX });
      const out: PricedBinding[] = [];
      for (const rec of records) {
        if (!rec.key.endsWith(APP_TOOLS_SUFFIX)) continue;
        const parsed = AppToolsDocSchema.safeParse(rec.value);
        if (!parsed.success) continue;
        const appId = rec.key.slice(APP_TOOLS_PREFIX.length, -APP_TOOLS_SUFFIX.length);
        for (const t of parsed.data.tools) {
          if (t.action_id === binding && isToolPriced(t)) out.push({ appId, tool: t.name });
        }
      }
      // Stable order, so an ambiguous binding resolves the same way on every node and every call
      // rather than following whatever order the store happened to return.
      return out.sort((a, b) => (a.appId + '/' + a.tool).localeCompare(b.appId + '/' + b.tool));
    }, [`apptools:${ownerGhii}`]);
  } catch (err) {
    logger.warn('priced-binding lookup failed; the raw action falls back to its own declared terms', {
      ownerGhii, binding, error: String(err),
    });
    return [];
  }
}
