/**
 * @file src/commerce/app-tool-catalog.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE priced-app-tool enumerator (TARGET-034 phase D): one shared scan of every
 *   PUBLIC apps.{appId}.tools manifest on the node, yielding normalized catalog entries every
 *   discovery surface renders from — the ACP product feed, the dedicated GET /v1/commerce/tools
 *   endpoint, and the MCP Server Card's commerce_tools block (inline mode). One scanner means the
 *   surfaces can never drift on gates (public record, priced tool, dotted appIds) or on the sku
 *   grammar "app-tool:<owner>/<appId>:<tool>".
 * @structure PricedAppTool · OwnAppTool · publicManifestTools · listPublicAppTools ·
 *   listPricedAppTools · listOwnCallableAppTools · OwnerAppToolName · listOwnerAppToolNames ·
 *   toolPacing · paceFreeToolUse · FreeToolPacing
 * @usage
 *   const tools = await listPricedAppTools(storage, config, 100);
 *   const all = await listPublicAppTools(storage, config, { pricedOnly: false });
 *   const mine = await listOwnCallableAppTools(storage, config, req.auth.owner, 500);
 *   const byApp = await listOwnerAppToolNames(storage, ownerGhii);
 * @version-history
 *   v1.5.0 — 2026-10-12 — listOwnerAppToolNames(): the names and descriptions of every tool an
 *     owner's own agent can call on the owner's apps, priced ones included, by app. The home's
 *     agent draft reads it (GET /v1/home/agents/choices?include=tools). It and
 *     listOwnCallableAppTools are made from one read of the owner's manifests (ownPublicManifests).
 *   v1.4.0 — 2026-10-11 — A morsel is pacing, never a price (decision-morseli-on-tahdistus-ei-hinta-
 *     tarjouksen-kaksi-arvoa). An entry carries `toll_morsels`; `price` is a deprecated mirror of it
 *     until 4.0.0. The catalog lists every tool offered to other owners (isToolOffered: a money price,
 *     or a pacing amount on a free tool), so a tool that had only a morsel price stays listed as free.
 *     paceFreeToolUse: the one pacing charge for a free tool's use, for the REST invoke route and
 *     its MCP twin.
 *   v1.3.0 — 2026-10-07 — A tool counts as priced by isToolPriced, the invoke route's own test, and
 *     an entry carries every money price (`pricesMoney`, with `priceMoney` its first). A tool sold
 *     only in `pricesMoney` was missing from the feed, this catalog and the MCP card while its
 *     invoke answered 402.
 *   v1.2.0 — 2026-10-07 — listOwnCallableAppTools(): one owner's UNPRICED callable tools, for
 *     GET /v1/commerce/tools?include=own, so an agent reads its own owner's free tools in the same
 *     call as the priced catalog instead of one listing per app. publicManifestTools() is the one
 *     "is this manifest public and well-formed" gate, shared with the WebMCP invoke route, so a
 *     tool this file lists is a tool that route will run.
 *   v1.1.1 — 2026-09-26 — The owner name comes from localAccountName (utils/gaii.ts), which keeps an
 *     identity of another node whole, so it never names the local namesake (secaudit 2026-09, F-1).
 *   v1.1.0 — 2026-08-31 — listPublicAppTools(): the same scan with the price gate made optional, so
 *     the discovery directory can list a FREE published tool too. A free tool is still a thing a
 *     person or an agent can call, and it was invisible everywhere. The commerce surfaces keep
 *     calling listPricedAppTools, which is now the priced-only wrapper — one scanner still, which is
 *     the whole reason this file exists.
 *   v1.0.0 — 2026-07-14 — Extracted from the commerce-acp feed scan + enriched entry shape
 *     (TARGET-034 phase D)
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord } from '../storage/interface.js';
import { AppToolsDocSchema, appIdFromToolsKey, isToolOffered, presentToolPacing, toolMoneyPrices, toolTollMorsels, type AppTool } from '../models/app-tool-schemas.js';
import { localAccountName } from '../utils/gaii.js';
import { chargePacing, resolvePacingToll, type PacingCharge } from '../services/metered-settlement.js';
import { commerceFeePercent } from '../services/marketplace-fee.js';

/** One sellable app-tool as every discovery surface sees it. */
export interface PricedAppTool {
  /** Checkout/feed sku: "app-tool:<owner>/<appId>:<tool>". */
  sku: string;
  /** "ownerName/appId" — the checkout line item's app reference. */
  app: string;
  /** The publishing account, on its own, so a caller does not have to split `app` to get it. */
  ownerName: string;
  /** The published filename this tool belongs to. */
  appId: string;
  /** When the manifest this tool came from was last written. */
  updatedAt: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** 'call' = synchronous capability invoke on completion; 'task' = agent TASK for the seller. */
  fulfillment: 'call' | 'task';
  /** The pacing amount per call, in morsels (toolTollMorsels). Not a price; 0 = unpaced. */
  toll_morsels: number;
  /** Deprecated mirror of `toll_morsels` for 3.x readers, present while it is above 0, gone from 4.0.0. */
  price?: { morsels: number; unit: string; deprecated: string };
  /** Money price in 6-decimal micro-units: the first of `pricesMoney`. */
  priceMoney?: { amount: number; currency: string; scale: 6 };
  /** Every money price, one per currency, `priceMoney` first. Buy in another one with the session `currency`. */
  pricesMoney?: Array<{ amount: number; currency: string; scale: 6 }>;
  /** The WebMCP bridge surfaces for this tool (listing + HTTP invoke; unpaid priced invoke → 402). */
  webmcp: { listing: string; invoke: string };
  /** Ready-made checkout line item — add your `input`, open + complete a session with it. */
  checkout_item: { kind: 'app-tool'; app: string; tool: string };
}

export interface AppToolScanOptions {
  /** Stop after this many entries. */
  cap?: number;
  /**
   * Whether a tool that is not offered to other owners is skipped: one with neither a money price nor
   * a pacing amount (isToolOffered). The commerce surfaces want true (the default). A free tool with a
   * pacing amount is offered and stays listed, without a money price; the feeds that sell only money
   * read `priceMoney`. The directory answers "what can I use here", where every tool counts.
   */
  pricedOnly?: boolean;
}

/**
 * One of the caller's own owner's UNPRICED callable tools. Same fields as a priced entry, with
 * `price: null` and no checkout item (there is nothing to buy: the owner's own principals invoke
 * it directly on `webmcp.invoke`), and `own: true` to say so.
 */
export type OwnAppTool = Omit<PricedAppTool, 'price' | 'priceMoney' | 'pricesMoney' | 'checkout_item'> & {
  price: null;
  own: true;
};

/**
 * The tools of a stored apps.{appId}.tools record when it is PUBLIC and well-formed, else null.
 * The one gate for "may this manifest be served": the WebMCP listing and invoke route read through
 * it as well as this catalog, so a tool listed here is a tool that route will run, and a private
 * manifest reads exactly like an absent one everywhere.
 */
export function publicManifestTools(rec: MemoryRecord | null | undefined): AppTool[] | null {
  if (!rec || rec.visibility !== 'public') return null;
  const parsed = AppToolsDocSchema.safeParse(rec.value);
  return parsed.success ? parsed.data.tools : null;
}

/** The WebMCP listing and invoke URLs of one tool. */
function webmcpUrls(config: AimeatConfig, ownerName: string, appId: string, tool: string) {
  const appPath = `${encodeURIComponent(ownerName)}/${encodeURIComponent(appId)}`;
  return {
    listing: `${config.baseUrl}/v1/apps/${appPath}/webmcp`,
    invoke: `${config.baseUrl}/v1/apps/${appPath}/webmcp/tools/${encodeURIComponent(tool)}`,
  };
}

/**
 * Every tool from every PUBLIC apps.{appId}.tools manifest, capped at `cap` entries.
 * appIds are published filenames and nearly always carry dots ("aimeat-pages.html") — the key is
 * matched greedily between the fixed "apps." prefix and ".tools" suffix.
 */
export async function listPublicAppTools(
  storage: Storage,
  config: AimeatConfig,
  opts: AppToolScanOptions = {},
): Promise<PricedAppTool[]> {
  const cap = opts.cap ?? 500;
  const pricedOnly = opts.pricedOnly ?? true;
  const out: PricedAppTool[] = [];
  const { items } = await storage.listAllMemory({ prefix: 'apps.', limit: 2000 });
  for (const rec of items) {
    if (out.length >= cap) break;
    const appId = appIdFromToolsKey(rec.key);
    if (!appId) continue;
    const tools = publicManifestTools(rec);
    if (!tools) continue;
    const ownerName = localAccountName(rec.ownerGaii);
    const appRef = `${ownerName}/${appId}`;
    for (const tool of tools) {
      if (out.length >= cap) break;
      // Offered = a money price (isToolPriced, the invoke route's own 402 test, which reads
      // `pricesMoney` too) or a pacing amount on a free tool. A morsel is never a price, so a tool
      // that had only `price.morsels` stays listed as free with that much pacing: nothing disappears.
      if (pricedOnly && !isToolOffered(tool)) continue;
      const money = toolMoneyPrices(tool).map((m) => ({ amount: m.amount, currency: m.currency, scale: 6 as const }));
      out.push({
        sku: `app-tool:${appRef}:${tool.name}`,
        app: appRef,
        ownerName,
        appId,
        updatedAt: rec.updatedAt,
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
        fulfillment: tool.action_id ? 'call' : 'task',
        ...presentToolPacing(tool),
        ...(money.length ? { priceMoney: money[0], pricesMoney: money } : {}),
        webmcp: webmcpUrls(config, ownerName, appId, tool.name),
        checkout_item: { kind: 'app-tool', app: appRef, tool: tool.name },
      });
    }
  }
  return out;
}

/** One of an owner's public, well-formed tool manifests. */
interface OwnManifest { appId: string; ownerName: string; updatedAt: string; tools: AppTool[] }

/**
 * The public, well-formed tool manifests stored under one owner, in the store's order. The one read
 * both owner listings below are made from: only the records under `ownerGhii`, the identity the
 * invoke route reads a manifest from, so another owner's tools cannot enter either list.
 */
async function ownPublicManifests(storage: Storage, ownerGhii: string): Promise<OwnManifest[]> {
  const out: OwnManifest[] = [];
  const records = await storage.listMemory(ownerGhii, { prefix: 'apps.', visibility: 'public' });
  for (const rec of records) {
    const appId = appIdFromToolsKey(rec.key);
    if (!appId) continue;
    const tools = publicManifestTools(rec);
    if (!tools) continue;
    out.push({ appId, ownerName: localAccountName(rec.ownerGaii), updatedAt: rec.updatedAt, tools });
  }
  return out;
}

/**
 * The UNPRICED callable tools of one owner's PUBLIC manifests: what that owner's own principals
 * (the owner, their agents, their apps) can run directly on the WebMCP invoke route.
 *
 * Reads only the records stored under `ownerGhii`, the identity the invoke route reads the manifest
 * from, so another owner's free tools cannot enter this list whatever their manifests say. A tool
 * with a price in any of its three fields (isToolPriced) is left out: it is in the priced catalog
 * already, and the invoke route would answer 402. A tool with no action_id is left out too: an
 * unpriced task tool has nothing to run, and the invoke route answers 422 for it.
 */
export async function listOwnCallableAppTools(
  storage: Storage,
  config: AimeatConfig,
  ownerGhii: string,
  cap = 500,
): Promise<OwnAppTool[]> {
  const out: OwnAppTool[] = [];
  for (const { appId, ownerName, updatedAt, tools } of await ownPublicManifests(storage, ownerGhii)) {
    if (out.length >= cap) break;
    for (const tool of tools) {
      if (out.length >= cap) break;
      if (isToolOffered(tool) || !tool.action_id) continue;
      out.push({
        sku: `app-tool:${ownerName}/${appId}:${tool.name}`,
        app: `${ownerName}/${appId}`,
        ownerName,
        appId,
        updatedAt,
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
        fulfillment: 'call',
        toll_morsels: 0,
        price: null,
        webmcp: webmcpUrls(config, ownerName, appId, tool.name),
        own: true,
      });
    }
  }
  return out;
}

/** One tool of an owner's app, as a page names it to the person or to a model: no schema, no price. */
export interface OwnerAppToolName {
  name: string;
  /** "app-tool:<owner>/<appId>:<tool>", the address an agent calls the tool by. */
  sku: string;
  /** The tool's own description, cut at OWNER_TOOL_DESCRIPTION_MAX characters. */
  description: string;
}

/** The longest description listOwnerAppToolNames answers with. A manifest allows 10 000 characters. */
export const OWNER_TOOL_DESCRIPTION_MAX = 300;

/**
 * Every tool an agent of this owner can call on the owner's own apps, by app id (the published
 * filename), in the manifest's order: the tools of the owner's PUBLIC manifests that have something
 * to run (`action_id`), priced or not. The owner's own principals run both free on the WebMCP
 * invoke route (services/metered-access.ts answers `free_owner` before any price is asked).
 *
 * A tool with no `action_id` is left out whether or not it has a price. It is fulfilled as a task,
 * and only through a checkout session (commerce/sellable-resolvers.ts); a direct call answers 422
 * TOOL_NOT_INVOKABLE for the owner too (routes/webmcp.ts). The first version of this function
 * listed a priced one as callable, and a draft would have told an agent to call a tool that
 * nothing runs (found in review, 2026-10-12).
 *
 * Reads only the records stored under `ownerGhii`, the same read as listOwnCallableAppTools, so
 * another owner's tools cannot enter. Stops at `cap` tools. Measured on aimeat.io on 2026-10-12:
 * one account, 26 manifests, 157 such tools, 22 of them priced.
 */
export async function listOwnerAppToolNames(
  storage: Storage,
  ownerGhii: string,
  cap = 500,
): Promise<Map<string, OwnerAppToolName[]>> {
  const out = new Map<string, OwnerAppToolName[]>();
  let count = 0;
  for (const { appId, ownerName, tools } of await ownPublicManifests(storage, ownerGhii)) {
    if (count >= cap) break;
    const named: OwnerAppToolName[] = [];
    const appRef = `${ownerName}/${appId}`;
    for (const tool of tools) {
      if (count >= cap) break;
      if (!tool.action_id) continue;
      named.push({
        name: tool.name,
        sku: `app-tool:${appRef}:${tool.name}`,
        description: (tool.description ?? '').trim().slice(0, OWNER_TOOL_DESCRIPTION_MAX),
      });
      count++;
    }
    if (named.length > 0) out.set(appId, named);
  }
  return out;
}

/**
 * The pacing one use of a FREE tool is charged on an invoke route, in morsels: what the tool declares
 * (toolTollMorsels, which reads a deprecated `price.morsels` as pacing) within the node's per-use
 * ceiling. 0 when the tool declares none; the raw paywall then paces the action as it always did.
 */
export function toolPacing(config: AimeatConfig, tool: AppTool): number {
  const declared = toolTollMorsels(tool);
  return declared > 0 ? resolvePacingToll(config, declared) : 0;
}

/**
 * True when the extension action behind a capability (`ext:{name}:{action}`) has its own money price.
 * Once a free tool's pacing is charged, the raw paywall stands down on a `settled` pass so the action
 * is not paced a second time for the same use; an action that sells for money keeps the `unpriced`
 * pass, which still leaves its own price owed (routes/extensions/paywall.ts).
 */
async function actionSellsForMoney(storage: Storage, capRef: string | undefined): Promise<boolean> {
  const m = /^ext:([^:]+):(.+)$/.exec(capRef ?? '');
  if (!m) return false;
  const ext = await storage.getExtension(m[1]!);
  return !!ext?.actions.find(a => a.id === m[2])?.commercial?.payMoney;
}

/** What paceFreeToolUse decided: run the call (with the pass to mint, and the charge to reverse on failure), or refuse. */
export type FreeToolPacing =
  | { kind: 'run'; pass: 'unpriced' | 'settled'; charge: PacingCharge | null }
  | { kind: 'anonymous'; toll: number }
  | { kind: 'insufficient'; toll: number };

/**
 * Pace one use of a FREE tool (no money price) on an invoke route, for the REST WebMCP route and its
 * MCP twin alike (ruling decision-morseli-on-tahdistus-ei-hinta-tarjouksen-kaksi-arvoa). Another
 * owner's use is charged the tool's pacing through chargePacing before the call: part burns, the
 * operator keeps the marketplace share, the rest is credited to the app owner. The app owner's own
 * principals use it free. An anonymous caller is refused (`anonymous`), a short balance too
 * (`insufficient`, nothing moved). On `run`, mint an internal pass of `pass` for the call and call
 * `charge.reverse()` when it fails. Whether the action sells for money is asked before the charge, so
 * nothing between the charge and the call can throw.
 */
export async function paceFreeToolUse(args: {
  config: AimeatConfig; storage: Storage; caller: string; anonymous?: boolean;
  ownerName: string; appId: string; tool: AppTool; capRef?: string;
}): Promise<FreeToolPacing> {
  const { config, storage, caller, ownerName, appId, tool } = args;
  const toll = localAccountName(caller) === ownerName ? 0 : toolPacing(config, tool);
  if (toll <= 0) return { kind: 'run', pass: 'unpriced', charge: null };
  if (args.anonymous) return { kind: 'anonymous', toll };
  const pass = (await actionSellsForMoney(storage, args.capRef)) ? 'unpriced' : 'settled';
  const charge = await chargePacing({
    config, storage, caller, providerGhii: `${ownerName}@${config.nodeId}`, amount: toll,
    label: `apptool:${ownerName}/${appId}:${tool.name}`, feePercent: commerceFeePercent(config),
  });
  if (!charge) return { kind: 'insufficient', toll };
  return { kind: 'run', pass, charge };
}

/** The priced-only scan the commerce surfaces sell from. Positional `cap` kept for its callers. */
export async function listPricedAppTools(
  storage: Storage,
  config: AimeatConfig,
  cap = 500,
): Promise<PricedAppTool[]> {
  return listPublicAppTools(storage, config, { cap, pricedOnly: true });
}
