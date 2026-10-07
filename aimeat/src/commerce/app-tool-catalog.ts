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
 *   listPricedAppTools · listOwnCallableAppTools
 * @usage
 *   const tools = await listPricedAppTools(storage, config, 100);
 *   const all = await listPublicAppTools(storage, config, { pricedOnly: false });
 *   const mine = await listOwnCallableAppTools(storage, config, req.auth.owner, 500);
 * @version-history
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
import { AppToolsDocSchema, appIdFromToolsKey, isToolPriced, type AppTool } from '../models/app-tool-schemas.js';
import { localAccountName } from '../utils/gaii.js';

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
  price?: { morsels: number; unit: string };
  /** Money price in 6-decimal micro-units. */
  priceMoney?: { amount: number; currency: string; scale: 6 };
  /** The WebMCP bridge surfaces for this tool (listing + HTTP invoke; unpaid priced invoke → 402). */
  webmcp: { listing: string; invoke: string };
  /** Ready-made checkout line item — add your `input`, open + complete a session with it. */
  checkout_item: { kind: 'app-tool'; app: string; tool: string };
}

export interface AppToolScanOptions {
  /** Stop after this many entries. */
  cap?: number;
  /**
   * Whether a tool with no price is skipped. The commerce surfaces sell, so they want true (the
   * default, and what they had before this option existed). The directory answers "what can I use
   * here", where a free tool is the most usable thing on the list.
   */
  pricedOnly?: boolean;
}

/**
 * One of the caller's own owner's UNPRICED callable tools. Same fields as a priced entry, with
 * `price: null` and no checkout item (there is nothing to buy: the owner's own principals invoke
 * it directly on `webmcp.invoke`), and `own: true` to say so.
 */
export type OwnAppTool = Omit<PricedAppTool, 'price' | 'priceMoney' | 'checkout_item'> & {
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
      const morsels = tool.price?.morsels ?? 0;
      if (pricedOnly && morsels <= 0 && !tool.priceMoney) continue;
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
        ...(morsels > 0 ? { price: { morsels, unit: tool.price?.unit ?? 'per-call' } } : {}),
        ...(tool.priceMoney ? { priceMoney: { amount: tool.priceMoney.amount, currency: tool.priceMoney.currency, scale: 6 as const } } : {}),
        webmcp: webmcpUrls(config, ownerName, appId, tool.name),
        checkout_item: { kind: 'app-tool', app: appRef, tool: tool.name },
      });
    }
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
  const records = await storage.listMemory(ownerGhii, { prefix: 'apps.', visibility: 'public' });
  for (const rec of records) {
    if (out.length >= cap) break;
    const appId = appIdFromToolsKey(rec.key);
    if (!appId) continue;
    const tools = publicManifestTools(rec);
    if (!tools) continue;
    const ownerName = localAccountName(rec.ownerGaii);
    for (const tool of tools) {
      if (out.length >= cap) break;
      if (isToolPriced(tool) || !tool.action_id) continue;
      out.push({
        sku: `app-tool:${ownerName}/${appId}:${tool.name}`,
        app: `${ownerName}/${appId}`,
        ownerName,
        appId,
        updatedAt: rec.updatedAt,
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
        fulfillment: 'call',
        price: null,
        webmcp: webmcpUrls(config, ownerName, appId, tool.name),
        own: true,
      });
    }
  }
  return out;
}

/** The priced-only scan the commerce surfaces sell from. Positional `cap` kept for its callers. */
export async function listPricedAppTools(
  storage: Storage,
  config: AimeatConfig,
  cap = 500,
): Promise<PricedAppTool[]> {
  return listPublicAppTools(storage, config, { cap, pricedOnly: true });
}
