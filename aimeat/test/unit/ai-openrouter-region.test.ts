/**
 * @file test/unit/ai-openrouter-region.test.ts
 * @description Where an OpenRouter call is processed (services/ai/openrouter-region.ts), apart from any
 *   node: whose word decides the region on the node's key and on a person's own key, what the operator
 *   can forbid, the order regions are tried in, the records of processing per region
 *   (compliance-derived.ts) and the privacy page's paragraph (privacy-ai-region.ts). The calls
 *   themselves, and where they arrive, are test/e2e-ai-openrouter-region.ts.
 * @usage pnpm test -- ai-openrouter-region
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (Jouni, 2026-10-31).
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import {
  regionChoiceFor, decideRegion, regionsInUse, allowedRegions, resetRegionModelsForTests,
} from '../../src/services/ai/openrouter-region.js';
import { derivedProcessors } from '../../src/services/compliance-derived.js';
import { aiRegionNotice } from '../../src/services/privacy-ai-region.js';
import { isOpenRouterApiUrl } from '../../src/services/ai/types.js';

const cfg = (over: Record<string, unknown> = {}): AimeatConfig => ({
  securityProfile: 'local', openrouterInstanceKey: 'sk-node', aiProviders: '', aiBuiltinProviders: '', aiProviderEgress: '',
  aiProviderTypes: '', aiFixedBaseUrlOverrides: '', aiProviderAllowlist: [], modelDefaultImage: '', modelDefaultStt: '',
  aiOpenrouterRegion: 'eu', aiOpenrouterRegionFallback: 'us', aiOpenrouterRegions: 'eu,us,any', aiOpenrouterRegionPersonChoice: true,
  ...over,
} as unknown as AimeatConfig);

const none = { openrouterRegion: null, openrouterRegionFallback: null } as const;

afterEach(() => resetRegionModelsForTests());

describe('whose word decides the region', () => {
  it('on the node\'s key: the node\'s region until the person chooses, then theirs', () => {
    expect(regionChoiceFor(cfg(), none, 'node')).toMatchObject({ region: 'eu', fallback: 'us', source: 'node' });
    expect(regionChoiceFor(cfg(), { openrouterRegion: 'us', openrouterRegionFallback: 'off' }, 'node'))
      .toMatchObject({ region: 'us', fallback: 'off', source: 'person' });
  });

  it('the operator can take the choice away: the person\'s rule is then not read', () => {
    const c = regionChoiceFor(cfg({ aiOpenrouterRegionPersonChoice: false }), { openrouterRegion: 'any', openrouterRegionFallback: 'any' }, 'node');
    expect(c).toMatchObject({ region: 'eu', fallback: 'us', source: 'node' });
  });

  it('a region the operator left out is never used, as a choice or as the node\'s own', () => {
    const config = cfg({ aiOpenrouterRegions: 'eu,us', aiOpenrouterRegion: 'any' });
    expect(allowedRegions(config)).toEqual(['eu', 'us']);
    expect(regionChoiceFor(config, none, 'node').region).toBe('eu');
    expect(regionChoiceFor(config, { openrouterRegion: 'any', openrouterRegionFallback: null }, 'node').region).toBe('eu');
  });

  it('on the person\'s own key: their rule, and with none, any, the address their key always used', () => {
    expect(regionChoiceFor(cfg(), none, 'own').region).toBe('any');
    expect(regionChoiceFor(cfg({ aiOpenrouterRegionPersonChoice: false }), { openrouterRegion: 'eu', openrouterRegionFallback: null }, 'own').region).toBe('eu');
  });
});

describe('the order regions are tried in', () => {
  it('a fallback the operator forbids is not tried: any is never reached when it is not allowed', async () => {
    // The regions point at a closed local port, so their lists cannot be read: a region with no list
    // lets the call go and decides itself, and the first allowed region is where the call goes.
    const config = cfg({
      aiOpenrouterRegions: 'eu,us',
      aiFixedBaseUrlOverrides: JSON.stringify({ 'openrouter-eu': 'http://127.0.0.1:9/eu', 'openrouter-us': 'http://127.0.0.1:9/us' }),
    });
    const d = await decideRegion(config, regionChoiceFor(config, { openrouterRegion: null, openrouterRegionFallback: 'any' }, 'node'), 'x/y');
    expect(d.ok && d.region).toBe('eu');
  });

  it('any takes every model without reading a list', async () => {
    const d = await decideRegion(cfg(), regionChoiceFor(cfg(), { openrouterRegion: 'any', openrouterRegionFallback: null }, 'node'), 'openrouter:x/y');
    expect(d).toMatchObject({ ok: true, region: 'any', wanted: 'any' });
  });
});

describe('the records of processing name one processor per region the node\'s key can reach', () => {
  it('people may choose: every allowed region, eu and us with their country, any with the id it always had', () => {
    const ids = derivedProcessors(cfg()).filter(p => p.service === 'ai').map(p => [p.id, p.country ?? null]);
    expect(ids).toEqual([
      ['ai-node-openrouter-eu', 'EU/EEA, United Kingdom or Switzerland'],
      ['ai-node-openrouter-us', 'United States'],
      ['ai-node-openrouter', null],
    ]);
  });

  it('the operator decides alone: the node\'s region and its fallback only', () => {
    expect(regionsInUse(cfg({ aiOpenrouterRegionPersonChoice: false }))).toEqual(['eu', 'us']);
    expect(regionsInUse(cfg({ aiOpenrouterRegionPersonChoice: false, aiOpenrouterRegionFallback: 'off' }))).toEqual(['eu']);
  });
});

describe('the privacy page\'s paragraph', () => {
  it('says nothing on a node without its own OpenRouter key', () => {
    expect(aiRegionNotice(cfg({ openrouterInstanceKey: '' }), 'en')).toBe('');
  });

  it('follows the settings: the region, what happens to a model it lacks, and who chooses', () => {
    const off = aiRegionNotice(cfg({ aiOpenrouterRegionFallback: 'off', aiOpenrouterRegionPersonChoice: false }), 'en');
    expect(off).toContain('processed at eu.openrouter.ai');
    expect(off).toContain('is refused');
    expect(off).toContain('The operator chooses this for everyone');
    const us = aiRegionNotice(cfg({ aiOpenrouterRegion: 'us', aiOpenrouterRegionFallback: 'any' }), 'fi');
    expect(us).toContain('osoitteessa us.openrouter.ai');
    expect(us).toContain('osoitteeseen openrouter.ai, ja se voi päätyä mihin tahansa maahan');
    expect(us).toContain('eu.openrouter.ai, us.openrouter.ai tai openrouter.ai');
  });
});

describe('OpenRouter\'s own hosts', () => {
  it('the global and the two in-region hosts over https, and nothing that only resembles them', () => {
    for (const u of ['https://openrouter.ai/api/v1', 'https://eu.openrouter.ai/api/v1', 'https://us.openrouter.ai/api/v1']) expect(isOpenRouterApiUrl(u), u).toBe(true);
    for (const u of ['http://eu.openrouter.ai/api/v1', 'https://evil.eu.openrouter.ai.example/api/v1', 'https://xopenrouter.ai/api/v1', 'not a url']) expect(isOpenRouterApiUrl(u), u).toBe(false);
  });
});
