/**
 * @file test/unit/atelier-ambients.test.ts
 * @description The ambient registry (src/data/atelier-ambients.ts) and the matrix check that
 *   proves it (AK-AMBIENT in src/services/atelier-contrast.ts): every entry is measurable, reads
 *   only tokens the contract declares, fits looks that exist, ships at the page whisper; and the
 *   matrix refuses an unknown preset, an alpha outside the bounds, and a field louder than the
 *   whisper on a look that stands on the palette page — with the number.
 * @usage cd aimeat && pnpm test -- atelier-ambients
 * @version-history
 *   v1.1.0 — 2026-09-05 — The kit is pinned to the registry (stage 4): PRESET_IDS, BASE_ALPHA,
 *     PEAK, FPS, CSS_PRESETS and RENDERERS in ambient-presets.js, the bounds in ambient.js and
 *     the aurora lobes in ambient.css all read from source and compared, so the renderers can
 *     never paint what the matrix did not prove.
 *   v1.0.0 — 2026-09-05 — initial (wish-atelier-ambient-visuals, stage 1).
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  AMBIENTS, AMBIENT_IDS, AMBIENT_NONE, AMBIENT_BOUNDS, ambientById, isAmbientValue,
} from '../../src/data/atelier-ambients.js';
import { LOOKS } from '../../src/data/atelier-looks.js';
import {
  runMatrix, loadAtelierSheets, REQUIRED_BASE, SURFACE_TINT_CAP, AMBIENT_SPARSE_CAP,
} from '../../src/services/atelier-contrast.js';

const AMBIENT_TOKENS = ['--ak-ambient', '--ak-ambient-alpha', '--ak-ambient-speed'];

/** A kit source, as text: the browser modules are read, never imported, into this node test. */
function kitSource(file: string): string {
  return readFileSync(new URL(`../../src/static/sdk-libs/atelier/${file}`, import.meta.url), 'utf8');
}
/** `export const NAME = { a: 1, b: 2 }` → { a: 1, b: 2 } (numbers only). */
function numberTable(src: string, name: string): Record<string, number> {
  const m = src.match(new RegExp(`export const ${name} = \\{([^}]*)\\}`));
  expect(m, `${name} in the kit`).toBeTruthy();
  const out: Record<string, number> = {};
  for (const pair of m![1]!.split(',')) {
    const [k, v] = pair.split(':').map((s) => s.trim());
    if (k) out[k] = Number(v);
  }
  return out;
}
/** `export const NAME = { a, b: c }` → ['a', 'b'] (the keys). */
function keyList(src: string, name: string): string[] {
  const m = src.match(new RegExp(`export const ${name} = \\{([^}]*)\\}`));
  expect(m, `${name} in the kit`).toBeTruthy();
  return m![1]!.split(',').map((s) => s.trim().split(':')[0]!.trim()).filter(Boolean);
}

describe('atelier-ambients — the registry', () => {
  it('ids are unique, lowercase words, and none is not one of them', () => {
    expect(new Set(AMBIENT_IDS).size).toBe(AMBIENT_IDS.length);
    for (const id of AMBIENT_IDS) expect(id).toMatch(/^[a-z]+$/);
    expect(AMBIENT_IDS).not.toContain(AMBIENT_NONE);
    expect(AMBIENT_IDS.length).toBe(6);
  });

  it('every entry is measurable: technique, proof, blend, peak, alpha, speed and fps in range', () => {
    for (const a of AMBIENTS) {
      expect(['canvas', 'css', 'webgl+canvas']).toContain(a.technique);
      expect(['field', 'sparse']).toContain(a.proof);
      expect(['over', 'mix']).toContain(a.blend);
      expect(a.peak).toBeGreaterThan(0);
      expect(a.peak).toBeLessThanOrEqual(1);
      expect(a.defaultAlpha).toBeGreaterThan(0);
      expect(a.defaultAlpha).toBeLessThanOrEqual(AMBIENT_BOUNDS.alpha[1]);
      expect(a.defaultSpeed).toBeGreaterThanOrEqual(AMBIENT_BOUNDS.speed[0]);
      expect(a.defaultSpeed).toBeLessThanOrEqual(AMBIENT_BOUNDS.speed[1]);
      expect(a.fps).toBeGreaterThanOrEqual(0);
      expect(a.fps).toBeLessThanOrEqual(30);
      if (a.technique === 'css') expect(a.fps).toBe(0);
      else expect(a.fps).toBeGreaterThan(0);
      expect(a.feel.length).toBeGreaterThan(20);
      expect(a.evokes.length).toBeGreaterThan(10);
    }
  });

  it('a field names the pigments it lays down (a subset of what it reads); a sparse preset names none', () => {
    for (const a of AMBIENTS) {
      if (a.proof === 'field') {
        expect(a.pigments.length).toBeGreaterThan(0);
        for (const t of a.pigments) expect(a.reads).toContain(t);
      } else {
        expect(a.pigments).toEqual([]);
        // Points and lines carry no ground check, so their loudness is bounded here, once.
        expect(a.peak).toBeLessThanOrEqual(AMBIENT_SPARSE_CAP);
      }
      expect(a.reads).toContain('--ak-bg');
    }
  });

  it('reads only tokens the contract declares', () => {
    const base = loadAtelierSheets().sheet.base;
    for (const a of AMBIENTS) for (const t of a.reads) expect(base.has(t), `${a.id} reads ${t}`).toBe(true);
  });

  it('fits looks that exist', () => {
    const looks = new Set(LOOKS.map((l) => l.id));
    for (const a of AMBIENTS) {
      expect(a.fitsLooks.length).toBeGreaterThan(0);
      for (const id of a.fitsLooks) expect(looks.has(id), `${a.id} fits ${id}`).toBe(true);
    }
  });

  it('the shipped default alpha keeps every field preset at the page whisper', () => {
    for (const a of AMBIENTS) {
      if (a.proof !== 'field') continue;
      expect(a.peak * a.defaultAlpha, `${a.id} at its default`).toBeLessThanOrEqual(SURFACE_TINT_CAP / 100 + 1e-9);
    }
  });

  it('ambientById and isAmbientValue agree with the list', () => {
    for (const id of AMBIENT_IDS) expect(ambientById(id)?.id).toBe(id);
    expect(ambientById('banana')).toBeUndefined();
    expect(isAmbientValue(AMBIENT_NONE)).toBe(true);
    expect(isAmbientValue('waves')).toBe(true);
    expect(isAmbientValue('banana')).toBe(false);
    expect(isAmbientValue(3)).toBe(false);
  });
});

describe('atelier-ambients — the matrix proves the layer (AK-AMBIENT)', () => {
  it('the contract declares the three ambient tokens and requires them of every look', () => {
    const base = loadAtelierSheets().sheet.base;
    for (const t of AMBIENT_TOKENS) {
      expect(REQUIRED_BASE, t).toContain(t);
      expect(base.has(t), t).toBe(true);
    }
    expect(base.get('--ak-ambient')).toBe(AMBIENT_NONE);
  });

  it('every look resolves --ak-ambient to a preset or none, with an alpha inside the bounds', () => {
    for (const l of LOOKS) {
      const v = l.tokens['--ak-ambient'];
      if (v === undefined) continue;
      expect(isAmbientValue(v), `${l.id} → ${v}`).toBe(true);
      const alpha = Number(l.tokens['--ak-ambient-alpha'] ?? '1');
      expect(alpha).toBeGreaterThanOrEqual(AMBIENT_BOUNDS.alpha[0]);
      expect(alpha).toBeLessThanOrEqual(AMBIENT_BOUNDS.alpha[1]);
    }
  });

  it('the shipped sheets pass the matrix with the ambient checks in it', () => {
    expect(runMatrix().filter((r) => !r.ok)).toEqual([]);
  });

  it('an unknown preset is refused, naming the six', () => {
    const failures = runMatrix({ '--ak-ambient': 'banana' }, { presets: ['vivid'] }).filter((r) => !r.ok);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]!.label).toBe('AK-AMBIENT preset');
    for (const id of AMBIENT_IDS) expect(failures[0]!.why).toContain(id);
  });

  it('an alpha outside the bounds is refused', () => {
    const failures = runMatrix({ '--ak-ambient': 'waves', '--ak-ambient-alpha': '1.5' }, { presets: ['vivid'] }).filter((r) => !r.ok);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]!.label).toBe('AK-AMBIENT alpha');
  });

  it('a field at the whisper passes on the palette page; louder is refused with the number', () => {
    const quiet = runMatrix({ '--ak-ambient': 'waves', '--ak-ambient-alpha': '0.2' }, { presets: ['vivid'] });
    expect(quiet.filter((r) => !r.ok)).toEqual([]);
    expect(quiet.some((r) => r.label.startsWith('AK-AMBIENT ink over waves'))).toBe(true);
    const loud = runMatrix({ '--ak-ambient': 'waves', '--ak-ambient-alpha': '0.7' }, { presets: ['vivid'] }).filter((r) => !r.ok);
    expect(loud.length).toBeGreaterThan(0);
    const cap = loud.find((r) => r.label === 'AK-AMBIENT waves %');
    expect(cap).toBeDefined();
    expect(cap!.why).toMatch(/24\.5%/);
  });

  it('a sparse preset carries no ground check and passes at full alpha', () => {
    const results = runMatrix({ '--ak-ambient': 'grid', '--ak-ambient-alpha': '1' }, { presets: ['vivid'] });
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results.some((r) => r.label === 'AK-AMBIENT grid sparse')).toBe(true);
    expect(results.some((r) => r.label.startsWith('AK-AMBIENT ink over'))).toBe(false);
  });

  it('none is the quiet default: no ambient check runs', () => {
    const results = runMatrix(undefined, { presets: ['vivid'] });
    expect(results.some((r) => r.label.startsWith('AK-AMBIENT'))).toBe(false);
  });
});

describe('atelier-ambients — the kit is pinned to the registry', () => {
  const presets = kitSource('ambient-presets.js');

  it('PRESET_IDS are the registry\'s ids, in order', () => {
    const m = presets.match(/export const PRESET_IDS = \[([^\]]*)\]/);
    expect(m).toBeTruthy();
    const ids = m![1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
    expect(ids).toEqual([...AMBIENT_IDS]);
  });

  it('BASE_ALPHA, PEAK and FPS carry the registry\'s numbers', () => {
    const alpha = numberTable(presets, 'BASE_ALPHA');
    const peak = numberTable(presets, 'PEAK');
    const fps = numberTable(presets, 'FPS');
    for (const a of AMBIENTS) {
      expect(alpha[a.id], `${a.id} alpha`).toBe(a.defaultAlpha);
      expect(peak[a.id], `${a.id} peak`).toBe(a.peak);
      expect(fps[a.id], `${a.id} fps`).toBe(a.fps);
    }
  });

  it('every css preset is CSS in the kit and every other one has a renderer', () => {
    const css = keyList(presets, 'CSS_PRESETS');
    const renderers = keyList(presets, 'RENDERERS');
    for (const a of AMBIENTS) {
      if (a.technique === 'css') {
        expect(css).toContain(a.id);
        expect(renderers).not.toContain(a.id);
      } else {
        expect(renderers).toContain(a.id);
        expect(css).not.toContain(a.id);
      }
    }
  });

  it('the layer clamps to the registry\'s bounds', () => {
    const core = kitSource('ambient.js');
    const m = core.match(/const BOUNDS = \{ alpha: \[([\d.]+), ([\d.]+)\], speed: \[([\d.]+), ([\d.]+)\] \}/);
    expect(m).toBeTruthy();
    expect([Number(m![1]), Number(m![2])]).toEqual([...AMBIENT_BOUNDS.alpha]);
    expect([Number(m![3]), Number(m![4])]).toEqual([...AMBIENT_BOUNDS.speed]);
  });

  it('the aurora lobes in ambient.css sit at or under the registry\'s peak', () => {
    const css = readFileSync(new URL('../../public/lib/aimeat-atelier/ambient.css', import.meta.url), 'utf8');
    const block = css.match(/\.ak-ambient__drift \{([\s\S]*?)\n\}/);
    expect(block).toBeTruthy();
    const lobes = [...block![1]!.matchAll(/color-mix\(in oklab, var\(--ak-[a-z0-9-]+\) (\d+)%/g)].map((x) => Number(x[1]));
    expect(lobes.length).toBeGreaterThanOrEqual(3);
    const aurora = ambientById('aurora')!;
    for (const pct of lobes) expect(pct).toBeLessThanOrEqual(aurora.peak * 100 + 1e-9);
    // And it is the only infinite animation the sheet adds, tweened on transform.
    expect(css.match(/infinite/g)?.length).toBe(1);
    expect(block![1]).toMatch(/will-change: transform/);
  });
});
