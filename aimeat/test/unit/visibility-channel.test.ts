/**
 * @file test/unit/visibility-channel.test.ts
 * @description The channel a page load is counted under (services/visibility/channel.ts), the
 *   attribution a checkout carries (services/visibility/attribution.ts) and the day merge with its
 *   path cap (services/visibility/visibility-counter.ts mergeDay).
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial, for AI visibility (layer A).
 */
import { describe, it, expect } from 'vitest';
import { classifyChannel, aiFamilyOfHost } from '../../src/services/visibility/channel.js';
import { pageAttribution, agentAttribution, ucpAgentFamily } from '../../src/services/visibility/attribution.js';
import { mergeDay } from '../../src/services/visibility/visibility-counter.js';
import { emptyVisibilityDay, MAX_PATHS_PER_DAY } from '../../src/models/visibility-schemas.js';
import { optedOut } from '../../src/utils/visit-signals.js';

describe('classifyChannel', () => {
  it('names the AI from its answer host', () => {
    expect(classifyChannel({ referer: 'https://chatgpt.com/' })).toEqual({ channel: 'ai', family: 'chatgpt' });
    expect(classifyChannel({ referer: 'https://www.perplexity.ai/search/x' })).toEqual({ channel: 'ai', family: 'perplexity' });
    expect(classifyChannel({ referer: 'https://copilot.microsoft.com/chats/1' })).toEqual({ channel: 'ai', family: 'copilot' });
    expect(classifyChannel({ referer: 'https://gemini.google.com/app' })).toEqual({ channel: 'ai', family: 'gemini' });
    expect(classifyChannel({ referer: 'https://claude.ai/chat/1' })).toEqual({ channel: 'ai', family: 'claude' });
  });

  it('takes utm_source over the Referer, by name or by host', () => {
    expect(classifyChannel({ utmSource: 'chatgpt.com', referer: 'https://www.google.com/' })).toEqual({ channel: 'ai', family: 'chatgpt' });
    expect(classifyChannel({ utmSource: 'Perplexity' })).toEqual({ channel: 'ai', family: 'perplexity' });
    expect(classifyChannel({ utmSource: 'facebook' }).channel).toBe('social');
    expect(classifyChannel({ utmSource: 'newsletter' }).channel).toBe('referral');
  });

  it('keeps gemini an AI although google is a search engine', () => {
    expect(classifyChannel({ referer: 'https://www.google.fi/search?q=a' }).channel).toBe('search');
    expect(classifyChannel({ referer: 'https://gemini.google.com/' }).family).toBe('gemini');
  });

  it('reads social, referral, direct and internal', () => {
    expect(classifyChannel({ referer: 'https://t.co/abc' }).channel).toBe('social');
    expect(classifyChannel({ referer: 'https://www.linkedin.com/feed' }).channel).toBe('social');
    expect(classifyChannel({ referer: 'https://example.org/' }).channel).toBe('referral');
    expect(classifyChannel({}).channel).toBe('direct');
    expect(classifyChannel({ referer: 'not a url' }).channel).toBe('direct');
    expect(classifyChannel({ referer: 'javascript:alert(1)' }).channel).toBe('direct');
    expect(classifyChannel({ referer: 'https://shop.apps.aimeat.io/', selfHosts: ['aimeat.io'] }).channel).toBe('internal');
  });

  it('does not take a lookalike host for an AI', () => {
    expect(aiFamilyOfHost('notchatgpt.com')).toBeNull();
    expect(aiFamilyOfHost('chatgpt.com.evil.example')).toBeNull();
  });
});

describe('attribution', () => {
  it('gives nothing to a buyer who opted out', () => {
    expect(pageAttribution({ referrer: 'https://chatgpt.com/', optedOut: true })).toBeUndefined();
    expect(pageAttribution({ referrer: 'https://chatgpt.com/' })).toEqual({ channel: 'ai', family: 'chatgpt', via: 'page' });
  });

  it('names the agent platform from UCP-Agent, then the User-Agent', () => {
    expect(ucpAgentFamily('profile="https://copilot.microsoft.com/.well-known/ucp"')).toBe('copilot');
    expect(ucpAgentFamily('https://agents.openai.com/ucp')).toBe('chatgpt');
    expect(ucpAgentFamily('profile="https://shop-agent.example/ucp"')).toBe('other');
    expect(ucpAgentFamily(undefined)).toBeNull();
    expect(agentAttribution({ userAgent: 'x; Claude-User/1.0' })).toEqual({ channel: 'ai', family: 'claude', via: 'agent' });
    expect(agentAttribution({})).toEqual({ channel: 'ai', family: 'other', via: 'agent' });
  });
});

describe('optedOut', () => {
  it('reads Sec-GPC and DNT', () => {
    const h = (o: Record<string, string>) => (n: string) => o[n];
    expect(optedOut(h({ 'sec-gpc': '1' }))).toBe(true);
    expect(optedOut(h({ dnt: '1' }))).toBe(true);
    expect(optedOut(h({ dnt: '0' }))).toBe(false);
    expect(optedOut(h({}))).toBe(false);
  });
});

describe('mergeDay', () => {
  it('adds every count and stops the path table at the cap', () => {
    const into = emptyVisibilityDay();
    for (let i = 0; i < MAX_PATHS_PER_DAY + 3; i++) {
      const d = emptyVisibilityDay();
      d.total = 1;
      d.paths[`app${i}.html`] = { h: 1, a: { chatgpt: 1 }, c: {} };
      mergeDay(into, d);
    }
    expect(into.total).toBe(MAX_PATHS_PER_DAY + 3);
    expect(Object.keys(into.paths)).toHaveLength(MAX_PATHS_PER_DAY);
    expect(into.pathsOther).toBe(3 * 2);
    // A path already in the table keeps counting past the cap.
    const again = emptyVisibilityDay();
    again.paths['app0.html'] = { h: 2, a: {}, c: { claude: 1 } };
    mergeDay(into, again);
    expect(into.paths['app0.html']).toEqual({ h: 3, a: { chatgpt: 1 }, c: { claude: 1 } });
  });

  it('never writes a prototype key', () => {
    const into = emptyVisibilityDay();
    const d = emptyVisibilityDay();
    (d.purchases as Record<string, unknown>)['__proto__'] = { n: 1, amounts: {} };
    d.classes = JSON.parse('{"__proto__": 5, "human": 1}');
    mergeDay(into, d);
    expect(({} as Record<string, unknown>).n).toBeUndefined();
    expect(into.classes.human).toBe(1);
  });
});
