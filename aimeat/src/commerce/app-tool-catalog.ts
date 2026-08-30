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
 * @structure PricedAppTool · listPublicAppTools · listPricedAppTools
 * @usage
 *   const tools = await listPricedAppTools(storage, config, 100);
 *   const all = await listPublicAppTools(storage, config, { pricedOnly: false });
 * @version-history
 *   v1.1.0 — 2026-08-31 — listPublicAppTools(): the same scan with the price gate made optional, so
 *     the discovery directory can list a FREE published tool too. A free tool is still a thing a
 *     person or an agent can call, and it was invisible everywhere. The commerce surfaces keep
 *     calling listPricedAppTools, which is now the priced-only wrapper — one scanner still, which is
 *     the whole reason this file exists.
 *   v1.0.0 — 2026-07-14 — Extracted from the commerce-acp feed scan + enriched entry shape
 *     (TARGET-034 phase D)
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { AppToolsDocSchema, appIdFromToolsKey } from '../models/app-tool-schemas.js';

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
  const b = config.baseUrl;
  const out: PricedAppTool[] = [];
  const { items } = await storage.listAllMemory({ prefix: 'apps.', limit: 2000 });
  for (const rec of items) {
    if (out.length >= cap) break;
    const appId = appIdFromToolsKey(rec.key);
    if (!appId || rec.visibility !== 'public') continue;
    const parsed = AppToolsDocSchema.safeParse(rec.value);
    if (!parsed.success) continue;
    const ownerName = rec.ownerGaii.split('@')[0] as string;
    const appRef = `${ownerName}/${appId}`;
    const appPath = `${encodeURIComponent(ownerName)}/${encodeURIComponent(appId)}`;
    for (const tool of parsed.data.tools) {
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
        webmcp: {
          listing: `${b}/v1/apps/${appPath}/webmcp`,
          invoke: `${b}/v1/apps/${appPath}/webmcp/tools/${encodeURIComponent(tool.name)}`,
        },
        checkout_item: { kind: 'app-tool', app: appRef, tool: tool.name },
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
