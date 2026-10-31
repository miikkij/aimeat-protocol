/**
 * @file src/services/extension-purchase.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v1.6.1 — 2026-10-31 — An extension-backed capability whose ref names no installed action in the
 *     seller's namespace is refused EXTENSION_NOT_FOUND before the settle. It ran after the settle as
 *     written, and the run read the bare name in the buyer's namespace, so the buyer's own extension
 *     of that name could run with the seller's locked input (secaudit 2026-10-31 inv-20).
 *   v1.6.0 — 2026-10-27 — An extension-backed capability's ref is resolved in the seller's namespace
 *     before the settle, and the run takes that stored name; a ref that lands on the buyer's own
 *     extension is refused EXTENSION_CAPABILITY_NOT_YOURS with nothing charged, the rule the
 *     capability invoke route asks (secaudit2026oct26).
 *   v1.5.1 — 2026-10-25 — A tool's binding is read for the seller: their own extension by a bare name
 *     is still theirs (findBackingCapability; owner namespaces wish, secaudit2026oct22).
 *   v1.5.0 — 2026-10-24 — The seller's extension action runs in-process for the buyer, the
 *     extension's GEAI on its owner's account, and no longer over the loopback HTTP hop with the
 *     bearer of the session the buying extension was serving (secaudit2026oct22,
 *     ext-purchase:buy-forwards-outer-caller-bearer). `jwt` is gone; the buying run passes
 *     `runSellerAction`, which runs services/extension-invoke.ts for the buyer.
 *   v1.4.0 — 2026-10-20 — The invoke carries no scopes: it asserted mcp:use for a buyer that is the
 *     extension's own GEAI, which caused calls on attached MCP servers for a principal the owner
 *     never gave the word to (secaudit 2026-10, capability-invoke.ts:mcp-source:server-slug-
 *     resolved-in-caller-reach).
 *   v1.3.0 — 2026-10-01 — A purchase of a tool whose backing extension serves members only refuses
 *     MEMBERS_ONLY before it is charged when the buying extension's owner is not a member.
 *   v1.2.2 — 2026-09-26 — ownerNameOf takes the account name from localAccountName (utils/gaii.ts), which keeps an identity of another node whole, so it never names the local namesake (secaudit 2026-09, F-1).
 *   v1.2.1 — 2026-09-24 — The scope travels as the capability service's authority object; a purchase
 *     is never the owner in person.
 *   v1.2.0 — 2026-09-24 — The invoke hands the capability service mcp:use, because the settled
 *     purchase authorises the call; a tool bound to a remote MCP tool runs for the buyer again.
 *   v1.1.0 — 2026-08-11 — The backing capability must belong to the seller (August 2026 audit H-17),
 *     and it is resolved BEFORE the settle so a mis-bound tool never takes money it has to give back.
 *   v1.0.0 — 2026-07-28 — Initial: the leg that turns a capability into a component someone can resell.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, CapabilityRecord } from '../storage/interface.js';
import { buildGEAI, appSlug, localAccountName } from '../utils/gaii.js';
import { AppToolsDocSchema, appToolsKey, applyLockedInput } from '../models/app-tool-schemas.js';
import { authoriseMeteredCall } from './metered-access.js';
import { takeDesignations } from '../commerce/beneficiary-designation.js';
import { logger } from '../utils/logger.js';
import { membersOnlyRefusalForCapability, MEMBERS_ONLY_MESSAGE } from './members-only.js';
import { findBackingCapability } from './component-address.js';
import { resolveExtensionForCall } from './component-versions.js';
import { splitExtensionRef } from './capability-extension-ref.js';

/**
 * The bare owner name behind any principal the capability registry stores. Extension-backed
 * capabilities carry `ext.installedBy`, which is a bare name; ones registered through the HTTP door
 * carry a full GHII; either can be an agent or an ecosystem form. All four collapse to the human.
 */
const ownerNameOf = (principal: string): string => localAccountName(principal);

/**
 * One seller extension action run, as services/extension-invoke.ts invokeExtensionAction runs it.
 * The buying run passes this in, because that module calls this one and the two would otherwise
 * import each other.
 */
export type SellerActionRunner = (run: {
  extRef: string;
  actionId: string;
  input: Record<string, unknown>;
  caller: {
    gaii: string; metered: string; owner: string; kind: 'ecosystem';
    roles: string[]; scopes: string[]; appGrantId: null;
  };
  /** Where the seller's paywall writes a refusal. */
  res: { status(code: number): { json(body: unknown): unknown } };
  internalPass: string;
}) => Promise<{ kind: 'ok' | 'refused' | 'paywall'; result?: unknown; status?: number; message?: string }>;

/**
 * Run the seller's extension action for the buyer, in-process, through the same sequence the HTTP
 * route runs: its paywall stands down on `internalPass`, and the run sees the buyer as ctx.caller.
 * The buyer is an ecosystem-kind principal with no scopes, so the run holds nothing of any session.
 * Throws as invokeCapability's extension case threw, so the refund below behaves the same.
 */
async function runSellerExtensionForBuyer(args: {
  cap: CapabilityRecord;
  input: Record<string, unknown>;
  buyer: string;
  buyerOwner: string;
  internalPass: string;
  runSellerAction: SellerActionRunner;
  /** The extension the ref names in the seller's namespace (sellerExtensionTarget). */
  target: { extRef: string; actionId: string };
}): Promise<{ result: unknown }> {
  const { assertCapabilityRunnable } = await import('./capability-invoke.js');
  assertCapabilityRunnable(args.cap);
  // The stored name the seller's namespace resolved, so the run reads that record and never the
  // buyer's own of the same short name. A ref that resolves to nothing is refused before the settle.
  const sellerExt = args.target.extRef;
  const actionId = args.target.actionId;
  // The paywall writes a refusal into a responder; this keeps it to report in the thrown error.
  let refusal: { status: number; body: unknown } | null = null;
  const res = { status(code: number) { return { json(body: unknown) { refusal = { status: code, body }; return body; } }; } };
  const out = await args.runSellerAction({
    extRef: sellerExt, actionId, input: args.input,
    caller: {
      gaii: args.buyer, metered: args.buyer, owner: args.buyerOwner,
      kind: 'ecosystem', roles: ['ecosystem'], scopes: [], appGrantId: null,
    },
    res, internalPass: args.internalPass,
  });
  if (out.kind === 'ok') return { result: out.result };
  const recorded = refusal as { status: number; body: unknown } | null;
  const message = out.kind === 'refused'
    ? (out.message ?? 'Extension invoke failed')
    : ((recorded?.body as { error?: { message?: string } } | undefined)?.error?.message ?? 'Extension invoke failed');
  const statusCode = out.kind === 'refused' ? (out.status ?? 500) : (recorded?.status ?? 502);
  throw Object.assign(new Error(message), { statusCode, code: 'EXTENSION_ERROR' });
}

/**
 * The extension an extension-backed capability's ref names, read in the seller's (the registrant's)
 * namespace as the capability invoke route reads it: its stored name (with the pin), the action, and
 * who installed it. Null when the ref names no installed action.
 */
async function sellerExtensionTarget(
  storage: Storage, ref: string, sellerOwner: string,
): Promise<{ extRef: string; actionId: string; installedBy: string } | null> {
  const segments = splitExtensionRef(ref);
  if (!segments) return null;
  const resolved = await resolveExtensionForCall(storage, segments.pinned, sellerOwner);
  if (!resolved.ok || !resolved.ext.actions.some(a => a.id === segments.action)) return null;
  return {
    extRef: resolved.pinned ? `${resolved.name}@${resolved.pinned}` : resolved.name,
    actionId: segments.action,
    installedBy: resolved.ext.installedBy ?? '',
  };
}

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
  /** Runs a seller's extension action in-process, passed in by the buying run. Its paywall stands
   *  down on the internal pass this purchase mints. */
  runSellerAction: SellerActionRunner;
  correlationId?: string | null;
}): Promise<ExtensionPurchaseResult> {
  const { config, storage, extName, extOwner, appRef, tool, input } = args;
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

  // The manifest NAMES a capability; it does not confer one. `action_id` is a bare id in a node-wide
  // registry, and the only thing that supplied it is the seller's own public memory record — so a
  // seller could write down somebody else's capability and have this call invoke it, on the buyer's
  // account, with the seller collecting. A capability reference resolves inside its owner's
  // namespace, here as everywhere else (see routes/extensions/priced-binding.ts), so the one thing
  // that makes a binding real is that the seller owns what they are selling.
  //
  // Resolved BEFORE the settle, deliberately. Money that has to be given back is a worse answer
  // than money never taken, and a buyer told "no contract" about a tool whose binding is broken
  // goes off to take a contract that could never have worked.
  // The seller's own extension by a bare name is still theirs (services/component-address.ts).
  const cap = await findBackingCapability(storage, toolDef.action_id, sellerOwner);
  if (!cap) {
    return { ok: false, code: 'CAPABILITY_NOT_FOUND', message: `Backing capability not found: ${toolDef.action_id}`, correlation };
  }
  if (ownerNameOf(cap.ownerGhii) !== sellerOwner) {
    logger.warn('Extension purchase refused: the app-tool binds a capability its seller does not own', {
      buyer, seller: `${sellerOwner}/${appId}`, tool, binding: toolDef.action_id, capabilityOwner: cap.ownerGhii,
    });
    return { ok: false, code: 'CAPABILITY_NOT_SOLD_BY_SELLER',
      message: `Tool "${tool}" on app "${appRef}" is bound to a capability "${sellerOwner}" does not own, so there is nothing here for them to sell. Nothing was charged.`,
      correlation };
  }

  // An extension-backed capability runs the extension its ref names, read in the SELLER's namespace,
  // as the capability invoke route reads it. One that lands on the buyer's own extension would let
  // the seller choose which of the buyer's actions runs, with the seller's locked input; the invoke
  // route refuses it (EXTENSION_CAPABILITY_NOT_YOURS), and so does this, before anything is charged
  // (secaudit2026oct26).
  const sellerTarget = cap.source.type === 'extension' ? await sellerExtensionTarget(storage, cap.source.ref, sellerOwner) : null;
  // A ref that names no installed action in the seller's namespace has nothing of the seller's to run,
  // and the run would read its bare name in the buyer's namespace. Refused before the settle, as the
  // capability invoke route refuses it (secaudit 2026-10-31 inv-20).
  if (cap.source.type === 'extension' && !sellerTarget) {
    return { ok: false, code: 'EXTENSION_NOT_FOUND',
      message: `Tool "${tool}" on app "${appRef}" is bound to "${cap.source.ref}", which names no installed action of "${sellerOwner}". Ask the seller to fix the binding. Nothing was charged.`,
      correlation };
  }
  if (sellerTarget && ownerNameOf(sellerTarget.installedBy) === extOwner) {
    return { ok: false, code: 'EXTENSION_CAPABILITY_NOT_YOURS',
      message: `Tool "${tool}" on app "${appRef}" would run your own extension "${sellerTarget.extRef}", and another account published it. Call your extension directly. Nothing was charged.`,
      correlation };
  }

  // Who the app serves, before anything is charged (services/members-only.ts). The buying
  // extension acts for its owner, so the owner's membership is what is asked.
  if (await membersOnlyRefusalForCapability(storage, cap.id, buyer)) {
    return { ok: false, code: 'MEMBERS_ONLY', message: MEMBERS_ONLY_MESSAGE, correlation };
  }

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

  try {
    const { invokeCapability } = await import('./capability-invoke.js');
    const { mintInternalPass } = await import('../routes/extensions/internal-pass.js');
    const lockedInput = applyLockedInput(toolDef, input);
    // Already settled on the product's own coordinate: the seller's paywall must not charge it again.
    const pass = mintInternalPass(coordExt, tool);
    // The run is the BUYER's: the extension's GEAI on its owner's account, the identity the purchase
    // settled on. No session of the person this extension happens to be serving goes with it. Their
    // bearer used to authenticate the seller's action over the loopback HTTP hop, so the seller's
    // code ran as that person, with their wallet, files and namespace, although they never chose the
    // seller (secaudit2026oct22, ext-purchase:buy-forwards-outer-caller-bearer). An extension-backed
    // capability therefore runs in-process for the buyer; every other source takes no bearer.
    // An extension-backed capability has its seller target: one without it was refused above.
    const invoked = cap.source.type === 'extension' && sellerTarget
      ? await runSellerExtensionForBuyer({
        cap, input: lockedInput, buyer, buyerOwner: extOwner, internalPass: pass,
        runSellerAction: args.runSellerAction, target: sellerTarget,
      })
      : await invokeCapability(
        config, storage, cap, lockedInput, buyer, '', 'normal', pass,
        // NOTHING. The buyer is the extension's GEAI, which holds no scope of any session.
        // Asserting `{ scopes: ['mcp:use'] }` caused calls on attached MCP servers for a principal
        // nobody gave the word to (secaudit 2026-10). A capability over a remote MCP tool is
        // therefore not buyable through ctx.buy; an extension that needs one attaches the server itself.
        { scopes: [] },
      );
    // Delivered → book the SELLER's beneficiaries out of the seller's own cut, exactly as the REST
    // and MCP doors do. A capability buying from another capability is still a sale.
    const shared = takeDesignations(invoked.result);
    if (outcome.kind === 'settled') await outcome.accrue(shared.designations);
    logger.info('Extension purchased from another provider', {
      buyer, seller: `${sellerOwner}/${appId}`, tool, correlation,
      charged: outcome.kind === 'settled' ? outcome.charged : 0,
    });
    return {
      ok: true, result: shared.result, correlation,
      charged: outcome.kind === 'settled' ? outcome.charged : 0,
    };
  } catch (err) {
    // Money never leaves without delivery, on this leg as on every other.
    if (outcome.kind === 'settled') await outcome.refund();
    const e = err as { code?: string; message?: string };
    return { ok: false, code: e.code ?? 'PURCHASE_INVOKE_FAILED', message: e.message ?? 'The purchased call failed; you were refunded', correlation };
  }
}
