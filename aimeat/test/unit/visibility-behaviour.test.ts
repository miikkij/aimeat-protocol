/**
 * @file test/unit/visibility-behaviour.test.ts
 * @description AI visibility, layer D (services/visibility/behaviour-*.ts): a beacon is bounded
 *   before it counts (cells in range, element names in the script's own shape, per-view caps), a
 *   stored day keeps its caps, an opted-out view counts as a view only, findings read as one line
 *   each, the script carries the owner and the app as safe literals, and the fixing agent takes only
 *   a complete HTML file from an AI answer.
 * @usage pnpm test -- visibility-behaviour
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (AI visibility, layer D).
 */
import { describe, it, expect } from 'vitest';
import { beaconDelta, mergeBehaviourDay } from '../../src/services/visibility/behaviour-counter.js';
import { behaviourFindings } from '../../src/services/visibility/behaviour-report.js';
import { behaviourSnippet } from '../../src/services/visibility/behaviour-script.js';
import { extractHtml } from '../../src/services/visibility/behaviour-fixer.js';
import { emptyBehaviourDay, MAX_ELEMENTS_PER_DAY, MAX_HEAT_CELLS_PER_DAY } from '../../src/models/behaviour-schemas.js';

const base = { ownerGhii: 'alice@node-1', app: 'shop.html', optedOut: false };

describe('beaconDelta', () => {
  it('counts a view with its screen, scroll, clicks, dead and rage clicks', () => {
    const d = beaconDelta({ ...base, vc: 'phone', scroll: '50', heat: { phone: { '3,4': 2 } }, dead: { 'phone|button#buy': 3 }, rage: { 'phone|a#more.link': 1 } });
    expect(d).toMatchObject({ views: 1, optedOut: 0, vc: { phone: 1 }, scroll: { 50: 1 }, heat: { phone: { '3,4': 2 } }, dead: { 'phone|button#buy': 3 }, rage: { 'phone|a#more.link': 1 } });
  });

  it('counts an opted-out view as a view only, whatever the body says', () => {
    const d = beaconDelta({ ...base, optedOut: true, vc: 'phone', dead: { 'phone|button#buy': 3 } });
    expect(d).toEqual({ ...emptyBehaviourDay(), views: 1, optedOut: 1 });
  });

  it('drops cells out of range, unknown screens, and element names that are not tag#id.class', () => {
    const d = beaconDelta({
      ...base, vc: 'watch', scroll: '33',
      heat: { phone: { '12,1': 5, '1,40': 5, 'a,b': 5, '1,1': 1 }, watch: { '1,1': 9 } },
      dead: { 'phone|<script>': 3, 'phone|button onclick=x': 3, 'tv|button': 3, 'phone|__proto__': 3, 'phone|DIV#ok': 2 },
    });
    expect(d.vc).toEqual({});
    expect(d.scroll).toEqual({});
    expect(d.heat).toEqual({ phone: { '1,1': 1 } });
    expect(d.dead).toEqual({ 'phone|div#ok': 2 });
  });

  it('takes at most 200 clicks and 20 elements from one view', () => {
    const cells: Record<string, number> = {};
    for (let x = 0; x < 12; x++) for (let y = 0; y < 30; y++) cells[`${x},${y}`] = 1000;
    const dead: Record<string, number> = {};
    for (let i = 0; i < 40; i++) dead[`desktop|button#b${i}`] = 1000;
    const d = beaconDelta({ ...base, heat: { desktop: cells }, dead });
    expect(Object.values(d.heat.desktop!).reduce((n, v) => n + v, 0)).toBe(200);
    expect(Object.keys(d.dead)).toHaveLength(20);
    expect(Math.max(...Object.values(d.dead))).toBe(50);
  });
});

describe('mergeBehaviourDay', () => {
  it('keeps a stored day under its caps and counts what does not fit', () => {
    const into = emptyBehaviourDay();
    const delta = emptyBehaviourDay();
    for (let i = 0; i < MAX_HEAT_CELLS_PER_DAY + 10; i++) (delta.heat.phone ??= {})[`${i % 12},${Math.floor(i / 12)}`] = 1;
    for (let i = 0; i < MAX_ELEMENTS_PER_DAY + 5; i++) delta.dead[`phone|button#b${i}`] = 1;
    mergeBehaviourDay(into, delta);
    expect(Object.keys(into.heat.phone!)).toHaveLength(MAX_HEAT_CELLS_PER_DAY);
    expect(into.heatOther).toBe(10);
    expect(Object.keys(into.dead)).toHaveLength(MAX_ELEMENTS_PER_DAY + 1);
    expect(into.dead['other|other']).toBe(5);
  });
});

describe('behaviourFindings', () => {
  it('says dead clicks, rage clicks and a page nobody scrolls in one line each, largest first', () => {
    const day = emptyBehaviourDay();
    day.dead = { 'phone|button#buy': 14, 'desktop|div.card': 2 };
    day.rage = { 'desktop|a#more': 5 };
    day.scroll = { 25: 18, 50: 2 };
    expect(behaviourFindings(day).map((f) => f.text)).toEqual([
      '18 of 20 views stopped in the first quarter of the page; what is below it is seldom seen.',
      'On phones, 14 clicks on button#buy changed nothing on the page.',
      'On computers, people clicked a#more again and again 5 times.',
    ]);
  });

  it('has no finding below the thresholds', () => {
    const day = emptyBehaviourDay();
    day.dead = { 'phone|button#buy': 2 };
    day.rage = { 'phone|a#x': 1 };
    day.scroll = { 25: 5, 100: 1 };
    expect(behaviourFindings(day)).toEqual([]);
  });
});

describe('behaviourSnippet', () => {
  it('writes the owner and the app as literals that cannot close the script', () => {
    const s = behaviourSnippet('https://node.example/', 'alice@node-1', 'x</script><script>alert(1)</script>.html');
    expect(s).toContain('"https://node.example/v1/signals/behaviour"');
    expect(s).toContain('"alice@node-1"');
    expect(s.match(/<\/script>/g)).toHaveLength(1);
    expect(s).not.toMatch(/localStorage|document\.cookie|sessionStorage|\.value\b|keydown|keypress|innerText|textContent/);
  });
});

describe('extractHtml', () => {
  it('takes the whole answer or the first fenced block, and only a complete file', () => {
    expect(extractHtml('<!doctype html><html><body>ok</body></html>')).toBe('<!doctype html><html><body>ok</body></html>');
    expect(extractHtml('Here it is:\n```html\n<!DOCTYPE html>\n<html></html>\n```\nDone.')).toBe('<!DOCTYPE html>\n<html></html>');
    expect(extractHtml('I changed the button.')).toBeNull();
    expect(extractHtml('<!doctype html><html><body>cut off')).toBeNull();
  });
});
