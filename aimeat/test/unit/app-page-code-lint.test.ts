/**
 * @file test/unit/app-page-code-lint.test.ts
 * @description The publish warnings of services/app/page-code-lint.ts, each a trap the appdev KB
 *   carried as advice (pitfall round 2026-11-21, A8): a comment closed early by an arrow, an offline
 *   app loading parts from another address, a page `L` over Leaflet's, a kit keyframe that ends
 *   hidden under less motion, a root found by position in the body, `.json()` on session.fetch's
 *   envelope, and the hand-rolled pan and zoom pointer code. Each has a case that fires, one that
 *   stays quiet, and an edge, and the full artifact lint carries every one with its curated id.
 *
 *   FIRST FAIL: before the module none of these warnings existed (lintAppArtifact named none).
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 *   v1.0.1 — 2026-11-22 — Whole-name matching for a held keyframe and for the json call on an
 *     awaited session.fetch, after both readers stopped building a pattern from the page's text.
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import {
  commentCloseFindings, offlineOriginFindings, leafletFindings, keyframeHideFindings,
  bodyPositionFindings, sessionFetchFindings,
} from '../../src/services/app/page-code-lint.js';
import { handRolledFindings } from '../../src/services/app/hand-rolled.js';
import { lintAppArtifact } from '../../src/services/app/artifact-lint.js';
import { getAppdevPitfalls } from '../../src/data/appdev-pitfalls.js';

const page = (head: string, body = '') => `<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`;
const KIT = '<script src="/v1/libs/aimeat-atelier.js"></script>';

describe('a comment closed early', () => {
  it('names the stray arrow and the text before it', () => {
    const f = commentCloseFindings(page('<!-- history: draft-->review -->'));
    expect(f).toHaveLength(1);
    expect(f[0].pitfall).toBe('html-comment-closes-early');
    expect(f[0].message).toContain('review');
  });
  it('is quiet for whole comments and for an arrow inside a script', () => {
    expect(commentCloseFindings(page('<!-- a comment -->', '<script>const s = "-->";</script><!-- b -->'))).toEqual([]);
  });
  it('is quiet when a comment is never closed (the browser hides the rest)', () => {
    expect(commentCloseFindings(page('<!-- open'))).toEqual([]);
  });
});

describe('an offline app with parts from another address', () => {
  const OFF = '<meta name="aimeat-offline" content="shell">';
  it('names the hosts of a script, a stylesheet and a font', () => {
    const f = offlineOriginFindings(page(OFF + '<script src="https://cdn.example.com/x.js"></script>'
      + '<link rel="stylesheet" href="//fonts.example.org/a.css"><style>@font-face{src:url(https://f.example.net/a.woff2)}</style>'));
    expect(f[0].pitfall).toBe('offline-parts-other-origin');
    expect(f[0].message).toMatch(/cdn\.example\.com.*fonts\.example\.org.*f\.example\.net/);
  });
  it('is quiet for paths on the node', () => {
    expect(offlineOriginFindings(page(OFF + '<script src="/v1/libs/aimeat-offline.js"></script><link rel="stylesheet" href="/lib/aimeat-theme.css">'))).toEqual([]);
  });
  it('is quiet on an app that does not declare offline, and ignores a link that is not a part', () => {
    expect(offlineOriginFindings(page('<script src="https://cdn.example.com/x.js"></script>'))).toEqual([]);
    expect(offlineOriginFindings(page(OFF + '<link rel="canonical" href="https://example.com/">'))).toEqual([]);
  });
});

describe('Leaflet and a page L', () => {
  const LEAF = '<script src="/lib/leaflet@1/leaflet.js"></script>';
  it('names a declared L and a template-string popup', () => {
    const f = leafletFindings(page(LEAF, '<script>const L = 5; m.bindPopup(`<b>${name}</b>`);</script>'));
    expect(f[0].pitfall).toBe('leaflet-l-shadowed');
    expect(f[0].message).toMatch(/named `L`.*popup/s);
  });
  it('is quiet for L.map and for a page without Leaflet', () => {
    expect(leafletFindings(page(LEAF, '<script>const map = L.map("m");</script>'))).toEqual([]);
    expect(leafletFindings(page('', '<script>const L = 5;</script>'))).toEqual([]);
  });
});

describe('a kit keyframe that ends hidden', () => {
  it('names a keyframe ending at opacity 0 held with forwards', () => {
    const f = keyframeHideFindings(page(KIT + '<style>@keyframes flash{from{opacity:1}to{opacity:0}} .toast{animation:flash 2s ease forwards}</style>'));
    expect(f[0].pitfall).toBe('keyframe-hides-under-less-motion');
    expect(f[0].message).toContain('`flash`');
  });
  it('is quiet for an entrance that ends visible, and for a hidden end that is not held', () => {
    expect(keyframeHideFindings(page(KIT + '<style>@keyframes in{from{opacity:0}to{opacity:1}} .a{animation:in .3s both}</style>'))).toEqual([]);
    expect(keyframeHideFindings(page(KIT + '<style>@keyframes out{to{opacity:0}} .a{animation:out .3s}</style>'))).toEqual([]);
  });
  it('is quiet on a page without the kit, and reads 100% as the end frame', () => {
    expect(keyframeHideFindings(page('<style>@keyframes f{to{opacity:0}} .a{animation:f 1s forwards}</style>'))).toEqual([]);
    expect(keyframeHideFindings(page(KIT + '<style>@keyframes f{0%{opacity:1} 100%{visibility:hidden}} .a{animation-name:f;animation-fill-mode:both}</style>'))).toHaveLength(1);
  });
  it('matches the whole animation name, never a part of a longer one', () => {
    expect(keyframeHideFindings(page(KIT + '<style>@keyframes fade{to{opacity:0}} .a{animation:fade-out 1s forwards}</style>'))).toEqual([]);
    expect(keyframeHideFindings(page(KIT + '<style>@keyframes a.b{to{opacity:0}} .a{animation:a 1s forwards}</style>'))).toEqual([]);
  });
});

describe('a root found by position in the body', () => {
  it('names firstElementChild in code and body > :first-child in CSS', () => {
    expect(bodyPositionFindings(page('', '<script>const root = document.body.firstElementChild;</script>'))[0].pitfall).toBe('body-first-child-is-node-block');
    expect(bodyPositionFindings(page('<style>body > :first-child{margin:0}</style>'))).toHaveLength(1);
  });
  it('is quiet for getElementById', () => {
    expect(bodyPositionFindings(page('', '<script>document.getElementById("app")</script>'))).toEqual([]);
  });
});

describe('.json() on session.fetch', () => {
  it('names a chained and an awaited .json()', () => {
    expect(sessionFetchFindings(page('', '<script>s.fetch("/v1/memory/k").then(r => r.json());</script>'))[0].pitfall).toBe('session-fetch-parsed');
    expect(sessionFetchFindings(page('', '<script>async function f(){ const res = await session.fetch(`/v1/x`); const j = await res.json(); }</script>'))).toHaveLength(1);
  });
  it('is quiet for the browser\'s own fetch and for an envelope read as it is', () => {
    expect(sessionFetchFindings(page('', '<script>window.fetch("/v1/x").then(r => r.json()); fetch("/v1/y").then(r => r.json());</script>'))).toEqual([]);
    expect(sessionFetchFindings(page('', '<script>const res = await session.fetch("/v1/x"); if (res.ok) show(res.data);</script>'))).toEqual([]);
  });
  it('reads the json call on the same name only, a $ in it included', () => {
    expect(sessionFetchFindings(page('', '<script>const $r = await s.fetch("/v1/x"); const j = await $r.json();</script>'))).toHaveLength(1);
    expect(sessionFetchFindings(page('', '<script>const r = await s.fetch("/v1/x"); const j = await xr.json();</script>'))).toEqual([]);
  });
});

describe('hand-rolled pan and zoom', () => {
  it('names setPointerCapture or a wheel zoom with neither aimeat-viewport nor aimeat-input', () => {
    const f = handRolledFindings(page('', '<script>el.setPointerCapture(e.pointerId); el.addEventListener("wheel", zoom);</script>'));
    expect(f[0]?.message).toMatch(/pan and zoom/);
  });
  it('is quiet when the page loads aimeat-viewport or aimeat-input', () => {
    expect(handRolledFindings(page('<script src="/v1/cortex/aimeat-viewport/libs/aimeat-viewport.js"></script>', '<script>el.setPointerCapture(e.pointerId);</script>'))).toEqual([]);
    expect(handRolledFindings(page('<script src="/v1/cortex/aimeat-input/libs/aimeat-input.js"></script>', '<script>el.setPointerCapture(e.pointerId);</script>'))).toEqual([]);
  });
});

describe('the artifact lint carries them with their curated ids', () => {
  const config = { baseUrl: 'https://aimeat.io', port: 40050, appAssetProbe: false } as unknown as AimeatConfig;
  it('names each warning with an entry the registry has, and enforces it there', async () => {
    const html = page('<meta name="aimeat-offline" content="shell"><script src="https://cdn.example.com/x.js"></script><!-- a-->b -->' + KIT
      + '<style>@keyframes f{to{opacity:0}} .a{animation:f 1s forwards}</style>',
      '<script>document.body.firstElementChild; s.fetch("/v1/x").then(r => r.json());</script>');
    const r = await lintAppArtifact(html, config);
    const ids = new Set(getAppdevPitfalls().map(p => p.id));
    for (const id of ['html-comment-closes-early', 'offline-parts-other-origin', 'keyframe-hides-under-less-motion', 'body-first-child-is-node-block', 'session-fetch-parsed']) {
      const hit = r.warnings.find(w => w.pitfall === id);
      expect(hit, id).toBeDefined();
      expect(ids.has(id), id).toBe(true);
    }
  });
});
