/**
 * @file everything.test.ts
 * @description The real feature guide must reach browsers and Markdown readers without losing rows.
 * @structure Content coverage and generated representation parity.
 * @usage pnpm exec vitest run test/unit/everything.test.ts
 * @version-history
 *   v1.0.0 - 2026-09-15 - Coverage and generated page parity regression tests.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { matchingGroups } from '../../public/views/everything.js';
import { findPublicPage } from '../../src/data/public-pages.js';
import { injectPageBody } from '../../src/utils/page-body.js';
import type { AimeatConfig } from '../../src/config.js';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const guide = JSON.parse(read('../../public/data/everything.json'));

vi.mock('/js/i18n.js', () => ({ t: (key: string) => key }));
vi.mock('/js/swallowed.js', () => ({ swallowed: vi.fn() }));

describe('the complete feature guide', () => {
  it('includes the audited capabilities', () => {
    const source = read('../../../docs/AIMEAT-Feature-List.md');
    for (const phrase of ['Open Data Product Specification', 'Frictionless', 'working copy', 'checkpoints', 'Public intake', 'Development rights', 'SKOS', 'Agent v2']) {
      expect(source.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });

  it('serves every feature through Markdown and the initial HTML', () => {
    const page = findPublicPage('/v1/everything')!;
    const body = injectPageBody('<div id="app"></div>', page, { baseUrl: 'https://node.example', nodeId: 'test' } as AimeatConfig, { isShell: true });
    for (const group of guide.groups) {
      expect(body).toContain(`id="${group.slug}"`);
      for (const row of group.rows) {
        expect(row.slug).toBeTruthy();
        expect(body).toContain(`id="${row.slug}"`);
        expect(page.markdown).toContain(`id="${row.slug}"`);
        expect(body).toContain(row.cells[0]);
      }
    }
    const ids = guide.groups.flatMap((g: { rows: { slug: string }[] }) => g.rows.map(r => r.slug));
    expect(new Set(ids).size).toBe(guide.counts.rows);
    expect(body).toContain('<table');
    expect(body).toContain('https://github.com/miikkij/aimeat-protocol/blob/main/openapi.yaml');
  });

  it('finds the requested capabilities, normalizes queries and filters contents', () => {
    for (const query of ['app-tools', 'app tools', 'ODPS', 'Open Data Product Specification', 'standards', 'working copy', 'intake', 'SKOS', 'crew JSON', 'published crew', 'schedule limits', 'workflow checks', 'agent quality', 'workspace sharing', 'structured questions', 'MCP servers', 'MCP OAuth', 'fixed arguments', 'call limits', 'workspace MCP', 'morsels only', 'peer node', 'stdio', 'publish an attached tool', 'MCP usage']) {
      const matches = matchingGroups(guide, query);
      expect(matches.length, query).toBeGreaterThan(0);
      expect(matches.every((g: { rows: unknown[] }) => g.rows.length > 0)).toBe(true);
    }
    expect(matchingGroups(guide, '  APP--TOOLS  ')).toEqual(matchingGroups(guide, 'app tools'));
    const standards = guide.groups.find((g: { title: string }) => g.title.toLowerCase().includes('standards'));
    expect(matchingGroups(guide, 'standards')).toContainEqual(standards);
    expect(matchingGroups(guide, 'nothing-matches-9z9z9')).toEqual([]);
    expect(matchingGroups(guide, '')).toBe(guide.groups);
    expect(matchingGroups(guide, '   ')).toBe(guide.groups);
  });
});
