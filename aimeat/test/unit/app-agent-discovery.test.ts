/**
 * @file test/unit/app-agent-discovery.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shape of the agent-discovery block on an app page (TARGET-092): one statement that
 *   gives no instruction, links to ?format=md, webmcp, skills and /.well-known/mcp.json, at most 30
 *   words, no "FOR AN AGENT READING THIS PAGE" heading. The two `<link>` tags, the WebMCP bridge and
 *   #aimeat-app-ref stay as they were.
 * @version-history
 *   v1.0.0 — 2026-11-06 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { agentDiscoverySnippet, appRefSnippet, type AppDiscoverySpec } from '../../src/utils/app-agent-discovery.js';

const SPEC: AppDiscoverySpec = {
  owner: 'alice', filename: 'paper-plane.html', appName: 'Paper Plane Lab',
  description: 'Measures how far a paper plane flies and keeps every throw.',
  baseUrl: 'https://node.example/', toolNames: ['throw', 'measure', 'compare'], webmcp: true,
};

const block = (spec: AppDiscoverySpec = SPEC): string =>
  /<noscript id="aimeat-agent-discovery">([\s\S]*?)<\/noscript>/.exec(agentDiscoverySnippet(spec))?.[1] ?? '';
const text = (html: string): string => html.replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const words = (t: string): number => (t.match(/\S+/g) ?? []).length;

describe('agentDiscoverySnippet: the noscript block', () => {
  it('is one sentence of at most 30 words, with no heading', () => {
    const t = text(block());
    expect(words(t)).toBeLessThanOrEqual(30);
    expect(t.trim().split(/(?<=\.)\s+/).length).toBe(1);
    expect(t).not.toMatch(/FOR AN AGENT|READING THIS PAGE/i);
  });

  it('stays at 30 words or fewer whatever the length of the app name', () => {
    expect(words(text(block({ ...SPEC, appName: 'The Very Long Name Of A Seasonal Price Tracker For Electricity' })))).toBeLessThanOrEqual(30);
    const huge = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    expect(words(text(block({ ...SPEC, appName: huge })))).toBe(30);
  });

  it('gives no instruction and addresses nobody', () => {
    const t = text(block());
    expect(t).not.toMatch(/\b(you|your|read|call|use|fetch|must|should|please|ignore|agent)\b/i);
  });

  it('links the four machine-readable descriptions', () => {
    const hrefs = [...block().matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([
      '?format=md',
      'https://node.example/v1/apps/alice/paper-plane.html/webmcp',
      'https://node.example/v1/apps/alice/paper-plane.html/skills',
      '/.well-known/mcp.json',
    ]);
  });

  it('names the app, escaped', () => {
    expect(block({ ...SPEC, appName: 'A & <B>' })).toContain('A &amp; &lt;B&gt; is an app on AIMEAT');
    expect(block({ ...SPEC, appName: null })).toContain('paper-plane.html is an app on AIMEAT');
  });

  it('keeps the two links, the WebMCP bridge and the identity block as they were', () => {
    const out = agentDiscoverySnippet(SPEC);
    expect(out.startsWith('<link rel="mcp-server" href="/.well-known/mcp.json">'
      + '<link rel="alternate" type="text/markdown" href="?format=md" title="Agent-facing description">')).toBe(true);
    expect(out.endsWith('<script src="/v1/libs/aimeat-webmcp.js?expose=app" data-owner="alice" data-app="paper-plane.html" defer></script>')).toBe(true);
    expect(appRefSnippet(SPEC)).toBe('<script type="application/json" id="aimeat-app-ref">'
      + '{"owner":"alice","app_id":"paper-plane.html","app":"alice/paper-plane.html","tools":["throw","measure","compare"]}</script>');
  });
});
