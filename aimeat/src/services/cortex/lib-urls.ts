/**
 * @file src/services/cortex/lib-urls.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where each lib of a cortex is served. The cortex install and upsert answers on REST
 *   (routes/cortex.ts) and over MCP (aimeat_cortex_install) carry these addresses. Moved unchanged
 *   from routes/cortex.ts on 2026-11-13, so mcp/cortex.ts imports no route file (CLAUDE.md, Backend;
 *   dependency-cruiser rule mcp-does-not-import-routes).
 * @structure cortexLibUrls(baseUrl, cortex)
 * @usage const lib_urls = cortexLibUrls(config.baseUrl, record);
 * @version-history
 *   v1.0.0 — 2026-11-13 — Moved out of routes/cortex.ts unchanged (structure programme 2026-11, unit 2).
 */
import type { CortexExtensionRecord } from '../../storage/interface.js';
import { cortexLibPath } from '../component-address.js';

/**
 * Where each lib of this cortex is served: the exact `<script src>` an app loads, keyed by filename.
 *
 * The address follows the record's NAME: a cortex installed since 2026-10-25 is named
 * `<owner>/<thing>` and serves from `/v1/cortex/<owner>/<thing>/libs/…`, a bare one from
 * `/v1/cortex/<thing>/libs/…` (services/component-address.ts cortexLibPath). No answer said which, so
 * an author guessed, and a wrong guess is a 404 inside an app that shows nothing. Absolute, because
 * apps run on their own origins.
 */
export function cortexLibUrls(
  baseUrl: string,
  cortex: Pick<CortexExtensionRecord, 'name' | 'components'>,
): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const comp of cortex.components) {
    if (comp.type === 'lib') {
      urls[comp.filename] = `${baseUrl}${cortexLibPath(cortex.name, encodeURIComponent(comp.filename))}`;
    }
  }
  return urls;
}
