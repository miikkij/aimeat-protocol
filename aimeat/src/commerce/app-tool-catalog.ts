/**
 * @file src/commerce/app-tool-catalog.ts
 * @description THE priced-app-tool enumerator (TARGET-034 phase D): one shared scan of every
 *   PUBLIC apps.{appId}.tools manifest on the node, yielding normalized catalog entries every
 *   discovery surface renders from — the ACP product feed, the dedicated GET /v1/commerce/tools
 *   endpoint, and the MCP Server Card's commerce_tools block (inline mode). One scanner means the
 *   surfaces can never drift on gates (public record, priced tool, dotted appIds) or on the sku
 *   grammar "app-tool:<owner>/<appId>:<tool>".
 * @structure PricedAppTool · listPricedAppTools
 * @usage
 *   const tools = await listPricedAppTools(storage, config, 100);
 * @version-history
 *   v1.0.0 — 2026-07-14 — Extracted from the commerce-acp feed scan + enriched entry shape
 *     (TARGET-034 phase D)
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { AppToolsDocSchema } from '../models/app-tool-schemas.js';

/** One sellable app-tool as every discovery surface sees it. */
export interface PricedAppTool {
  /** Checkout/feed sku: "app-tool:<owner>/<appId>:<tool>". */
  sku: string;
  /** "ownerName/appId" — the checkout line item's app reference. */
  app: string;
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

/**
 * Every priced tool from every PUBLIC apps.{appId}.tools manifest, capped at `cap` entries.
 * appIds are published filenames and nearly always carry dots ("aimeat-pages.html") — the key is
 * matched greedily between the fixed "apps." prefix and ".tools" suffix.
 */
export async function listPricedAppTools(
  storage: Storage,
  config: AimeatConfig,
  cap = 500,
): Promise<PricedAppTool[]> {
  const b = config.baseUrl;
  const out: PricedAppTool[] = [];
  const { items } = await storage.listAllMemory({ prefix: 'apps.', limit: 2000 });
  for (const rec of items) {
    if (out.length >= cap) break;
    const keyMatch = /^apps\.(.+)\.tools$/.exec(rec.key);
    if (!keyMatch || rec.visibility !== 'public') continue;
    const parsed = AppToolsDocSchema.safeParse(rec.value);
    if (!parsed.success) continue;
    const appId = keyMatch[1] as string;
    const ownerName = rec.ownerGaii.split('@')[0] as string;
    const appRef = `${ownerName}/${appId}`;
    const appPath = `${encodeURIComponent(ownerName)}/${encodeURIComponent(appId)}`;
    for (const tool of parsed.data.tools) {
      if (out.length >= cap) break;
      const morsels = tool.price?.morsels ?? 0;
      if (morsels <= 0 && !tool.priceMoney) continue;
      out.push({
        sku: `app-tool:${appRef}:${tool.name}`,
        app: appRef,
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
