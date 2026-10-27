/**
 * @file test/unit/extract-image-xmp-shape.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description readImageFacts hands a picture's XMP packet to exifr's parser only when the packet is
 *   well-formed and of normal depth (services/content/xmp-shape.ts), because exifr's element search
 *   rescans the rest of the packet for every opening that never closes. A packet of many unclosed tags
 *   answers quickly with an error; a real packet gives its creator tool and AI mark as before
 *   (secaudit2026oct26, readImageFacts:superlinear-svg-and-xmp-patterns-on-arrival).
 * @usage cd aimeat && pnpm exec vitest run test/unit/extract-image-xmp-shape.test.ts
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, expect, it } from 'vitest';
import { crc32 } from 'node:zlib';
import { readImageFacts } from '../../src/services/content/extract-image.js';
import { xmpIsBounded, XMP_MAX_DEPTH } from '../../src/services/content/xmp-shape.js';

const TRAINED = 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia';

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

/** A 1x1 RGB PNG whose iTXt chunk carries `xmp` as its XMP packet. */
function pngWithXmp(xmp: string): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  const itxt = Buffer.concat([Buffer.from('XML:com.adobe.xmp\0\0\0\0\0', 'latin1'), Buffer.from(xmp, 'utf8')]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('iTXt', itxt), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const packet = (body: string) =>
  '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
  + body + '</rdf:RDF></x:xmpmeta><?xpacket end="w"?>';

describe('a real XMP packet is read as before', () => {
  it('gives the creator tool, the AI mark and the title, with no error', async () => {
    const xmp = packet('<rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="Probe 1.0"'
      + ' Iptc4xmpExt:DigitalSourceType="' + TRAINED + '" note="a > b">'
      + '<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Kuva</rdf:li></rdf:Alt></dc:title>'
      + '<dc:subject><rdf:Bag><rdf:li>a</rdf:li><rdf:li>b</rdf:li></rdf:Bag></dc:subject><xmp:Empty/>'
      + '</rdf:Description>');
    expect(xmpIsBounded(xmp)).toBe(true);
    const out = await readImageFacts(pngWithXmp(xmp), 'image/png');
    expect(out.errors).toEqual({});
    expect(out.software).toBe('Probe 1.0');
    expect(out.digitalSourceType).toBe(TRAINED);
    expect(out.facts.width).toBe(1);
  });

  it('a picture with no XMP is read as before', async () => {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(3, 0); ihdr.writeUInt32BE(2, 4); ihdr[8] = 8; ihdr[9] = 6;
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IEND', Buffer.alloc(0))]);
    const out = await readImageFacts(png, 'image/png');
    expect(out.errors).toEqual({});
    expect(out.facts).toMatchObject({ format: 'png', width: 3, height: 2, colorSpace: 'RGBA' });
  });
});

describe('the shape check', () => {
  it('refuses unclosed, crossed and too deep elements, and accepts normal depth', () => {
    expect(xmpIsBounded(packet('<a:b>'))).toBe(false);
    expect(xmpIsBounded(packet('<a:b><a:c></a:b></a:c>'))).toBe(false);
    expect(xmpIsBounded('<a:b>'.repeat(XMP_MAX_DEPTH + 1) + '</a:b>'.repeat(XMP_MAX_DEPTH + 1))).toBe(false);
    expect(xmpIsBounded('<a:b>'.repeat(10) + '</a:b>'.repeat(10))).toBe(true);
  });
});

describe('the arrival reader takes time in proportion to the packet', () => {
  it('a packet of many unclosed tags answers quickly, with an error and no XMP facts', async () => {
    const png = pngWithXmp(packet('<rdf:Description>' + '<a:b>'.repeat(32_000) + '</rdf:Description>'));
    const started = performance.now();
    const out = await readImageFacts(png, 'image/png');
    expect(performance.now() - started).toBeLessThan(150);
    expect(out.errors.xmp).toMatch(/XMP/);
    expect(out.facts.width).toBe(1);
  });
});
