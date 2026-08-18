/**
 * @file ai-tool-setup.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Fetches the per-tool setup table from the node. The table itself lives in
 *   src/services/ai-tool-setup.ts, because the other consumer cannot import from here: the
 *   Experience Center is a standalone published app on its own origin. Two copies would drift,
 *   and drifting setup instructions are worse than none — the reader follows them, fails, and
 *   concludes the product is broken rather than the page stale.
 *
 *   Strings arrive already localized and URLs already resolved against the serving node, so a
 *   self-hosted node shows its own address. No offline fallback: this module is served BY the
 *   node, so if the node cannot answer, nothing on this page would render anyway.
 * @structure fetchAiTools(lang?) -> Promise<AiTool[]>
 * @usage import { fetchAiTools } from '/views/profile/ai-tool-setup.js';
 * @version-history
 *   v2.0.0 — 2026-07-31 — Table moved to the node (GET /v1/ai-tools); this is now the fetcher.
 *   v1.0.0 — 2026-07-31 — Initial, as an in-SPA table.
 */
import { apiGet } from '/js/api.js';
import { getLocale } from '/js/i18n.js';

/**
 * @returns {Promise<Array<{id: string, label: string, mcp: object, instructions: object}>>}
 */
export async function fetchAiTools(lang) {
  const r = await apiGet(`/v1/ai-tools?lang=${encodeURIComponent(lang || getLocale())}`);
  return (r && r.data && r.data.tools) || [];
}
