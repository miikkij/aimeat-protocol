/**
 * @file test/unit/ai-openrouter-region.test.ts
 * @description Where an OpenRouter call is processed (services/ai/openrouter-region.ts), apart from any
 *   node: whose word decides the region on the node's key and on a person's own key, what the operator
 *   can forbid, the order regions are tried in, the records of processing per region
 *   (compliance-derived.ts) and the privacy page's paragraph (privacy-ai-region.ts). The calls
 *   themselves, and where they arrive, are test/e2e-ai-openrouter-region.ts.
 * @usage pnpm test -- ai-openrouter-region
 * @version-history
 *   v1.2.0 — 2026-11-01 — The default model named in the privacy paragraph, the records and the statement.
 *   v1.1.0 — 2026-11-01 — The buyer's AI region choice (ai.region_mode): the settings each mode sets,
 *     a call with tools passed over an endpoint without tool calling, the eu-only model and free
 *     model, the transfer basis per region, the own-key record, the privacy paragraph and the
 *     transparency statement (Jouni, 2026-11-01).
 *   v1.0.0 — 2026-10-31 — Initial (Jouni, 2026-10-31).
 */
import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AimeatConfig } from '../../src/config.js';
import {
  regionChoiceFor, decideRegion, regionsInUse, allowedRegions, resetRegionModelsForTests,
  regionModeOf, regionSettingsOf, euOnlyModelFor, EU_ONLY_TEXT_MODEL, freeModelOf, freeLastResortOf, regionDeclaration, nodeTextModel,
} from '../../src/services/ai/openrouter-region.js';
import { derivedProcessors } from '../../src/services/compliance-derived.js';
import { nodeOpenRouterKey } from '../../src/services/ai/node-openrouter-key.js';
import { nodeAiProviders, NODE_OPENROUTER_ID } from '../../src/services/ai/providers.js';
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

describe('the buyer\'s AI region choice (ai.region_mode; Jouni, 2026-11-01)', () => {
  // The EU list as OpenRouter writes it: one model with tool calling, one listed without it (as
  // openai/gpt-oss-120b was on 2026-11-01), the EU-only stand-in, and one entry that names nothing.
  const EU_LIST = { data: [
    { id: 'mistralai/mistral-small-2603', supported_parameters: ['tools', 'temperature'] },
    { id: 'openai/gpt-oss-120b', supported_parameters: ['temperature'] },
    { id: 'x/quiet' },
  ] };
  let server: Server;
  let base = '';
  // The list server is on loopback, which safeFetch reaches only with private egress allowed.
  const savedEgress = process.env.AIMEAT_ALLOW_PRIVATE_EGRESS;
  beforeAll(async () => {
    process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = 'true';
    server = createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(req.url?.startsWith('/eu/') ? EU_LIST : { data: [{ id: 'openai/gpt-oss-120b', supported_parameters: ['tools'] }] }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => {
    if (savedEgress === undefined) delete process.env.AIMEAT_ALLOW_PRIVATE_EGRESS; else process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = savedEgress;
    server.close(() => r());
  }));
  const listed = (over: Record<string, unknown> = {}) => cfg({
    aiFixedBaseUrlOverrides: JSON.stringify({ 'openrouter-eu': `${base}/eu`, 'openrouter-us': `${base}/us` }), ...over,
  });

  it('no mode: the four settings decide, as before', () => {
    expect(regionSettingsOf(cfg())).toEqual({ region: 'eu', fallback: 'us', regions: 'eu,us,any', personChoice: true });
    expect(regionModeOf(cfg({ aiRegionMode: 'nonsense' }))).toBe('');
  });

  it('each mode sets the four settings, whatever they hold', () => {
    const stored = { aiOpenrouterRegion: 'any', aiOpenrouterRegionFallback: 'off', aiOpenrouterRegions: 'any' };
    expect(regionSettingsOf(cfg({ ...stored, aiRegionMode: 'eu' }))).toMatchObject({ region: 'eu', fallback: 'any', regions: 'eu,us,any' });
    expect(regionSettingsOf(cfg({ ...stored, aiRegionMode: 'eu-only' }))).toEqual({ region: 'eu', fallback: 'off', regions: 'eu', personChoice: false });
    expect(regionSettingsOf(cfg({ ...stored, aiRegionMode: 'own' }))).toMatchObject({ region: 'any', personChoice: true });
    // eu-only: no person can move the node's key out of the EU.
    expect(regionChoiceFor(cfg({ aiRegionMode: 'eu-only' }), { openrouterRegion: 'us', openrouterRegionFallback: 'any' }, 'node'))
      .toMatchObject({ region: 'eu', fallback: 'off', allowed: ['eu'], source: 'node' });
  });

  it('a call with tools does not go to an endpoint listed without tool calling: eu falls back, eu-only refuses and says why', async () => {
    const eu = listed({ aiRegionMode: 'eu' });
    expect(await decideRegion(eu, regionChoiceFor(eu, none, 'node'), 'openai/gpt-oss-120b', { tools: true }))
      .toMatchObject({ ok: true, region: 'us', wanted: 'eu', fellBack: true });
    // Without tools the EU endpoint takes it; an entry that names no parameters is not counted as lacking them.
    expect(await decideRegion(eu, regionChoiceFor(eu, none, 'node'), 'openai/gpt-oss-120b')).toMatchObject({ ok: true, region: 'eu' });
    expect(await decideRegion(eu, regionChoiceFor(eu, none, 'node'), 'x/quiet', { tools: true })).toMatchObject({ ok: true, region: 'eu' });
    const only = listed({ aiRegionMode: 'eu-only' });
    const refused = await decideRegion(only, regionChoiceFor(only, none, 'node'), 'openai/gpt-oss-120b', { tools: true });
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.message).toMatch(/keeps every AI call in the EU \(EU only\).*without tool calling.*so this is off here/);
    expect(!refused.ok && refused.offered).toEqual(['mistralai/mistral-small-2603', 'x/quiet']);
  });

  it('eu-only: a model the node chose that the EU does not offer becomes the EU model; a named one and other modes keep theirs', async () => {
    const only = listed({ aiRegionMode: 'eu-only' });
    expect(await euOnlyModelFor(only, 'openai/gpt-oss-120b', 'text', { tools: true }, false)).toBe(EU_ONLY_TEXT_MODEL);
    expect(await euOnlyModelFor(only, 'openrouter/free', 'text', {}, false)).toBe(EU_ONLY_TEXT_MODEL);
    expect(await euOnlyModelFor(only, 'openai/gpt-oss-120b', 'text', {}, false)).toBe('openai/gpt-oss-120b');
    expect(await euOnlyModelFor(only, 'openai/gpt-oss-120b', 'text', { tools: true }, true)).toBe('openai/gpt-oss-120b');
    expect(await euOnlyModelFor(only, 'openai/whisper-1', 'transcription', {}, false)).toBe('openai/whisper-1');
    expect(await euOnlyModelFor(listed({ aiRegionMode: 'eu' }), 'openai/gpt-oss-120b', 'text', { tools: true }, false)).toBe('openai/gpt-oss-120b');
  });

  it('eu-only has no free model; the other modes keep the node\'s', () => {
    const c = { modelFreeFallback: 'openrouter/free', aiFreeModelLastResort: true };
    expect([freeModelOf(cfg({ ...c, aiRegionMode: 'eu-only' })), freeLastResortOf(cfg({ ...c, aiRegionMode: 'eu-only' }))]).toEqual(['', false]);
    expect([freeModelOf(cfg({ ...c, aiRegionMode: 'eu' })), freeLastResortOf(cfg({ ...c, aiRegionMode: 'eu' }))]).toEqual(['openrouter/free', true]);
  });

  it('the records of processing: eu-only names the EU alone with its basis; own names each person\'s key', () => {
    const rows = derivedProcessors(cfg({ aiRegionMode: 'eu-only' })).filter(p => p.service === 'ai');
    expect(rows.map(p => [p.id, p.transferBasis])).toEqual([['ai-node-openrouter-eu', 'adequacy']]);
    const eu = derivedProcessors(cfg({ aiRegionMode: 'eu' })).filter(p => p.service === 'ai');
    expect(eu.map(p => [p.id, p.transferBasis])).toEqual([['ai-node-openrouter-eu', 'adequacy'], ['ai-node-openrouter-us', 'scc'], ['ai-node-openrouter', 'scc']]);
    const own = derivedProcessors(cfg({ aiRegionMode: 'own', openrouterInstanceKey: '' })).filter(p => p.service === 'ai');
    expect(own.map(p => [p.id, p.transferBasis])).toEqual([['ai-person-openrouter', 'scc']]);
  });

  it('own: a shared key left in the configuration pays for nothing, and nothing claims one', () => {
    const own = cfg({ aiRegionMode: 'own', openrouterInstanceKey: 'sk-left-behind' });
    expect(nodeOpenRouterKey(own)).toBe('');
    expect(nodeAiProviders(own).some(p => p.id === NODE_OPENROUTER_ID)).toBe(false);
    expect(derivedProcessors(own).filter(p => p.service === 'ai').map(p => p.id)).toEqual(['ai-person-openrouter']);
    expect(regionDeclaration(own)).toMatchObject({ mode: 'own', node_key: false });
    expect(aiRegionNotice(own, 'en')).toContain('has no shared AI key');
    expect(nodeOpenRouterKey(cfg({ aiRegionMode: 'eu', openrouterInstanceKey: ' sk-node ' }))).toBe('sk-node');
  });

  it('the privacy page, the records and the statement name the default model, chat first (Jouni, 2026-11-01 02.54)', () => {
    const flash = 'deepseek/deepseek-v4-flash-0731';
    const eu = cfg({ aiRegionMode: 'eu', modelDefaultChat: '', modelDefaultExecution: flash, modelDefaultReasoning: flash });
    expect(nodeTextModel(eu)).toBe(flash);
    expect(nodeTextModel(cfg({ modelDefaultChat: 'a/chat', modelDefaultExecution: 'b/exec' }))).toBe('a/chat');
    expect(aiRegionNotice(eu, 'fi')).toContain(`käyttävät mallia ${flash}`);
    expect(aiRegionNotice(eu, 'en')).toContain(`use the model ${flash}`);
    expect(regionDeclaration(eu)).toMatchObject({ mode: 'eu', default_model: flash });
    expect(regionDeclaration(cfg({ aiRegionMode: 'eu-only', modelDefaultExecution: flash }))).toMatchObject({ default_model: flash, eu_only_model: EU_ONLY_TEXT_MODEL });
    expect(derivedProcessors(eu).find(p => p.id === 'ai-node-openrouter-eu')?.notes).toContain(flash);
    // A node that names no model says nothing about one.
    expect(aiRegionNotice(cfg({ aiRegionMode: 'eu' }), 'en')).not.toContain('use the model');
  });

  it('the privacy page and the transparency statement follow the choice', () => {
    expect(aiRegionNotice(cfg({ aiRegionMode: 'eu-only' }), 'fi')).toContain('toimii vain EU:ssa');
    expect(aiRegionNotice(cfg({ aiRegionMode: 'eu-only' }), 'en')).toContain('A model that is not offered in that region is refused');
    // The own-key choice speaks though the node holds no key, and says each person brings theirs.
    expect(aiRegionNotice(cfg({ aiRegionMode: 'own', openrouterInstanceKey: '' }), 'en')).toContain('has no shared AI key');
    expect(regionDeclaration(cfg({ aiRegionMode: 'eu-only' }))).toMatchObject({ mode: 'eu-only', node_key: true, region: 'eu', fallback: 'off', regions_in_use: [{ region: 'eu' }] });
    expect(regionDeclaration(cfg({ aiRegionMode: 'own', openrouterInstanceKey: '' }))).toMatchObject({ mode: 'own', node_key: false });
    expect(regionDeclaration(cfg())).toMatchObject({ mode: null });
  });
});

describe('OpenRouter\'s own hosts', () => {
  it('the global and the two in-region hosts over https, and nothing that only resembles them', () => {
    for (const u of ['https://openrouter.ai/api/v1', 'https://eu.openrouter.ai/api/v1', 'https://us.openrouter.ai/api/v1']) expect(isOpenRouterApiUrl(u), u).toBe(true);
    for (const u of ['http://eu.openrouter.ai/api/v1', 'https://evil.eu.openrouter.ai.example/api/v1', 'https://xopenrouter.ai/api/v1', 'not a url']) expect(isOpenRouterApiUrl(u), u).toBe(false);
  });
});
