/**
 * @file src/services/extension-purchase.ts
 * @description `ctx.buy` — an extension buying a capability from ANOTHER provider, on its own owner's
 *   account. The publisher leg of the supply chain.
 *
 *   The market already lets an app say it needs data XYZ (a NEED), lets someone offer it, and lets the
 *   two sign a contract. What it could not do was USE that contract while serving the app's own users.
 *   An app's browser half runs as whoever opened it, so a call it makes spends the USER's money — which
 *   is right for what the user buys from the app, and useless for what the app buys from its supplier.
 *   The two legs have different payers and there was only one identity.
 *
 *   So the buying happens HERE, in the half that is already the publisher's: the extension, running
 *   server-side in the node's sandbox. It buys as `eco:{ext}#{installedBy}@{node}` — an identity that
 *   NAMES the extension and resolves to its owner's wallet, so the publisher pays and the record says
 *   which of their capabilities spent it.
 *
 *   The end user never learns any of this. They pay the app's price; the app pays its supplier's; the
 *   difference is the app owner's margin, and the correlation id ties the two settlements together so
 *   that margin is readable instead of being two unrelated piles.
 * @structure buyForExtension · ExtensionPurchaseResult
 * @usage
 *   // inside an extension action
 *   const r = await ctx.buy('alice/data.html', 'lookup', { id: '123' });
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial: the leg that turns a capability into a component someone can resell.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { buildGEAI, appSlug } from '../utils/gaii.js';
import { AppToolsDocSchema, appToolsKey, applyLockedInput } from '../models/app-tool-schemas.js';
import { authoriseMeteredCall } from './metered-access.js';
import { logger } from '../utils/logger.js';

/** What an extension's purchase produced — or why it could not be made. */
export interface ExtensionPurchaseResult {
  ok: boolean;
  result?: unknown;
  /** Machine-readable reason when `ok` is false, so the extension can decide rather than guess. */
  code?: string;
  message?: string;
  /** What this call cost the extension's owner, in the contract's unit. Zero under a grant. */
  charged?: number;
  /** Ties this purchase to the call that caused it — see `correlationId` below. */
  correlation?: string;
}

/**
 * Buy one call of another owner's app-tool, billed to THIS extension's owner.
 *
 * `correlationId` is the call the extension is currently serving. Stamped on the purchase so a
 * provider can read cost against revenue for the same event; without it an app owner sees what they
 * earned and what they spent as two unrelated columns and cannot tell whether a product makes money.
 */
export async function buyForExtension(args: {
  config: AimeatConfig;
  storage: Storage;
  /** The extension doing the buying, and the owner whose account it buys on. */
  extName: string;
  extOwner: string;
  /** `owner/filename` of the app being bought from, and the tool on it. */
  appRef: string;
  tool: string;
  input: Record<string, unknown>;
  /** The caller's bearer token — the invoke runs over the node's own authenticated surface. */
  jwt: string;
  correlationId?: string | null;
}): Promise<ExtensionPurchaseResult> {
  const { config, storage, extName, extOwner, appRef, tool, input, jwt } = args;
  const slash = appRef.indexOf('/');
  if (slash < 1 || slash === appRef.length - 1) {
    return { ok: false, code: 'INVALID_APP', message: 'Buy from "ownerName/appId" — e.g. "alice/data.html"' };
  }
  const sellerOwner = appRef.slice(0, slash);
  const appId = appRef.slice(slash + 1);

  if (sellerOwner === extOwner) {
    return { ok: false, code: 'SELF_PURCHASE', message: 'This is your own app; call its capability directly rather than buying it from yourself.' };
  }

  // The seller's PUBLIC manifest is the authority on what the tool is and what it fixes.
  const rec = await storage.getMemory(`${sellerOwner}@${config.nodeId}`, appToolsKey(appId));
  if (!rec || rec.visibility !== 'public') {
    return { ok: false, code: 'APP_TOOLS_NOT_FOUND', message: `App "${appRef}" declares no public tool manifest` };
  }
  const parsed = AppToolsDocSchema.safeParse(rec.value);
  if (!parsed.success) return { ok: false, code: 'INVALID_TOOL_MANIFEST', message: `App "${appRef}" has a malformed tool manifest` };
  const toolDef = parsed.data.tools.find(t => t.name === tool);
  if (!toolDef) return { ok: false, code: 'TOOL_NOT_FOUND', message: `No tool "${tool}" on app "${appRef}"` };
  if (!toolDef.action_id) return { ok: false, code: 'TOOL_NOT_INVOKABLE', message: `Tool "${tool}" has no capability binding` };

  // The extension buys as ITSELF, on its owner's account: named in the record, billed to the human.
  const buyer = buildGEAI(appSlug(extName), extOwner, config.nodeId);
  const coordExt = `apptool:${sellerOwner}/${appId}`;
  const correlation = args.correlationId ?? `chain-${randomUUID().slice(0, 12)}`;

  const outcome = await authoriseMeteredCall({
    config, storage, caller: buyer,
    product: { ext: coordExt, action: tool, label: `${appId}/${tool}`, providerOwner: sellerOwner },
    // No session: this is not a request, it is one capability buying from another. The spend
    // permission an app grant needs does not apply — the extension IS its owner's own code.
  });

  if (outcome.kind === 'no_right') {
    return { ok: false, code: 'NO_CONTRACT',
      message: `Your account holds no contract for "${appRef}" · ${tool}. Take one on EXCHANGE (the offering for that tool), then this call will settle against it.`,
      correlation };
  }
  if (outcome.kind !== 'settled' && outcome.kind !== 'free_owner') {
    return { ok: false, code: outcome.kind.toUpperCase(), message: `The purchase could not settle (${outcome.kind})`, correlation };
  }

  const cap = await storage.getCapability(toolDef.action_id);
  if (!cap) {
    if (outcome.kind === 'settled') await outcome.refund();
    return { ok: false, code: 'CAPABILITY_NOT_FOUND', message: `Backing capability not found: ${toolDef.action_id}`, correlation };
  }

  try {
    const { invokeCapability } = await import('./capability-invoke.js');
    const { mintInternalPass } = await import('../routes/extensions/internal-pass.js');
    const invoked = await invokeCapability(
      config, storage, cap, applyLockedInput(toolDef, input), buyer, jwt, 'normal',
      // Already settled on the product's own coordinate — the raw paywall must not charge it again.
      mintInternalPass(coordExt, tool),
    );
    logger.info('Extension purchased from another provider', {
      buyer, seller: `${sellerOwner}/${appId}`, tool, correlation,
      charged: outcome.kind === 'settled' ? outcome.charged : 0,
    });
    return {
      ok: true, result: invoked.result, correlation,
      charged: outcome.kind === 'settled' ? outcome.charged : 0,
    };
  } catch (err) {
    // Money never leaves without delivery, on this leg as on every other.
    if (outcome.kind === 'settled') await outcome.refund();
    const e = err as { code?: string; message?: string };
    return { ok: false, code: e.code ?? 'PURCHASE_INVOKE_FAILED', message: e.message ?? 'The purchased call failed; you were refunded', correlation };
  }
}
