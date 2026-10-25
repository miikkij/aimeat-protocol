/**
 * @file test/unit/ecosystem-pending-areas.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Outside apps row's data areas (public/views/profile/ecosystem-tab.helpers.js):
 *   every requested area ticked by default, the approve body's data_areas built from the ticks and
 *   always a list, and each area said in plain words (secaudit2026oct22, lead 2378).
 * @usage cd aimeat && pnpm exec vitest run test/unit/ecosystem-pending-areas.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import { describe, it, expect } from 'vitest';
import { areaSentence, initialTicks, chosenAreas } from '../../public/views/profile/ecosystem-tab.helpers.js';

const request = {
  requested_data_areas: [
    { area: 'organisms', pattern: '*', rights: ['read'] },
    { area: 'memory', pattern: 'support.*', rights: ['read', 'write'] },
  ],
};
/** A stand-in translate: the key, and its variables in a fixed order. */
const tr = (key: string, vars?: Record<string, string>) => (vars ? `${key}(${Object.values(vars).join('|')})` : key);

describe('the data areas on a waiting outside-app request', () => {
  it('are all ticked by default, and the approval sends what stays ticked', () => {
    expect(initialTicks(request)).toEqual([true, true]);
    expect(chosenAreas(request, undefined)).toEqual(request.requested_data_areas);
    expect(chosenAreas(request, [false, true])).toEqual([request.requested_data_areas[1]]);
    expect(chosenAreas(request, [false, false])).toEqual([]);
    expect(chosenAreas({}, undefined)).toEqual([]);
  });

  it('are said in plain words: what may be done, to what, and which of them', () => {
    expect(areaSentence(request.requested_data_areas[0], tr)).toBe(
      'profile.ecosystem.areaLine(profile.ecosystem.areaRights.read|profile.ecosystem.areaName.organisms|profile.ecosystem.areaAll)');
    expect(areaSentence(request.requested_data_areas[1], tr)).toBe(
      'profile.ecosystem.areaLine(profile.ecosystem.areaRights.readWrite|profile.ecosystem.areaName.memory|profile.ecosystem.areaPattern(support.*))');
    expect(areaSentence({ area: 'tickets', pattern: '*', rights: ['write'] }, tr)).toContain('profile.ecosystem.areaName.other(tickets)');
  });
});
