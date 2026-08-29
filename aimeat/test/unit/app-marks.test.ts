/**
 * @file app-marks.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Unit: the two request shapes of services/app-marks.ts, and what the serve-time
 *   pass does with a named reviewer — the head tags, the visible label re-decided under editorial
 *   responsibility, the two reasons the declaration must NOT reach, and the badge and install
 *   switches. The E2E suite (test/e2e-app-marks.ts) proves the route and the log; this file proves
 *   the bytes, because no provenance record is minted there.
 * @version-history
 *   v1.0.0 — 2026-08-29 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { applyServeMarks } from '../../src/services/app-serve-marks.js';
import { applyAppHeadMeta } from '../../src/utils/app-head-meta.js';
import {
  parseMarksInput, parseAuthorInput, appBadgeOn, appInstallChipOn, appReviewedBy, AUTHOR_NAME_MAX,
} from '../../src/services/app-marks.js';
import { SERVE_MARK_CASES, FIXTURE_CONFIG, provFixture } from './serve-marks-fixtures.js';
import type { AppManifest } from '../../src/storage/types/apps.js';

const DOC = '<!DOCTYPE html><html><head><title>t</title></head><body><p>hi</p></body></html>';
const HEADLESS = '<div>fragment</div><script>var s = "</body>";</script>';
const LABEL = 'id="aimeat-ai-label"';
const BADGE = 'id="aimeat-app-badge"';

describe('request shapes', () => {
  it('marks: booleans by name, anything else refused by name', () => {
    expect(parseMarksInput({ badge: false })).toEqual({ marks: { badge: false } });
    expect(parseMarksInput({ badge: true, install: false })).toEqual({ marks: { badge: true, install: false } });
    expect(parseMarksInput({})).toEqual({ marks: {} });
    expect(parseMarksInput({ sticker: true })).toMatchObject({ error: expect.stringContaining('marks.sticker') });
    expect(parseMarksInput({ badge: 'no' })).toMatchObject({ error: expect.stringContaining('badge') });
    expect(parseMarksInput([])).toMatchObject({ error: expect.any(String) });
    expect(parseMarksInput('badge')).toMatchObject({ error: expect.any(String) });
  });

  it('author: a trimmed single line declares; empty or null withdraws; bounds refuse', () => {
    expect(parseAuthorInput('  Maija Meikäläinen ')).toEqual({ name: 'Maija Meikäläinen' });
    expect(parseAuthorInput(null)).toEqual({ name: null });
    expect(parseAuthorInput('')).toEqual({ name: null });
    expect(parseAuthorInput('   ')).toEqual({ name: null });
    expect(parseAuthorInput('x'.repeat(AUTHOR_NAME_MAX))).toEqual({ name: 'x'.repeat(AUTHOR_NAME_MAX) });
    expect(parseAuthorInput('x'.repeat(AUTHOR_NAME_MAX + 1))).toMatchObject({ error: expect.stringContaining('120') });
    expect(parseAuthorInput('Maija\nMeikäläinen')).toMatchObject({ error: expect.stringContaining('single line') });
    expect(parseAuthorInput('Maija\u0007')).toMatchObject({ error: expect.stringContaining('single line') });
    expect(parseAuthorInput(42)).toMatchObject({ error: expect.any(String) });
  });

  it('a manifest without the fields reads as: badge on, chip on, nobody declared', () => {
    const m = { name: 'x', description: 'y', version: '1', category: 'utility' } as unknown as AppManifest;
    expect(appBadgeOn(m)).toBe(true);
    expect(appInstallChipOn(m)).toBe(true);
    expect(appReviewedBy(m)).toBeUndefined();
    expect(appBadgeOn(undefined)).toBe(true);
    expect(appBadgeOn({ ...m, marks: { badge: false } })).toBe(false);
    expect(appInstallChipOn({ ...m, marks: { badge: false } })).toBe(true);
    expect(appReviewedBy({ ...m, authorship: { name: ' Maija ', declaredBy: 'a@n', declaredAt: 'now' } })).toBe('Maija');
  });
});

describe('the served bytes with a named reviewer', () => {
  const visible = { config: FIXTURE_CONFIG, locale: 'en' as const };

  it('the labelled record shows the chip without a reviewer, and not with one', () => {
    const without = applyServeMarks(DOC, { provenance: provFixture('labelled'), visibleLabel: visible }).toString();
    expect(without).toContain(LABEL);
    const withReviewer = applyServeMarks(DOC, {
      provenance: provFixture('labelled'), visibleLabel: visible, reviewedBy: 'Maija Meikäläinen',
    }).toString();
    expect(withReviewer).not.toContain(LABEL);
    // The machine-readable marks are the record AS MINTED: the attribute, the record link and the
    // JSON-LD are still there, and the JSON-LD still says the label was required at mint time.
    expect(withReviewer).toContain('<link rel="ai-provenance"');
    expect(withReviewer).toContain('application/ld+json');
    expect(withReviewer).toContain('ai-disclosure');
  });

  it('puts the name in the head as two meta tags, attribute-escaped, once', () => {
    const out = applyServeMarks(DOC, { reviewedBy: 'Ann "Q" <Ö> & Co' }).toString();
    const head = out.slice(0, out.indexOf('</head>'));
    expect(head).toContain('<meta name="author" content="Ann &quot;Q&quot; &lt;Ö&gt; &amp; Co">');
    expect(head).toContain('<meta name="aimeat-reviewed-by" content="Ann &quot;Q&quot; &lt;Ö&gt; &amp; Co">');
    // Re-serving the served copy adds nothing.
    const again = applyServeMarks(out, { reviewedBy: 'Ann "Q" <Ö> & Co' }).toString();
    expect(again.split('aimeat-reviewed-by').length).toBe(2);
  });

  it('a head-less fragment gets the tags inside the head the metadata pass opens', () => {
    const out = applyServeMarks(HEADLESS, {
      reviewedBy: 'Maija',
      headMeta: { owner: 'alice', filename: 'demo.html', origin: 'https://demo.apps.aimeat.io', baseUrl: 'https://aimeat.io' },
    }).toString();
    expect(out.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(out.indexOf('aimeat-reviewed-by')).toBeGreaterThan(out.indexOf('<head>'));
    expect(out.indexOf('aimeat-reviewed-by')).toBeLessThan(out.indexOf('<div>fragment</div>'));
  });

  it('a person talking to a model is still told so, whoever reviewed the app (Art. 50(1))', () => {
    const p = provFixture('labelled');
    p.record.disclosure = { ...p.record.disclosure!, reason: 'art50_1_interaction' };
    const out = applyServeMarks(DOC, { provenance: p, visibleLabel: visible, reviewedBy: 'Maija' }).toString();
    expect(out).toContain(LABEL);
  });

  it('a deep fake stays labelled regardless of review (the exemption belongs to the text limb)', () => {
    const p = provFixture('labelled');
    p.record.disclosure = { ...p.record.disclosure!, reason: 'art50_4_deepfake' };
    const out = applyServeMarks(DOC, { provenance: p, visibleLabel: visible, reviewedBy: 'Maija' }).toString();
    expect(out).toContain(LABEL);
  });

  it('a quiet record stays quiet, and the raw form (no visibleLabel) never gets a chip', () => {
    const quiet = applyServeMarks(DOC, { provenance: provFixture('quiet'), visibleLabel: visible, reviewedBy: 'Maija' }).toString();
    expect(quiet).not.toContain(LABEL);
    const raw = applyServeMarks(DOC, { provenance: provFixture('labelled'), reviewedBy: 'Maija' }).toString();
    expect(raw).not.toContain(LABEL);
  });

  it('the goldens are untouched: a spec without the new member produces the same bytes', () => {
    // Belt and braces beside app-serve-marks.test.ts: `reviewedBy: undefined` is the same as absent.
    for (const c of SERVE_MARK_CASES) {
      const a = applyServeMarks(c.html, {
        badge: c.badge, provenance: c.prov ? provFixture(c.prov) : undefined,
        visibleLabel: c.visible ? visible : undefined, discovery: c.discovery, headMeta: c.headMeta,
      });
      const b = applyServeMarks(c.html, {
        badge: c.badge, provenance: c.prov ? provFixture(c.prov) : undefined,
        visibleLabel: c.visible ? visible : undefined, discovery: c.discovery, headMeta: c.headMeta,
        reviewedBy: undefined,
      });
      expect(b.equals(a)).toBe(true);
    }
  });
});

describe('the badge and the install chip switches', () => {
  it('badge: true adds it, badge: false leaves the bytes without it', () => {
    expect(applyServeMarks(DOC, { badge: true }).toString()).toContain(BADGE);
    expect(applyServeMarks(DOC, { badge: false }).toString()).not.toContain(BADGE);
  });

  it('installChip: false leaves the install script out of the head; absent keeps it', () => {
    const spec = { owner: 'alice', filename: 'demo.html', origin: 'https://demo.apps.aimeat.io', baseUrl: 'https://aimeat.io' };
    expect(applyAppHeadMeta(DOC, spec)).toContain('install-chip.js');
    expect(applyAppHeadMeta(DOC, { ...spec, installChip: true })).toContain('install-chip.js');
    expect(applyAppHeadMeta(DOC, { ...spec, installChip: false })).not.toContain('install-chip.js');
  });
});
