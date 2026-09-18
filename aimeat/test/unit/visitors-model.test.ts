/**
 * @file test/unit/visitors-model.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The arithmetic behind the App Catalog's Visitors section, and the header reader that
 *   feeds it a place.
 *
 *   THE JOIN TEST IS THE ONE THAT MATTERS. The reverse proxy names a country by two letters and the
 *   bundled atlas names it by number, and the table between them was written by hand. A wrong row
 *   shades the wrong country and nothing anywhere complains, so every numbered shape in the real
 *   atlas file is checked here against the table, and a spot list pins the ones a typo would hit.
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ISO_NUMERIC, numericOf, alpha2Of, clampWindow, barsFromSeries, shadeStep, projectPoint, zoomBox, placesOfCountry,
} from '../../src/static/app-catalog/js/visitors-model.js';
import { geoFromHeaders } from '../../src/utils/geo-headers.js';

const ROOT = join(import.meta.dirname, '../..');
const atlas = JSON.parse(readFileSync(join(ROOT, 'public/lib/aimeat-atlas@1.json'), 'utf-8')) as {
  w: number; h: number; countries: Array<{ id: string; name: string; bbox: number[] }>;
};

describe('the country table joins the proxy\'s codes to the atlas\'s shapes', () => {
  it('every shape the atlas numbers has a country code, and no number is used twice', () => {
    const numbered = atlas.countries.filter((c) => c.id);
    const missing = numbered.filter((c) => !alpha2Of(c.id)).map((c) => `${c.id} ${c.name}`);
    expect(missing).toEqual([]);
    const numbers = Object.values(ISO_NUMERIC);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('the rows a typo would hit are the right ones', () => {
    const name = (a2: string): string | undefined => atlas.countries.find((c) => c.id === numericOf(a2))?.name;
    expect(name('FI')).toBe('Finland');
    expect(name('SE')).toBe('Sweden');
    expect(name('US')).toBe('United States of America');
    expect(name('GB')).toBe('United Kingdom');
    expect(name('DE')).toBe('Germany');
    expect(name('CO')).toBe('Colombia');
    expect(name('JP')).toBe('Japan');
    expect(name('AU')).toBe('Australia');
  });

  it('a code that is no country, or a prototype name, is no shape', () => {
    expect(numericOf('ZZ')).toBeNull();
    expect(numericOf('__proto__')).toBeNull();
    expect(numericOf('constructor')).toBeNull();
    expect(numericOf('fi')).toBe('246');
    expect(alpha2Of('toString')).toBeNull();
  });
});

describe('the day window', () => {
  it('is 0 to 360, and anything unreadable is 30', () => {
    expect(clampWindow(0)).toBe(0);
    expect(clampWindow('0')).toBe(0);
    expect(clampWindow(360)).toBe(360);
    expect(clampWindow(9999)).toBe(360);
    expect(clampWindow(-1)).toBe(30);
    expect(clampWindow('abc')).toBe(30);
    expect(clampWindow('')).toBe(30);
    expect(clampWindow(7.5)).toBe(30);
  });
});

describe('a sparse series becomes evenly spaced bars', () => {
  const series = [
    { day: '2026-09-01', signed_in: 2, anonymous: 1 },
    { day: '2026-09-03', signed_in: 0, anonymous: 4 },
  ];

  it('gives every day of the window a slot, empty ones included', () => {
    const out = barsFromSeries(series, '2026-09-01', '2026-09-05', ['signed_in', 'anonymous']);
    expect(out.grain).toBe('day');
    expect(out.bars.map((b: { total: number }) => b.total)).toEqual([3, 0, 4, 0, 0]);
    expect(out.max).toBe(4);
    expect(out.bars[0]).toMatchObject({ from: '2026-09-01', to: '2026-09-01', signed_in: 2, anonymous: 1 });
  });

  it('folds to weeks past 120 days, and loses nothing doing it', () => {
    const out = barsFromSeries(series, '2025-09-24', '2026-09-18', ['signed_in', 'anonymous']);
    expect(out.grain).toBe('week');
    expect(out.bars.length).toBe(52);
    expect(out.bars.reduce((n: number, b: { total: number }) => n + b.total, 0)).toBe(7);
  });

  it('an empty series is a row of empty bars and a max of zero', () => {
    const out = barsFromSeries([], '2026-09-18', '2026-09-18', ['signed_in']);
    expect(out.bars.length).toBe(1);
    expect(out.max).toBe(0);
  });
});

describe('shading', () => {
  it('none is 0, the most is 5, and one visit beside hundreds is still visible', () => {
    expect(shadeStep(0, 400)).toBe(0);
    expect(shadeStep(400, 400)).toBe(5);
    expect(shadeStep(1, 400)).toBe(1);
    expect(shadeStep(5, 0)).toBe(0);
    // The reason for the square root: a quarter of the maximum is the middle shade, not the palest.
    expect(shadeStep(100, 400)).toBe(3);
  });
});

describe('the map\'s geometry', () => {
  it('puts Helsinki inside Finland\'s box on the atlas canvas', () => {
    const fi = atlas.countries.find((c) => c.id === '246')!;
    const p = projectPoint(60.2, 24.9, atlas.w, atlas.h);
    expect(p.x).toBeGreaterThan(fi.bbox[0]);
    expect(p.x).toBeLessThan(fi.bbox[2]);
    expect(p.y).toBeGreaterThan(fi.bbox[1]);
    expect(p.y).toBeLessThan(fi.bbox[3]);
  });

  it('zooms to a country with air around it, keeps 2:1, and stays on the canvas', () => {
    const fi = atlas.countries.find((c) => c.id === '246')!;
    const box = zoomBox(fi.bbox, atlas.w, atlas.h, 120);
    expect(box.w / box.h).toBeCloseTo(2, 5);
    expect(box.x).toBeLessThanOrEqual(fi.bbox[0]);
    expect(box.x + box.w).toBeGreaterThanOrEqual(fi.bbox[2]);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.h).toBeLessThanOrEqual(atlas.h);
  });

  it('never zooms a small country tighter than the floor', () => {
    const lu = atlas.countries.find((c) => c.name === 'Luxembourg')!;
    expect(zoomBox(lu.bbox, atlas.w, atlas.h, 120).w).toBe(120);
  });
});

describe('the places of one country', () => {
  it('are that country\'s only, most visits first', () => {
    const places = [
      { country: 'FI', region: 'Uusimaa', city: 'Helsinki', people: 2 },
      { country: 'SE', region: 'Stockholm', city: 'Stockholm', people: 9 },
      { country: 'FI', region: 'Pirkanmaa', city: 'Tampere', people: 5 },
    ];
    expect(placesOfCountry(places, 'FI').map((p: { city: string }) => p.city)).toEqual(['Tampere', 'Helsinki']);
    expect(placesOfCountry(undefined, 'FI')).toEqual([]);
  });
});

describe('the place headers', () => {
  const headers = (h: Record<string, string>) => (name: string): string | undefined => h[name];

  it('are not read at all when the operator has not said a proxy sets them', () => {
    expect(geoFromHeaders(false, headers({ 'x-geo-country': 'FI', 'x-geo-city': 'Helsinki' }))).toBeNull();
  });

  it('read a place, and re-read a UTF-8 name that arrived as bytes', () => {
    const asBytes = Buffer.from('Jyväskylä', 'utf8').toString('latin1');
    const geo = geoFromHeaders(true, headers({
      'x-geo-country': 'fi', 'x-geo-region': 'Keski-Suomi', 'x-geo-city': asBytes, 'x-geo-lat': '62.2415', 'x-geo-lon': '25.7209',
    }));
    expect(geo).toEqual({ country: 'FI', region: 'Keski-Suomi', city: 'Jyväskylä', lat: 62.2415, lon: 25.7209 });
  });

  it('answer told-but-unknown as an empty place, which is not the same as not told', () => {
    expect(geoFromHeaders(true, headers({}))).toEqual({ country: null, region: null, city: null, lat: null, lon: null });
  });

  it('take a coordinate that is not a number as no coordinate', () => {
    const geo = geoFromHeaders(true, headers({ 'x-geo-country': 'FI', 'x-geo-lat': 'north', 'x-geo-lon': '' }));
    expect(geo?.lat).toBeNull();
    expect(geo?.lon).toBeNull();
  });
});
