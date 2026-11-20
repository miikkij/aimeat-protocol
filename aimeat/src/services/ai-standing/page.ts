/**
 * @file src/services/ai-standing/page.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The address of the "Allow always" section on the Agents page, for the notices, the
 *   feed lines and the route's answer. Its own file so a notice (services/permission-ask-notice.ts)
 *   and the route (routes/agents/ai-standing.ts) build the same address without one importing the other.
 * @structure standingPageUrl(baseUrl, words?)
 * @usage const link = standingPageUrl(config.baseUrl, 'publish:public');
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-toimii-itsen-isesti-omistajan-asetuksella-salli-aina-ja-k).
 */

/** The Agents page opened at the "Allow always" section, with `words` (comma-separated) picked out. */
export function standingPageUrl(baseUrl: string, words?: string): string {
  const q = new URLSearchParams({ tab: 'agents', section: 'allow-always', ...(words ? { word: words } : {}) });
  return `${baseUrl.replace(/\/+$/, '')}/v1/profile?${q.toString()}`;
}
