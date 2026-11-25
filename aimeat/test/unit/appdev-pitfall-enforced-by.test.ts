/**
 * @file test/unit/appdev-pitfall-enforced-by.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A curated appdev pitfall that a publish check enforces says which check
 *   (`enforcedBy`), every finding a publish check produces names a curated pitfall and the address
 *   that opens it, and the research overview lists an enforced entry apart from the pitfalls a
 *   builder reads before building.
 *
 *   WHY. 21 curated entries described a trap the publish answer already names when it happens. In
 *   the research list they read as one more thing to remember, beside the entries no check can
 *   catch, and the publish finding did not say that it was the same entry. Now the entry names its
 *   check, the overview lists it under `enforced`, and the finding carries the entry's id and url.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (pitfall round B3).
 *   v1.1.0 — 2026-11-26 — ENFORCED names all 28 enforced entries (six were missing), with
 *     key-in-page-source and html-built-from-values, and a fixture for each new one.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AimeatConfig } from '../../src/config.js';
import type { ContentReader } from '../../src/services/classification/reader.js';
import { getAppdevPitfalls } from '../../src/data/appdev-pitfalls.js';
import { lintAppArtifact } from '../../src/services/app/artifact-lint.js';
import { gridTrackFindings, lintAppHtmlForMobile } from '../../src/utils/app-mobile-lint.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { buildAppdevOverview } from '../../src/services/appdev/overview.js';

/** The curated entries a publish check enforces, and the check: `<module>:<function>`. */
const ENFORCED: Record<string, string> = {
  'invented-lib-urls': 'artifact-lint:probeNodeAssets',
  'inline-js-does-not-parse': 'artifact-lint:checkInlineScripts',
  'atelier-kit-not-loaded': 'artifact-lint:lintAppArtifact',
  'atelier-register': 'artifact-lint:checkRegister',
  'cdn-libs-blocked': 'artifact-lint:collectAssetRefs',
  'app-meta-declarations': 'artifact-lint:checkMetas',
  'app-declared-unused': 'artifact-lint:checkDeclaredButUnused',
  'track-mixing': 'artifact-lint:checkTrackMixing',
  'hardcoded-theme-colors': 'artifact-lint:checkTheme',
  'undeclared-scope-words': 'scope-needs:undeclaredScopeFindings',
  'intake-form-undeclared': 'intake-forms:intakeDeclarationOf',
  'below-level': 'build-level:levelFindings',
  'hand-rolled': 'hand-rolled:handRolledFindings',
  'genre-not-forked': 'genre-fork:genreForkFindings',
  'one-language': 'language-default:oneLanguageFindings',
  'track-drift': 'track-drift:trackDriftFindings',
  'provenance-without-model': 'ai-model-hints:provenanceModelFindings',
  'bundled-agent-block': 'bundled-crews:decideBundledCrews',
  'bundled-agent-permissions': 'bundled-crews:crewPermissionFindings',
  'grid-track-blowout': 'app-mobile-lint:gridTrackFindings',
  'display-version-carried': 'version-label:versionLabelFindings',
  'html-comment-closes-early': 'page-code-lint:commentCloseFindings',
  'offline-parts-other-origin': 'page-code-lint:offlineOriginFindings',
  'leaflet-l-shadowed': 'page-code-lint:leafletFindings',
  'keyframe-hides-under-less-motion': 'page-code-lint:keyframeHideFindings',
  'body-first-child-is-node-block': 'page-code-lint:bodyPositionFindings',
  'key-in-page-source': 'generated-code-lint:secretFindings',
  'html-built-from-values': 'generated-code-lint:htmlSinkFindings',
};

/** Entries that stay in the research list: no check covers what they say. */
const STAY_VISIBLE = ['handle-both-auth-paths', 'namespace-rule', 'auth-pill-overflow', 'login-is-silent-only'];

const ROOT = join(import.meta.dirname, '..', '..');
const moduleFile = (m: string): string | undefined =>
  [join(ROOT, 'src', 'services', 'app', `${m}.ts`), join(ROOT, 'src', 'utils', `${m}.ts`)].find(existsSync);

const lintConfig = { baseUrl: 'https://aimeat.io', port: 40050, appAssetProbe: false } as unknown as AimeatConfig;

const APP = (body: string, head = '') => `<!DOCTYPE html><html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="aimeat-app" content="probe.html">
  <meta name="aimeat-scopes" content="memory:read memory:write">
  <meta name="aimeat-locales" content="en fi">
  <link rel="stylesheet" href="https://aimeat.io/lib/aimeat-theme.css">
  ${head}
  </head><body>
  <script src="https://aimeat.io/v1/libs/aimeat-auth.js"></script>
  ${body}</body></html>`;

describe('a curated pitfall a publish check enforces names the check', () => {
  const byId = new Map(getAppdevPitfalls().map(p => [p.id, p]));

  it('carries enforcedBy on every entry a check enforces', () => {
    for (const [id, rule] of Object.entries(ENFORCED)) {
      expect(byId.get(id), id).toBeDefined();
      expect(byId.get(id)?.enforcedBy, id).toBe(rule);
    }
  });

  it('names a check that exists and emits that entry\'s id', () => {
    for (const p of getAppdevPitfalls().filter(e => e.enforcedBy)) {
      const [m, fn] = String(p.enforcedBy).split(':');
      const file = moduleFile(m);
      expect(file, `${p.id}: no module ${m}`).toBeDefined();
      const src = readFileSync(file!, 'utf8');
      expect(new RegExp(`function ${fn}\\b`).test(src), `${p.id}: ${m} declares no function ${fn}`).toBe(true);
      expect(src.includes(`'${p.id}'`), `${p.id}: ${m} never names the id`).toBe(true);
    }
  });

  it('leaves the entries no check covers active and without enforcedBy', () => {
    for (const id of STAY_VISIBLE) {
      const p = byId.get(id);
      expect(p, id).toBeDefined();
      expect(p?.status ?? 'active', id).toBe('active');
      expect(p?.enforcedBy, id).toBeUndefined();
    }
  });
});

describe('a publish finding carries the curated pitfall it enforces', () => {
  const FIXTURES: Record<string, string> = {
    'inline-js-does-not-parse': APP('<script>const a = = 1;</script>'),
    'atelier-kit-not-loaded': APP('<script>AIMEAT.atelier.app({});</script>'),
    'cdn-libs-blocked': APP('<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>'),
    // Put together at run time, so the source holds no whole key (push protection reads it).
    'key-in-page-source': APP(`<script>const KEY = "${'sk-proj-' + '4fQ9xT2LmZ7bW1cV8nR3kJ6h'}";</script>`),
    'html-built-from-values': APP('<script>AIMEAT.data.get("notes").then(n => { document.getElementById("o").innerHTML = `<p>${n.text}</p>`; });</script>'),
    // Its own page: the platform theme the other fixtures load is what silences this check.
    'hardcoded-theme-colors': `<!DOCTYPE html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="aimeat-app" content="x.html"><meta name="aimeat-scopes" content="memory:read"><meta name="aimeat-locales" content="en">
      <style>:root{--bg:#ffffff;--fg:#111111;--card:#f5f5f5;--line:#e0e0e0;--accent:#2266cc}
        @media (prefers-color-scheme: dark){:root{--bg:#111111;--fg:#eeeeee}} body{background:#ffffff}</style>
      </head><body><script>AIMEAT.data.set('k', 1);</script></body></html>`,
  };

  for (const [id, html] of Object.entries(FIXTURES)) {
    it(`names ${id} with the address that opens it`, async () => {
      const r = await lintAppArtifact(html, lintConfig);
      const all = [...r.blocking, ...r.warnings];
      const hit = all.find(f => f.pitfall === id);
      expect(hit, `${id}: ${JSON.stringify(all)}`).toBeDefined();
      expect(hit?.url).toBe(`/v1/appdev/pitfalls/${id}`);
      expect(getAppdevPitfalls().find(p => p.id === id)?.enforcedBy).toBe(ENFORCED[id]);
    });
  }

  it('every finding of those fixtures resolves to a curated entry', async () => {
    const ids = new Set(getAppdevPitfalls().map(p => p.id));
    for (const html of Object.values(FIXTURES)) {
      const r = await lintAppArtifact(html, lintConfig);
      for (const f of [...r.blocking, ...r.warnings]) {
        expect(ids.has(f.pitfall), `${f.pitfall} is not a curated id`).toBe(true);
        expect(f.url).toBe(`/v1/appdev/pitfalls/${f.pitfall}`);
      }
    }
  });
});

describe('the grid-track mobile hint is also a finding with its pitfall', () => {
  const GRID = '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>.g{display:grid;grid-template-columns:250px 1fr}</style></head><body></body></html>';

  it('names grid-track-blowout, as a warning, with its address', () => {
    expect(gridTrackFindings(GRID)).toEqual([{
      pitfall: 'grid-track-blowout', severity: 'warn',
      message: lintAppHtmlForMobile(GRID).find(h => h.includes('grid-track-blowout')),
      url: '/v1/appdev/pitfalls/grid-track-blowout',
    }]);
  });

  it('says nothing about a grid that keeps its tracks with minmax(0,…)', () => {
    expect(gridTrackFindings(GRID.replace('250px 1fr', '250px minmax(0,1fr)'))).toEqual([]);
  });

  it('says nothing about empty or non-string input, and leaves the string hints as they were', () => {
    expect(gridTrackFindings('')).toEqual([]);
    // @ts-expect-error — defensive against non-string callers
    expect(gridTrackFindings(null)).toEqual([]);
    expect(lintAppHtmlForMobile(GRID).some(h => /grid-track-blowout/.test(h))).toBe(true);
  });
});

describe('the research overview lists an enforced entry apart', () => {
  const NODE = 'test-node';
  const ALICE = `alice@${NODE}`;
  const config = { nodeId: NODE, baseUrl: 'http://localhost:40050' } as unknown as AimeatConfig;
  const reader = {
    kind: 'ai', identity: ALICE, principal: ALICE, auth: { sub: 'alice', owner: 'alice', roles: ['owner'] } as never,
    warnings: [], show: async <T>(items: T[]) => items, useForAi: async () => {},
  } as unknown as ContentReader;

  it('leaves it out of the items and names it, its title and its check under enforced', async () => {
    const storage = new SqliteStorage(':memory:');
    const out = await buildAppdevOverview(storage as never, config, reader, { sections: ['pitfalls_curated'] });
    const cur = out.pitfalls_curated as { items: Array<{ id: string }>; total: number; enforced_at_publish: number; enforced: Array<{ id: string; title: string; enforced_by: string }> };
    const shown = new Set(cur.items.map(i => i.id));
    for (const id of Object.keys(ENFORCED)) expect(shown.has(id), id).toBe(false);
    for (const id of STAY_VISIBLE) expect(shown.has(id), id).toBe(true);
    expect(cur.enforced_at_publish).toBe(cur.enforced.length);
    expect(cur.enforced.length).toBeGreaterThanOrEqual(Object.keys(ENFORCED).length);
    const row = cur.enforced.find(e => e.id === 'inline-js-does-not-parse');
    expect(row?.enforced_by).toBe('artifact-lint:checkInlineScripts');
    expect(typeof row?.title).toBe('string');
    // The old overview test reads total >= 20: the visible list keeps that many.
    expect(cur.total).toBeGreaterThanOrEqual(20);
  });

  it('narrowed to an area, lists only that area\'s enforced entries', async () => {
    const storage = new SqliteStorage(':memory:');
    const out = await buildAppdevOverview(storage as never, config, reader, { sections: ['pitfalls_curated'], areas: ['ai'] });
    const cur = out.pitfalls_curated as { enforced: Array<{ id: string }> };
    const byId = new Map(getAppdevPitfalls().map(p => [p.id, p]));
    expect(cur.enforced.length).toBeGreaterThan(0);
    for (const e of cur.enforced) expect(byId.get(e.id)?.appliesTo, e.id).toContain('ai');
  });
});
