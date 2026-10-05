/**
 * @file src/services/packages/install/package-app-tools.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app's tool list travels with its package, without prices (Jouni, 2026-10-02: "ne
 *   työkalulistat voisi kulkea ilman hintoja. koska ne on osa sitä ratkaisua, eri asia jos joku
 *   hinnoittelee ne sitten jatkossa").
 *
 *   WHY. The tools an app offers to agents (`apps.{filename}.tools`, models/app-tool-schemas.ts) are
 *   part of what the app does: what an agent may call, with what input, and what comes back. A
 *   package carried the app's bytes and none of this, so an installed copy offered agents nothing
 *   until its new owner wrote the list again by hand.
 *
 *   WHAT TRAVELS. Per tool: its name, description, input and output shapes, the fixed input, and the
 *   extension action that answers it. WHAT DOES NOT: every price (`price`, `priceMoney`,
 *   `pricesMoney`, `plans`, `tollMorsels`), the market listing and the licence that goes with a price
 *   (`exchange`, `usageTerms`), the author's statements about origin (`provenance`, `aiProvenance`,
 *   `odps`), and the author's agent name (`agent`), which names nobody on the installer's account; a
 *   tool without one is fulfilled by its owner. The installer prices them later if they want to.
 *
 *   ON INSTALL the list is written under the installed app's own name, with every `ext:<name>:` in an
 *   `action_id` pointed at this instance's copy of the extension, and only when the installer has no
 *   list for that app yet: a list they wrote stays theirs.
 * @structure toolsForPackage(doc) · installPackageAppTools(deps, args)
 * @usage meta.app.tools = toolsForPackage(rec.value); await installPackageAppTools(...)
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import type { Storage } from '../../../storage/interface.js';
import { AppToolsDocSchema, appToolsKey } from '../../../models/app-tool-schemas.js';
import { logger } from '../../../utils/logger.js';

/** The fields of one tool that are part of the solution rather than of its pricing or authorship. */
const KEPT = ['name', 'description', 'inputSchema', 'outputSchema', 'lockedInput', 'action_id'] as const;

/** The tool list as a package carries it, or null when the app has none that validates. */
export function toolsForPackage(doc: unknown): Array<Record<string, unknown>> | null {
  const parsed = AppToolsDocSchema.safeParse(doc);
  if (!parsed.success || !parsed.data.tools.length) return null;
  return parsed.data.tools.map(t => {
    const kept: Record<string, unknown> = {};
    for (const k of KEPT) if ((t as Record<string, unknown>)[k] !== undefined) kept[k] = (t as Record<string, unknown>)[k];
    return kept;
  });
}

/** Point an `ext:<name>:<action>` binding at this instance's extension name. */
function rebind(actionId: unknown, extensionNames?: Map<string, string>): unknown {
  if (typeof actionId !== 'string' || !extensionNames?.size) return actionId;
  const m = /^ext:([^:]+):(.+)$/.exec(actionId);
  if (!m) return actionId;
  const renamed = extensionNames.get(m[1]!);
  return renamed ? `ext:${renamed}:${m[2]}` : actionId;
}

/**
 * Write the carried list for the installed app, unless the owner already has one for it. Never fails
 * the install: a list that does not validate is logged and left out, as a data map is.
 */
export async function installPackageAppTools(storage: Storage, args: {
  ownerGhii: string; filename: string; tools: unknown; extensionNames?: Map<string, string>; now: string;
}): Promise<void> {
  if (!Array.isArray(args.tools) || !args.tools.length) return;
  const key = appToolsKey(args.filename);
  if (await storage.getMemory(args.ownerGhii, key)) return;
  const tools = (args.tools as Array<Record<string, unknown>>).map(t => {
    const kept: Record<string, unknown> = {};
    for (const k of KEPT) if (t[k] !== undefined) kept[k] = k === 'action_id' ? rebind(t[k], args.extensionNames) : t[k];
    return kept;
  });
  const doc = AppToolsDocSchema.safeParse({ version: 1, updatedAt: args.now, tools });
  if (!doc.success) {
    logger.warn('package-app-tools: the carried tool list does not validate and was left out', { app: args.filename, error: doc.error.message });
    return;
  }
  await storage.setMemory({
    key, ownerGaii: args.ownerGhii, value: doc.data as unknown as Record<string, unknown>, visibility: 'public',
    tags: ['app-tools', 'package-installed'], ttlHours: null, version: 1, createdAt: args.now, updatedAt: args.now,
  });
}
