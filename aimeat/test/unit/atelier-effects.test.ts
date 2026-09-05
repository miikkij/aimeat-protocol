/**
 * @file test/unit/atelier-effects.test.ts
 * @description The effects registry (src/data/atelier-effects.ts), the CSS filter transforms
 *   (src/services/atelier-color.ts) and the matrix branch that proves the colour and overlay
 *   effects (AK-FX in src/services/atelier-contrast.ts): every entry is measurable, every
 *   default sits inside its bounds, the hosts are real components, living motion exists only
 *   where a post pass does and backdrop only on a filter-function engine; the transforms are
 *   the Filter Effects matrices (identity at rest, gray untouched by a hue turn); the colour
 *   effects are proven at their defaults on the looks they fit, an overlay effect at full
 *   strength keeps the words readable, and a grade that collapses a pair is refused with the
 *   number.
 * @usage cd aimeat && pnpm exec vitest run test/unit/atelier-effects.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-05 — initial (wish-atelier-post-process-effects, stage 2).
 */
import { describe, it, expect } from 'vitest';
import {
  EFFECTS, EFFECT_IDS, POST_IDS, POST_MAX, EFFECT_HOSTS, EFFECT_TOKENS, EFFECT_TOKEN_VARS,
  effectById, isTextBearing, clampParam, resolveParams,
} from '../../src/data/atelier-effects.js';
import { LOOKS } from '../../src/data/atelier-looks.js';
import { UI_COMPONENTS } from '../../src/services/app-ui/registry.js';
import { hueRotateSrgb, saturateSrgb, duotoneSrgb, lum } from '../../src/services/atelier-color.js';
import { runMatrix, loadAtelierSheets } from '../../src/services/atelier-contrast.js';

describe('atelier-effects — the registry', () => {
  it('ids are unique lowercase words, and there are nine', () => {
    expect(new Set(EFFECT_IDS).size).toBe(EFFECT_IDS.length);
    for (const id of EFFECT_IDS) expect(id).toMatch(/^[a-z]+$/);
    expect(EFFECT_IDS.length).toBe(9);
  });

  it('every entry is measurable: engine, at least one volume and one motion, a proof, and words', () => {
    for (const e of EFFECTS) {
      expect(['css', 'svg', 'canvas']).toContain(e.engine);
      expect(e.volume.length).toBeGreaterThan(0);
      for (const v of e.volume) expect(['ground', 'prop', 'zone']).toContain(v);
      expect(e.motion.length).toBeGreaterThan(0);
      for (const m of e.motion) expect(['still', 'moment', 'living']).toContain(m);
      expect(['colour', 'overlay', 'none']).toContain(e.proof);
      expect(e.params.length).toBeGreaterThan(0);
      expect(e.feel.length).toBeGreaterThan(20);
      expect(e.feel.length).toBeLessThanOrEqual(240);
      expect(e.evokes.length).toBeGreaterThan(10);
      expect(e.note.length).toBeGreaterThan(40);
    }
  });

  it('every default sits inside its bounds; a token default is one of its tokens; names are unique', () => {
    for (const e of EFFECTS) {
      expect(new Set(e.params.map((p) => p.name)).size).toBe(e.params.length);
      for (const p of e.params) {
        expect(p.name).toMatch(/^[a-z]+$/);
        expect(p.what.length).toBeGreaterThan(10);
        if (p.kind === 'number') {
          expect(p.min).toBeLessThan(p.max);
          expect(p.default).toBeGreaterThanOrEqual(p.min);
          expect(p.default).toBeLessThanOrEqual(p.max);
        } else {
          expect(p.tokens).toEqual(EFFECT_TOKENS);
          expect(p.tokens).toContain(p.default);
        }
      }
    }
  });

  it('living motion exists only where a post pass does; a moment or a living effect carries a duration or a speed', () => {
    for (const e of EFFECTS) {
      if (e.motion.includes('living')) expect(e.post, `${e.id} is living, so it must be a post pass`).toBe(true);
      if (e.motion.includes('moment')) {
        expect(e.params.some((p) => p.name === 'duration' || p.name === 'speed'), `${e.id} plays a moment`).toBe(true);
      }
      // A canvas engine has no content-side rendering: it is a post pass and nothing else.
      if (e.engine === 'canvas') {
        expect(e.post).toBe(true);
        expect(e.motion).toEqual(['living']);
      }
    }
  });

  it('backdrop only on a filter-function engine, and only recolour today', () => {
    for (const e of EFFECTS) if (e.backdrop) expect(e.engine).toBe('css');
    expect(EFFECTS.filter((e) => e.backdrop).map((e) => e.id)).toEqual(['recolour']);
  });

  it('a ground effect is proven (colour or overlay), and a duotone is a picture effect by measurement', () => {
    for (const e of EFFECTS) {
      if (e.volume.includes('ground')) expect(e.proof, e.id).not.toBe('none');
      // An overlay proof reads `strength` as the share of ink laid down, so it must exist.
      if (e.proof === 'overlay') expect(e.params.find((p) => p.name === 'strength')?.kind).toBe('number');
    }
    // The matrix can still measure a duotone under words, which is how the ground door was
    // closed: see the AK-FX block below.
    expect(effectById('duotone')!.volume).toEqual(['prop']);
    expect(effectById('duotone')!.proof).toBe('colour');
  });

  it('reads only tokens the contract declares, and the token names map onto contract tokens', () => {
    const base = loadAtelierSheets().sheet.base;
    for (const e of EFFECTS) for (const t of e.reads) expect(base.has(t), `${e.id} reads ${t}`).toBe(true);
    for (const name of EFFECT_TOKENS) {
      const v = EFFECT_TOKEN_VARS[name];
      expect(v, name).toBeTruthy();
      expect(base.has(v!), `${name} → ${v}`).toBe(true);
    }
  });

  it('fits looks that exist', () => {
    const looks = new Set(LOOKS.map((l) => l.id));
    for (const e of EFFECTS) {
      expect(e.fitsLooks.length).toBeGreaterThan(0);
      for (const id of e.fitsLooks) expect(looks.has(id), `${e.id} fits ${id}`).toBe(true);
    }
  });

  it('the hosts are real components, and every other component bears text', () => {
    const ids = new Set(UI_COMPONENTS.map((c) => c.id));
    for (const h of EFFECT_HOSTS) expect(ids.has(h), h).toBe(true);
    expect(isTextBearing('list')).toBe(true);
    expect(isTextBearing('table')).toBe(true);
    expect(isTextBearing('hero')).toBe(false);
    expect(isTextBearing('figure')).toBe(false);
    expect(UI_COMPONENTS.filter((c) => isTextBearing(c.id)).length).toBe(ids.size - EFFECT_HOSTS.length);
  });

  it('POST_IDS are the post effects, and a chain stops at two', () => {
    expect(POST_IDS).toEqual(EFFECTS.filter((e) => e.post).map((e) => e.id));
    expect(POST_IDS).toContain('kaleidoscope');
    expect(POST_IDS).not.toContain('vignette');
    expect(POST_MAX).toBe(2);
  });

  it('effectById, clampParam and resolveParams agree with the declarations', () => {
    for (const id of EFFECT_IDS) expect(effectById(id)?.id).toBe(id);
    expect(effectById('bloom')).toBeUndefined();
    const distort = effectById('distort')!;
    const scale = distort.params.find((p) => p.name === 'scale')!;
    expect(clampParam(scale, 999)).toBe(40);
    expect(clampParam(scale, -3)).toBe(2);
    expect(clampParam(scale, '7')).toBe(7);
    expect(clampParam(scale, 'seven')).toBe(12);
    const duotone = effectById('duotone')!;
    const shadow = duotone.params.find((p) => p.name === 'shadow')!;
    expect(clampParam(shadow, 'accent')).toBe('accent');
    expect(clampParam(shadow, 'magenta')).toBe('ink');
    expect(resolveParams(distort, { scale: 50, bloom: 3 })).toEqual({ scale: 40, frequency: 0.012, octaves: 1, duration: 700 });
    expect(resolveParams(duotone)).toEqual({ shadow: 'ink', light: 'bg', strength: 1 });
  });
});

describe('atelier-effects — the transforms are the Filter Effects matrices in sRGB', () => {
  it('hue-rotate 0 and saturate 1 are the identity; a full turn comes home', () => {
    for (const hex of ['#e8564a', '#1a1a2e', '#fafaf8', '#0e7c66']) {
      expect(hueRotateSrgb(hex, 0)).toBe(hex);
      expect(saturateSrgb(hex, 1)).toBe(hex);
      expect(hueRotateSrgb(hex, 360)).toBe(hex);
    }
  });

  it('a hue turn leaves gray alone and sends red toward cyan', () => {
    expect(hueRotateSrgb('#808080', 90)).toBe('#808080');
    expect(hueRotateSrgb('#1a1a1a', 180)).toBe('#1a1a1a');
    const turned = hueRotateSrgb('#ff0000', 180);
    const n = parseInt(turned.slice(1), 16);
    expect((n >> 16) & 255).toBe(0);
    expect((n >> 8) & 255).toBeGreaterThan(100);
    expect(n & 255).toBeGreaterThan(100);
  });

  it('saturate 0.5 pulls a colour toward its gray and 2 pushes it away; the luminance rows keep gray', () => {
    const coral = '#e8564a';
    const dull = saturateSrgb(coral, 0.5);
    const vivid = saturateSrgb(coral, 2);
    const spread = (hex: string): number => { const n = parseInt(hex.slice(1), 16); const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; return Math.max(...c) - Math.min(...c); };
    expect(spread(dull)).toBeLessThan(spread(coral));
    expect(spread(vivid)).toBeGreaterThan(spread(coral));
    expect(saturateSrgb('#808080', 2)).toBe('#808080');
  });

  it('duotone at strength 1 sends black to the shadow and white to the light; at 0 it is the identity', () => {
    expect(duotoneSrgb('#000000', '#1a1a2e', '#fafaf8', 1)).toBe('#1a1a2e');
    expect(duotoneSrgb('#ffffff', '#1a1a2e', '#fafaf8', 1)).toBe('#fafaf8');
    expect(duotoneSrgb('#e8564a', '#1a1a2e', '#fafaf8', 0)).toBe('#e8564a');
    // A mid gray lands mid-ramp, darker with a darker shadow.
    const mid = duotoneSrgb('#808080', '#000000', '#ffffff', 1);
    expect(lum(mid)).toBeCloseTo(lum('#808080'), 2);
  });
});

describe('atelier-effects — the matrix proves the colour and overlay effects (AK-FX)', () => {
  it('an unknown effect is refused naming the nine', () => {
    const failures = runMatrix(undefined, { presets: ['vivid'], effect: { id: 'bloom' } }).filter((r) => !r.ok);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]!.label).toBe('AK-FX effect');
    for (const id of EFFECT_IDS) expect(failures[0]!.why).toContain(id);
  });

  it('each ground effect passes at its defaults on EVERY look, and the check ran', () => {
    for (const e of EFFECTS) {
      if (!e.volume.includes('ground')) continue;
      const results = runMatrix(undefined, { effect: { id: e.id } });
      expect(results.filter((r) => !r.ok), `${e.id} at its defaults`).toEqual([]);
      expect(results.some((r) => r.label.startsWith(`AK-FX ${e.id}`)), `${e.id} was measured`).toBe(true);
    }
  });

  it('an overlay at a quarter of ink passes every look; louder refuses the palette page with the number', () => {
    for (const id of ['scanlines', 'vignette']) {
      expect(runMatrix(undefined, { effect: { id, params: { strength: 0.25 } } }).filter((r) => !r.ok), `${id} at 0.25`).toEqual([]);
    }
    // Measured 2026-09-05: vignette 0.40 fails every look (3.43 on vivid × mist/dark); scanlines
    // 0.30 fails the thirteen palette-page looks by a hair (4.45) and passes the six worlds.
    const deep = runMatrix(undefined, { presets: ['vivid'], effect: { id: 'vignette', params: { strength: 0.4 } } }).filter((r) => !r.ok);
    expect(deep.length).toBeGreaterThan(0);
    expect(deep[0]!.label).toMatch(/^AK-FX vignette ink at the darkest point/);
    expect(deep.every((r) => r.actual < 4.5 && r.actual > 1)).toBe(true);
    expect(runMatrix(undefined, { presets: ['lounge'], effect: { id: 'scanlines', params: { strength: 0.3 } } }).filter((r) => !r.ok)).toEqual([]);
    expect(runMatrix(undefined, { presets: ['vivid'], effect: { id: 'scanlines', params: { strength: 0.3 } } }).filter((r) => !r.ok).length).toBeGreaterThan(0);
  });

  it('a grade that collapses a pair is refused with the measured number; a world carries it', () => {
    // Measured 2026-09-05: saturate 2 fails accent text on the palette page (3.65 on vivid ×
    // aimeat/light) and passes the six worlds; every hue at saturate 1.5 or under passes all.
    const failures = runMatrix(undefined, { presets: ['vivid'], effect: { id: 'recolour', params: { saturate: 2 } } }).filter((r) => !r.ok);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]!.label).toMatch(/^AK-FX recolour accent-as-text/);
    expect(failures[0]!.actual).toBeLessThan(4.5);
    expect(failures[0]!.actual).toBeGreaterThan(3);
    expect(runMatrix(undefined, { presets: ['lounge'], effect: { id: 'recolour', params: { saturate: 2 } } }).filter((r) => !r.ok)).toEqual([]);
    expect(runMatrix(undefined, { effect: { id: 'recolour', params: { hue: 180, saturate: 1.5 } } }).filter((r) => !r.ok)).toEqual([]);
  });

  it('a duotone under body text collapses the dimmed ink, which is why it is a picture effect', () => {
    // Measured 2026-09-05: strength 1 fails 18 of 19 looks (broadcast alone passes), and mixing
    // back toward the source only moves the failure (0.5 crosses ink and page at 1.0).
    const failures = runMatrix(undefined, { presets: ['vivid'], effect: { id: 'duotone' } }).filter((r) => !r.ok);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some((r) => r.label === 'AK-FX duotone dimmed ink on mapped card' && r.actual < 4.5)).toBe(true);
  });

  it('a value outside the bounds is clamped in the proof, as the kit clamps it', () => {
    const wild = runMatrix(undefined, { presets: ['vivid'], effect: { id: 'vignette', params: { strength: 5 } } });
    const tame = runMatrix(undefined, { presets: ['vivid'], effect: { id: 'vignette', params: { strength: 0.7 } } });
    expect(wild.map((r) => [r.label, +r.actual.toFixed(4)])).toEqual(tame.map((r) => [r.label, +r.actual.toFixed(4)]));
  });

  it('an effect with no proof records that it ran, and none runs when none is named', () => {
    const results = runMatrix(undefined, { presets: ['vivid'], effect: { id: 'distort' } });
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results.some((r) => r.label === 'AK-FX distort prop')).toBe(true);
    expect(runMatrix(undefined, { presets: ['vivid'] }).some((r) => r.label.startsWith('AK-FX'))).toBe(false);
  });
});
