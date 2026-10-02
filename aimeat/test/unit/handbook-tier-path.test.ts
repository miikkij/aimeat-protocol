/**
 * @file handbook-tier-path.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which route the connector's two doors ask when aimeat_handbook_get carries a `tier`.
 * @version-history
 *   2026-10-02 — "settings" and "settings/<term>" go to the setting explanations' parts route.
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { handbookTierPath } from '../../src/cli/connect/handbook-path.js';

describe('handbookTierPath', () => {
  it('sends "build-app" to the first part, never to the 66 kB core or the 95 kB full text', () => {
    expect(handbookTierPath('build-app')).toBe('/v1/prompts/build-app/sections/start');
  });

  it('sends "build-app/<id>" to that part or section, with the id escaped', () => {
    expect(handbookTierPath('build-app/look')).toBe('/v1/prompts/build-app/sections/look');
    expect(handbookTierPath('build-app/group')).toBe('/v1/prompts/build-app/sections/group');
    expect(handbookTierPath('build-app/a b/../c')).toBe('/v1/prompts/build-app/sections/a%20b%2F..%2Fc');
  });

  it('sends "settings" to the list of settings and "settings/<term>" to that setting, the dots kept', () => {
    expect(handbookTierPath('settings')).toBe('/v1/prompts/settings/sections/start');
    expect(handbookTierPath('settings/ai.temperature')).toBe('/v1/prompts/settings/sections/ai.temperature');
    expect(handbookTierPath('settings/config.morsel_policy.burn_rate')).toBe('/v1/prompts/settings/sections/config.morsel_policy.burn_rate');
  });

  it('sends any other tier to the prompt of that id', () => {
    expect(handbookTierPath('tier1')).toBe('/v1/prompts/tier1');
  });
});
