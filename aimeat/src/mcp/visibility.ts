/**
 * @file src/mcp/visibility.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI visibility tools on the node's MCP endpoint: the owner's report and the
 *   owner's switch. Neither does the work itself: the report is readVisibilityReport() and the
 *   switch is setVisibilitySettings(), the same functions GET /v1/visibility/report and PUT
 *   /v1/visibility/settings call (routes/visibility.ts), so the panel and the owner's AI read one
 *   answer. The scope words are applied where every tool is registered (TOOL_SCOPES).
 * @structure registerVisibilityTools(mcp, storage, config, caller)
 * @usage import { registerVisibilityTools } from './visibility.js';
 * @version-history
 *   v1.2.0 — 2026-10-08 — aimeat_visibility_feed, over the same service functions as /v1/visibility/feed (layer E).
 *   v1.1.0 — 2026-10-08 — aimeat_visibility_settings_set takes the Clarity and GA4 ids (layer B).
 *   v1.0.0 — 2026-10-08 — Initial, for AI visibility (layer A).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { readVisibilityReport } from '../services/visibility/visibility-report.js';
import { setVisibilitySettings, VisibilitySettingsError } from '../services/visibility/visibility-settings.js';
import { visibilitySettingsView } from '../services/visibility/analytics-tags.js';
import {
  setFeedSettings, syncStripeCatalog, describeFeed, nodeAllowsFeeds, FeedSettingsError,
} from '../services/visibility/merchant-feed-settings.js';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

export function registerVisibilityTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  caller: () => CallerContext,
): void {
  /** The account whose place this is. A visitor from another node has none here. */
  const ownerOf = (): string | null => {
    const c = caller();
    return c.visitor ? null : c.ownerGhii;
  };
  const NO_PLACE = 'A session from another node has no visibility report here.';

  mcp.tool(
    'aimeat_visibility_report',
    descriptionFor('aimeat_visibility_report'),
    zodShapeFor('aimeat_visibility_report'),
    annotationsFor('aimeat_visibility_report'),
    async ({ days }) => {
      const owner = ownerOf();
      if (!owner) return toolError('FORBIDDEN', NO_PLACE);
      return text(await readVisibilityReport(storage, config, owner, { days }));
    },
  );

  mcp.tool(
    'aimeat_visibility_settings_set',
    descriptionFor('aimeat_visibility_settings_set'),
    zodShapeFor('aimeat_visibility_settings_set'),
    annotationsFor('aimeat_visibility_settings_set'),
    async ({ enabled, clarity_project_id, ga4_measurement_id }) => {
      const owner = ownerOf();
      if (!owner) return toolError('FORBIDDEN', NO_PLACE);
      try {
        const settings = await setVisibilitySettings(storage, owner, {
          enabled, clarityProjectId: clarity_project_id, ga4MeasurementId: ga4_measurement_id,
        });
        return text(visibilitySettingsView(config, settings));
      } catch (e) {
        if (e instanceof VisibilitySettingsError) return toolError(e.code, e.message);
        throw e;
      }
    },
  );

  mcp.tool(
    'aimeat_visibility_feed',
    descriptionFor('aimeat_visibility_feed'),
    zodShapeFor('aimeat_visibility_feed'),
    annotationsFor('aimeat_visibility_feed'),
    async ({ enabled, brand, return_policy_label, store_url, product_links, stripe_sync }) => {
      const c = caller();
      if (c.visitor) return toolError('FORBIDDEN', 'A session from another node has no product feed here.');
      try {
        const change = { enabled, brand, returnPolicyLabel: return_policy_label, storeUrl: store_url, productLinks: product_links };
        if (Object.values(change).some((v) => v !== undefined)) await setFeedSettings(storage, c.ownerGhii, change);
        let stripe: unknown;
        if (stripe_sync) {
          if (!nodeAllowsFeeds(config)) return toolError('FEATURE_DISABLED', 'Product feeds are switched off on this node.');
          stripe = await syncStripeCatalog(storage, config, c.ownerGhii, { checkOnly: stripe_sync === 'check' });
        }
        const feed = await describeFeed(storage, config, c.ownerGhii, c.owner);
        return text(stripe ? { ...feed, stripe } : feed);
      } catch (e) {
        if (e instanceof FeedSettingsError) return toolError(e.code, e.message);
        throw e;
      }
    },
  );
}
