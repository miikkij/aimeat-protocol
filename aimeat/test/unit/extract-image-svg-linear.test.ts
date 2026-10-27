/**
 * @file test/unit/extract-image-svg-linear.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description readSvgFacts runs on the node's event loop for every stored SVG, so it must take time
 *   in proportion to the file. Shapes that made the old patterns rescan the rest of the file per tag,
 *   or try every split of a whitespace run, answer quickly; and every fact a real SVG gives (its size,
 *   viewBox, title, the AI mark and the creator tool in its XMP) reads exactly as before
 *   (secaudit2026oct26, readImageFacts:superlinear-svg-and-xmp-patterns-on-arrival).
 * @usage cd aimeat && pnpm exec vitest run test/unit/extract-image-svg-linear.test.ts
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, expect, it } from 'vitest';
import { readSvgFacts } from '../../src/services/content/extract-image.js';

const TRAINED = 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia';

function timed(svg: string): number {
  const started = performance.now();
  readSvgFacts(svg);
  return performance.now() - started;
}

describe('the facts a real SVG gives are read as before', () => {
  it('reads the size, the title, the AI mark and the creator tool', () => {
    const svg = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="640px" height="480">'
      + '<title> A chart </title><metadata><x:xmpmeta><rdf:Description Iptc4xmpExt:DigitalSourceType="' + TRAINED + '"'
      + ' xmp:CreatorTool="Inkscape 1.3"/></x:xmpmeta></metadata></svg>';
    const out = readSvgFacts(svg);
    expect(out.facts).toEqual({ format: 'svg+xml', width: 640, height: 480, title: 'A chart' });
    expect(out.digitalSourceType).toBe(TRAINED);
    expect(out.software).toBe('Inkscape 1.3');
    expect(out.errors).toEqual({});
  });

  it('reads the element forms, the viewBox, upper-case tags and trims the values', () => {
    const svg = '<SVG viewBox="0 0 120.4 80"><TITLE x="1">Logo</TITLE><METADATA id="m">'
      + '<Iptc4xmpExt:DigitalSourceType>  ' + TRAINED + ' </Iptc4xmpExt:DigitalSourceType>'
      + '<xmp:CreatorTool>\n  Adobe Illustrator 28.0 (Windows)\n</xmp:CreatorTool></METADATA></SVG>';
    const out = readSvgFacts(svg);
    expect(out.facts).toEqual({ format: 'svg+xml', width: 120, height: 80, title: 'Logo' });
    expect(out.digitalSourceType).toBe(TRAINED);
    expect(out.software).toBe('Adobe Illustrator 28.0 (Windows)');
  });

  it('takes the first <svg> that closes, the first title that fits, and skips what does not match', () => {
    const svg = '<svgx width="1"><svg width="30" height="40"><title></title><title>' + 'x'.repeat(301) + '</title>'
      + '<title>Third</title><metadata>no marks here</metadata></svg>';
    const out = readSvgFacts(svg);
    expect(out.facts).toEqual({ format: 'svg+xml', width: 30, height: 40, title: 'Third' });
    expect(out.digitalSourceType).toBeUndefined();
    expect(out.software).toBeUndefined();
  });

  it('reads only what closes in a file with unclosed tags', () => {
    const out = readSvgFacts('<svg width="5" <title>x <metadata>CreatorTool>y');
    expect(out.facts).toEqual({ format: 'svg+xml', width: 5 });
    expect(out.software).toBeUndefined();
  });
});

describe('the arrival reader takes time in proportion to the file', () => {
  it('a creator tool followed by a long whitespace run with no "<" after it', () => {
    const svg = '<svg width="1" height="1"><metadata>xmp:CreatorTool>' + ' '.repeat(1500) + '</metadata></svg>';
    expect(timed(svg)).toBeLessThan(100);
  });

  it('many <svg> openings that never close', () => {
    expect(timed('<svg '.repeat(40_000))).toBeLessThan(100);
  });

  it('many <title> and <metadata> openings that never close', () => {
    expect(timed('<svg>' + '<title '.repeat(30_000))).toBeLessThan(100);
    expect(timed('<svg>' + '<metadata '.repeat(30_000))).toBeLessThan(100);
  });

  it('many marks in the metadata that never close', () => {
    const svg = '<svg><metadata>' + 'DigitalSourceType="'.repeat(20_000) + 'CreatorTool="'.repeat(20_000) + '</metadata></svg>';
    expect(timed(svg)).toBeLessThan(100);
  });
});
