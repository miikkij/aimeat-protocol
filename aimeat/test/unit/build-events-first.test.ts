/**
 * @file test/unit/build-events-first.test.ts
 * @description Both build specifications tell an app builder that data on the node reaches the
 *   screen through an event and that a timer is the last resort (services/build-events-first.ts).
 *   Three things are held here. The rule is in each specification, so neither can lose it in an
 *   edit. The list of change domains a builder is given names the same permission for each domain
 *   as the table the event stream enforces (auth/sse-domain-scopes.ts), so the text cannot promise
 *   a domain the node will not deliver. And the Classic section that moved out of
 *   build-app-prompt.ts kept every sentence it had.
 * @usage cd aimeat && pnpm vitest run test/unit/build-events-first.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial.
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import { buildAtelierPrompt } from '../../src/services/build-atelier-prompt.js';
import { buildAppPrompt } from '../../src/services/build-app-prompt.js';
import { buildAppPiece } from '../../src/services/build-app-layers.js';
import { EVENTS_FIRST_DOMAINS, classicLiveUpdatesSection } from '../../src/services/build-events-first.js';
import { DOMAIN_SCOPE } from '../../src/auth/sse-domain-scopes.js';

const config = { baseUrl: 'https://node.example', nodeId: 'node-test' } as unknown as AimeatConfig;
const atelier = buildAtelierPrompt(config, { mode: 'new', lang: 'en' }).full;
const classic = buildAppPrompt(config, { mode: 'new', lang: 'en' }).full;

describe('events first, a timer last', () => {
  it('is in the Atelier specification, after the live declaration and inside the mosaic section', () => {
    const live = atelier.indexOf('LIVE BY DECLARATION');
    const rule = atelier.indexOf('EVENTS FIRST, A TIMER LAST');
    const next = atelier.indexOf('The layout\'s `nav` field');
    expect(live).toBeGreaterThan(-1);
    expect(rule).toBeGreaterThan(live);
    expect(next).toBeGreaterThan(rule);
    expect(atelier).toContain("live: { jobs: { domains: ['agent-tasks'] } }");
  });

  it('is in the Classic specification, and the sentence that told a builder to use a timer is gone', () => {
    expect(classic).toContain('**Events first, a timer last.**');
    expect(classic).not.toContain('observe shared AIMEAT.data keys on a timer');
    expect(classic).toContain('follow shared AIMEAT.data keys with `AIMEAT.live`');
  });

  it('is served in the Classic part a builder is told to read before writing a timer', () => {
    const piece = buildAppPiece(classic, 'live-updates', config.baseUrl);
    expect(piece).not.toBeNull();
    expect(piece!.text).toContain('**Events first, a timer last.**');
  });

  it('names for each domain the permission the event stream asks for', () => {
    const pairs: Array<[string, string]> = [];
    // "`workflows` and `scheduler` (workflow:read)" gives two domains one permission.
    for (const m of EVENTS_FIRST_DOMAINS.matchAll(/((?:`[a-z-]+`(?: and )?)+) \(([a-z]+:[a-z]+)\)/g)) {
      for (const d of m[1].matchAll(/`([a-z-]+)`/g)) pairs.push([d[1], m[2]]);
    }
    expect(pairs.length).toBe(12);
    for (const [domain, scope] of pairs) expect(DOMAIN_SCOPE[domain], domain).toBe(scope);
  });

  it('kept the firehose text of the section that moved', () => {
    const section = classicLiveUpdatesSection();
    expect(section.startsWith('### Live updates without a firehose (aimeat-live.js)\n')).toBe(true);
    expect(section).toContain('AIMEAT.live.subscribe(["memory"], reload, { keyPrefix: "crews.", ownerScope: true });');
    expect(section).toContain('AIMEAT.live.subscribe(["memory"], reload, { minIntervalMs: 10000 });   // or just rate-limit');
    expect(section).toContain('**Never let a live event repaint a surface the user is currently reading.**');
    expect(section.endsWith('instead of clearing then filling.\n\n')).toBe(true);
  });
});
