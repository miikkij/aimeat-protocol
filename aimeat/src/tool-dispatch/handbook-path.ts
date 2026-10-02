/**
 * @file handbook-path.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which route answers aimeat_handbook_get when it is asked for a `tier`, on the
 *   connector's two doors.
 *
 *   One function for both doors (the connector MCP tool and the CLI dispatch a fleet daemon
 *   calls), because a parameter one of them does not read is dropped in silence. `tier` exists
 *   on the node's own MCP tool; without it here, the shared description would tell a connector
 *   agent to pass `tier: "build-app"` and the door would refuse it.
 * @structure handbookTierPath(tier)
 * @usage client.get(handbookTierPath('build-app'))   // → /v1/prompts/build-app/sections/start
 * @version-history
 *   2026-10-02 — "settings" and "settings/<term>" map to the setting explanations' parts route.
 *   2026-10-01 — "features" and "features/<id>" map to the feature map's parts route.
 *   2026-09-19 — "build-app-atelier" and "build-app-atelier/<id>" map to the Atelier parts route,
 *     as the Classic tiers map to theirs.
 *   v1.0.0 — 2026-09-18 — Initial.
 */

export function handbookTierPath(tier: string): string {
  // The first of the four parts, not the 66 kB core: a connector agent is an MCP client too, and
  // its client keeps a result of that size out of the conversation.
  if (tier === 'build-app-atelier') return '/v1/prompts/build-app-atelier/sections/start';
  if (tier.startsWith('build-app-atelier/')) {
    return '/v1/prompts/build-app-atelier/sections/' + encodeURIComponent(tier.slice('build-app-atelier/'.length));
  }
  if (tier === 'features') return '/v1/prompts/features/sections/start';
  if (tier.startsWith('features/')) {
    return '/v1/prompts/features/sections/' + encodeURIComponent(tier.slice('features/'.length));
  }
  if (tier === 'settings') return '/v1/prompts/settings/sections/start';
  if (tier.startsWith('settings/')) {
    return '/v1/prompts/settings/sections/' + encodeURIComponent(tier.slice('settings/'.length));
  }
  if (tier === 'build-app') return '/v1/prompts/build-app/sections/start';
  if (tier.startsWith('build-app/')) {
    return '/v1/prompts/build-app/sections/' + encodeURIComponent(tier.slice('build-app/'.length));
  }
  return '/v1/prompts/' + encodeURIComponent(tier);
}
