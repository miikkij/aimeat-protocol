/**
 * @file test/unit/primary-node-pages.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rules behind TARGET-094. A node that names a main node (seo.primary_node_url) hands
 *   it the general pages: their canonical address is the main node's, and they leave this node's
 *   sitemap; the node's front page, applications and members stay its own. A data package version is
 *   a copy only when its one source is another package on this node; the public dataset page says
 *   who published how many rows, and has no markdown link when no `.md` address serves it.
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial (TARGET-094).
 */
import { describe, it, expect } from 'vitest';
import { canonicalPageUrl, findPublicPage, indexedPages, primaryNodeOf, sitemapPages } from '../../src/data/public-pages.js';
import { injectPageHead } from '../../src/utils/page-head.js';
import { injectPageBody } from '../../src/utils/page-body.js';
import { copySourceOf } from '../../src/services/datapackage/copy-origin.js';
import { factsOf } from '../../src/services/datapackage/landing-page.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Descriptor } from '../../src/services/datapackage/contract.js';

const STORE = { baseUrl: 'https://store.example', seoPrimaryNodeUrl: 'https://main.example' };
const ALONE = { baseUrl: 'https://store.example', seoPrimaryNodeUrl: '' };
const page = (path: string) => findPublicPage(path)!;

describe('primaryNodeOf', () => {
  it('names the main node, without a trailing slash', () => {
    expect(primaryNodeOf({ ...STORE, seoPrimaryNodeUrl: 'https://main.example/' })).toBe('https://main.example');
  });
  it('is null when empty, malformed, or this node itself', () => {
    expect(primaryNodeOf(ALONE)).toBeNull();
    expect(primaryNodeOf({ ...STORE, seoPrimaryNodeUrl: 'main.example' })).toBeNull();
    expect(primaryNodeOf({ ...STORE, seoPrimaryNodeUrl: 'https://main.example/v1/portal' })).toBeNull();
    expect(primaryNodeOf({ ...STORE, seoPrimaryNodeUrl: 'https://STORE.example/' })).toBeNull();
  });
});

describe('canonicalPageUrl and indexedPages', () => {
  it('hands a general page to the main node', () => {
    expect(canonicalPageUrl(page('/v1/how-an-app-builds'), STORE)).toBe('https://main.example/v1/how-an-app-builds');
    expect(canonicalPageUrl(page('/v1/terms'), STORE)).toBe('https://main.example/v1/terms');
  });
  it('keeps the front page, the applications and the members on this node', () => {
    for (const path of ['/', '/v1/app-store', '/v1/members']) {
      expect(canonicalPageUrl(page(path), STORE)).toBe(`https://store.example${path}`);
    }
  });
  it('is this node\'s own address with no main node, and a page\'s own canonical wins', () => {
    expect(canonicalPageUrl(page('/v1/glossary'), ALONE)).toBe('https://store.example/v1/glossary');
    expect(canonicalPageUrl({ path: '/v1/dataset/bob/copy', canonical: 'https://store.example/v1/dataset/alice/orig' }, STORE))
      .toBe('https://store.example/v1/dataset/alice/orig');
  });
  it('lists only the node\'s own pages in the sitemap when a main node is named', () => {
    expect(indexedPages(STORE).map((p) => p.path).sort()).toEqual(['/', '/v1/app-store', '/v1/members']);
    expect(indexedPages(ALONE)).toHaveLength(sitemapPages().length);
  });
});

describe('injectPageHead', () => {
  const shell = '<html><head><title>x</title></head><body><div id="app"></div></body></html>';
  it('writes the main node\'s address as canonical and og:url for a general page', () => {
    const out = injectPageHead(shell, page('/v1/glossary'), STORE as unknown as AimeatConfig);
    expect(out).toContain('<link rel="canonical" href="https://main.example/v1/glossary">');
    expect(out).toContain('<meta property="og:url" content="https://main.example/v1/glossary">');
  });
  it('writes this node\'s own address for its own page', () => {
    const out = injectPageHead(shell, page('/v1/app-store'), STORE as unknown as AimeatConfig);
    expect(out).toContain('<link rel="canonical" href="https://store.example/v1/app-store">');
  });
});

describe('copySourceOf', () => {
  const NODE = 'node-1';
  const addr = (ghii: string, name = 'orig') => `https://n.example/v1/pub/${encodeURIComponent(ghii)}/datapkg/${name}/${'a'.repeat(64)}/datapackage.json`;
  const d = (sources: unknown[]) => ({ aimeat: { sources } }) as unknown as Pick<Descriptor, 'aimeat'>;
  it('names the one package source on this node', () => {
    expect(copySourceOf(d([{ kind: 'datapackage', address: addr('alice@node-1') }]), NODE))
      .toEqual({ owner: 'alice', name: 'orig', contentHash: `sha256:${'a'.repeat(64)}` });
  });
  it('is null for two sources, another kind, another node or an agent', () => {
    const one = { kind: 'datapackage', address: addr('alice@node-1') };
    expect(copySourceOf(d([one, one]), NODE)).toBeNull();
    expect(copySourceOf(d([{ kind: 'memory', address: addr('alice@node-1') }]), NODE)).toBeNull();
    expect(copySourceOf(d([{ kind: 'datapackage', address: addr('alice@node-2') }]), NODE)).toBeNull();
    expect(copySourceOf(d([{ kind: 'datapackage', address: addr('bot#alice@node-1') }]), NODE)).toBeNull();
    expect(copySourceOf(d([]), NODE)).toBeNull();
  });
});

describe('the public dataset page', () => {
  const desc = {
    resources: [{ name: 'measurements', rowCount: 5, schema: { fields: [{ name: 'domain' }, { name: 'score' }] } }],
    licenses: [{ name: 'CC-BY-4.0', title: 'Creative Commons Attribution 4.0' }],
  } as unknown as Pick<Descriptor, 'resources' | 'licenses'>;
  it('says who published how many rows and when', () => {
    const f = factsOf(desc, 'carol', '2026-08-17T12:39:39.222Z');
    expect(f.sentence).toBe('Published by carol, last updated on 2026-08-17: 1 table, 5 rows.');
    expect(f.tables).toBe('- measurements: 5 rows, columns domain, score.');
    expect(f.licence).toBe('Licence: Creative Commons Attribution 4.0.');
  });
  it('puts a crawler body in the shell with no markdown link', () => {
    const shell = '<html><head></head><body><div id="app"></div></body></html>';
    const out = injectPageBody(shell, { path: '/v1/dataset/carol/c', title: 'C', description: 'd', changefreq: 'weekly', priority: '0.5', crawlerBody: 'Published by carol.' },
      { baseUrl: 'https://n.example', nodeId: 'n' } as AimeatConfig, { isShell: true });
    expect(out).toContain('<p>Published by carol.</p>');
    expect(out).not.toContain('This page as markdown');
  });
});
