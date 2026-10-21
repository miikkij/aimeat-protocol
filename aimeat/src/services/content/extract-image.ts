/**
 * @file src/services/content/extract-image.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a picture says about itself, read with exifr from its EXIF, IPTC, XMP and ICC
 *   segments and, for PNG, from the IHDR chunk: size, bit depth, colour, camera, exposure, the times
 *   it was taken and changed, the software, a GPS position when one is present, the creator and
 *   rights fields, an existing alt text, and the IPTC DigitalSourceType that provenance-read.ts maps
 *   to an AI verdict (types.ts ImageFacts).
 *
 *   exifr runs with reviveValues and translateValues off, so dates stay as the camera wrote them
 *   ("2024:05:01 12:00:00") and enumerations stay numbers. The dates are then rewritten to ISO 8601
 *   here, with the zone when an OffsetTime tag carries one, and without a zone otherwise, because a
 *   camera's local time with no offset is not a UTC instant.
 *
 *   A failure in exifr is recorded in `errors.exif` and the picture still gets its format and its
 *   size from the IHDR chunk or from sniffImage (services/openrouter.ts).
 * @structure readImageFacts · readSvgFacts · svgLength · webpMetadataAsJpeg · app1 · pngHeader · isoOf · textOf
 * @usage const { facts, digitalSourceType, software, errors } = await readImageFacts(bytes, 'image/png');
 * @version-history
 *   v1.2.0 — 2026-10-21 — SVG: its size, title and the XMP in <metadata> are read (readSvgFacts), with no
 *     exifr and no error. The other 112 pictures with "Unknown file format" on aimeat.io were SVG.
 *   v1.1.0 — 2026-10-21 — WebP: its EXIF and XMP chunks are read (webpMetadataAsJpeg), and a WebP with
 *     neither gets no error. 349 of 1157 pictures on aimeat.io were WebP and all got "Unknown file format".
 *   v1.0.0 — 2026-10-20 — Initial.
 */
import exifr from 'exifr';
import { sniffImage } from '../openrouter.js';
import type { ImageFacts } from './types.js';

type Seg = Record<string, unknown>;

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG colour type to a colour space name (PNG spec 11.2.2). */
const PNG_COLOR: Record<number, string> = { 0: 'Gray', 2: 'RGB', 3: 'Indexed', 4: 'GrayAlpha', 6: 'RGBA' };

/** EXIF ColorSpace values. */
const EXIF_COLOR: Record<number, string> = { 1: 'sRGB', 2: 'Adobe RGB', 65535: 'Uncalibrated' };

/** Width, height, bit depth and colour type from a PNG's IHDR chunk, read from the bytes. */
function pngHeader(b: Buffer): { width: number; height: number; bitDepth: number; colorType: number } | null {
  if (b.length < 29 || !b.subarray(0, 8).equals(PNG_SIG) || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), bitDepth: b[24], colorType: b[25] };
}

/**
 * A metadata value as one string: a string or number as is, an XMP language alternative's value,
 * an XMP list joined with ", ". Anything else gives undefined.
 */
function textOf(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    const parts = v.map(textOf).filter((x): x is string => !!x);
    return parts.length ? parts.join(', ') : undefined;
  }
  if (typeof v === 'object' && 'value' in (v as Seg)) return textOf((v as Seg).value);
  return undefined;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * An EXIF or XMP date as ISO 8601. "2024:05:01 12:00:00" with offset "+03:00" gives
 * "2024-05-01T12:00:00+03:00"; without an offset the zone is left off. An XMP date that is already
 * ISO is returned as it is. A value that does not parse is returned trimmed.
 */
function isoOf(v: unknown, offset?: unknown): string | undefined {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString();
  const s = textOf(v);
  if (!s) return undefined;
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (!m) return s;
  const zone = m[8] ?? (typeof offset === 'string' && /^[+-]\d{2}:\d{2}$/.test(offset.trim()) ? offset.trim() : '');
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}${m[7] ?? ''}${zone}`;
}

/** Exposure time as a photographer writes it: "1/250" under a second, "2" or "2.5" above. */
function exposureTimeOf(v: unknown): string | undefined {
  const n = num(v);
  if (n === undefined || n <= 0) return undefined;
  if (n >= 1) return String(Math.round(n * 10) / 10);
  return `1/${Math.round(1 / n)}`;
}

/** The EXIF Flash value as words: bit 0 says whether it fired. */
function flashOf(v: unknown): string | undefined {
  const n = num(v);
  if (n === undefined) return textOf(v);
  return (n & 1) ? 'fired' : 'did not fire';
}

const nonEmpty = <T extends object>(o: T): T | undefined =>
  (Object.values(o).some(v => v !== undefined) ? o : undefined);

/** Drops undefined keys so the facts record carries only what was read. */
function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as Array<keyof T>) if (o[k] === undefined) delete o[k];
  return o;
}

/** A length attribute of the <svg> element as a number of pixels; a percent or an em has none. */
function svgLength(v: string | undefined): number | undefined {
  const m = v ? /^\s*([\d.]+)\s*(px)?\s*$/i.exec(v) : null;
  return m ? Math.round(Number(m[1])) : undefined;
}

/**
 * What an SVG says about itself: its size (width and height, else the viewBox), its <title>, and
 * the IPTC DigitalSourceType and dc:title an XMP packet in its <metadata> carries.
 */
export function readSvgFacts(svg: string): { facts: ImageFacts; digitalSourceType?: string; software?: string; errors: Record<string, string> } {
  const facts: ImageFacts = { format: 'svg+xml' };
  const root = /<svg\b([^>]*)>/i.exec(svg)?.[1] ?? '';
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(root)?.[1];
  let width = svgLength(attr('width'));
  let height = svgLength(attr('height'));
  const box = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if ((!width || !height) && box?.length === 4 && box.every(Number.isFinite)) { width = width ?? Math.round(box[2]); height = height ?? Math.round(box[3]); }
  if (width) facts.width = width;
  if (height) facts.height = height;
  const title = /<title[^>]*>([^<]{1,300})<\/title>/i.exec(svg)?.[1]?.trim();
  if (title) facts.title = title;
  const meta = /<metadata[^>]*>([\s\S]*?)<\/metadata>/i.exec(svg)?.[1] ?? '';
  const dst = /DigitalSourceType(?:\s*=\s*["']([^"']+)["']|>\s*([^<\s]+)\s*<)/i.exec(meta);
  const tool = /CreatorTool(?:\s*=\s*["']([^"']+)["']|>\s*([^<]+?)\s*<)/i.exec(meta);
  return {
    facts, errors: {},
    ...(dst ? { digitalSourceType: (dst[1] ?? dst[2]).trim() } : {}),
    ...(tool ? { software: (tool[1] ?? tool[2]).trim() } : {}),
  };
}

/** One JPEG APP1 segment: its marker, its length (the two length bytes included) and its payload. */
function app1(payload: Buffer): Buffer | null {
  if (payload.length + 2 > 0xffff) return null;
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/**
 * A WebP's EXIF and XMP chunks as a JPEG holding only those segments, which exifr reads; null when
 * the WebP carries neither. RIFF chunks: a four-character id, a little-endian size, the data, padded
 * to an even length.
 */
export function webpMetadataAsJpeg(webp: Buffer): Buffer | null {
  const segments: Buffer[] = [];
  for (let at = 12; at + 8 <= webp.length;) {
    const id = webp.toString('latin1', at, at + 4);
    const size = webp.readUInt32LE(at + 4);
    const data = webp.subarray(at + 8, Math.min(webp.length, at + 8 + size));
    if (id === 'EXIF') {
      // Some writers keep the JPEG "Exif\0\0" prefix in the chunk, others start at the TIFF header.
      const tiff = data.toString('latin1', 0, 6) === 'Exif\0\0' ? data.subarray(6) : data;
      const seg = app1(Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]));
      if (seg) segments.push(seg);
    } else if (id === 'XMP ') {
      const seg = app1(Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), data]));
      if (seg) segments.push(seg);
    }
    at += 8 + size + (size % 2);
  }
  if (!segments.length) return null;
  return Buffer.concat([Buffer.from([0xff, 0xd8]), ...segments, Buffer.from([0xff, 0xd9])]);
}

/**
 * The facts a picture carries about itself.
 * @param {Buffer} bytes - The file.
 * @param {string} mimeType - Its MIME type; the format is the subtype ("png", "jpeg").
 * @returns {Promise<{facts: ImageFacts, digitalSourceType?: string, software?: string, errors: Record<string, string>}>}
 */
export async function readImageFacts(bytes: Buffer, mimeType: string): Promise<{
  facts: ImageFacts; digitalSourceType?: string; software?: string; errors: Record<string, string>;
}> {
  const errors: Record<string, string> = {};
  const mime = (mimeType || '').toLowerCase().split(';')[0].trim();
  // An SVG is XML, which exifr does not read: its size, title and any XMP in <metadata> are read here.
  if (mime === 'image/svg+xml' || /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(bytes.toString('utf8', 0, 2048))) {
    return readSvgFacts(bytes.toString('utf8'));
  }
  const sniff = sniffImage(bytes);
  const format = (mime.startsWith('image/') ? mime.slice(6) : sniff.mime?.slice(6)) || undefined;

  let out: Record<string, Seg> = {};
  // exifr does not read WebP. Its EXIF and XMP chunks are handed over as a JPEG that holds only
  // those two segments; a WebP that has neither is read for its size only, with no error.
  const isWebp = bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP';
  const source = isWebp ? webpMetadataAsJpeg(bytes) : bytes;
  if (source) try {
    const parsed: unknown = await exifr.parse(source, {
      tiff: true, ifd0: true, exif: true, gps: true, iptc: true, xmp: true, icc: true, ihdr: true,
      mergeOutput: false, reviveValues: false, translateValues: false, translateKeys: true,
    } as never);
    if (parsed && typeof parsed === 'object') out = parsed as Record<string, Seg>;
  } catch (err) {
    errors.exif = (err as Error).message || String(err);
  }

  const seg = (name: string): Seg => (out[name] && typeof out[name] === 'object' ? out[name] : {});
  const ifd0 = seg('ifd0');
  const exif = seg('exif');
  const gps = seg('gps');
  const iptc = seg('iptc');
  const icc = seg('icc');
  const ihdr = seg('ihdr');
  const dc = seg('dc');
  const xmp = seg('xmp');
  const photoshop = seg('photoshop');
  const core = seg('Iptc4xmpCore');
  const ext = seg('Iptc4xmpExt');
  const aux = seg('aux');
  const tiffXmp = seg('tiff');
  const exifXmp = seg('exifEX');
  const rights = seg('xmpRights');

  const png = pngHeader(bytes);
  const width = png?.width ?? num(exif.ExifImageWidth) ?? num(ifd0.ImageWidth) ?? num(ihdr.ImageWidth) ?? sniff.width;
  const height = png?.height ?? num(exif.ExifImageHeight) ?? num(ifd0.ImageHeight) ?? num(ihdr.ImageHeight) ?? sniff.height;

  const bits = ifd0.BitsPerSample ?? tiffXmp.BitsPerSample;
  const bitDepth = png?.bitDepth ?? num(ihdr.BitDepth)
    ?? (Array.isArray(bits) ? num(bits[0]) : num(bits) ?? (typeof bits === 'string' ? Number.parseInt(bits, 10) || undefined : undefined));

  const colorSpace = png ? PNG_COLOR[png.colorType]
    : (num(exif.ColorSpace) !== undefined ? EXIF_COLOR[num(exif.ColorSpace)!] : undefined) ?? textOf(icc.ColorSpaceData);

  const software = textOf(ifd0.Software) ?? textOf(xmp.CreatorTool);

  const facts: ImageFacts = compact({
    format,
    width,
    height,
    bitDepth,
    colorSpace,
    iccProfile: textOf(icc.ProfileDescription),
    orientation: num(ifd0.Orientation) ?? num(tiffXmp.Orientation),
    camera: nonEmpty(compact({
      make: textOf(ifd0.Make) ?? textOf(tiffXmp.Make),
      model: textOf(ifd0.Model) ?? textOf(tiffXmp.Model),
      lens: textOf(exif.LensModel) ?? textOf(aux.Lens) ?? textOf(exifXmp.LensModel),
      serial: textOf(exif.BodySerialNumber) ?? textOf(aux.SerialNumber),
    })),
    exposure: nonEmpty(compact({
      iso: num(exif.ISO) ?? (Array.isArray(exif.ISO) ? num(exif.ISO[0]) : undefined),
      fNumber: num(exif.FNumber),
      exposureTime: exposureTimeOf(exif.ExposureTime),
      focalLength: num(exif.FocalLength),
      flash: flashOf(exif.Flash),
    })),
    takenAt: isoOf(exif.DateTimeOriginal, exif.OffsetTimeOriginal) ?? isoOf(photoshop.DateCreated),
    createdAt: isoOf(exif.CreateDate, exif.OffsetTimeDigitized) ?? isoOf(xmp.CreateDate),
    modifiedAt: isoOf(ifd0.ModifyDate, exif.OffsetTime) ?? isoOf(xmp.ModifyDate),
    software,
    gps: num(gps.latitude) !== undefined && num(gps.longitude) !== undefined
      ? compact({
        lat: num(gps.latitude)!,
        lon: num(gps.longitude)!,
        altitude: num(gps.GPSAltitude) !== undefined ? (gps.GPSAltitudeRef === 1 ? -num(gps.GPSAltitude)! : num(gps.GPSAltitude)) : undefined,
      })
      : undefined,
    creator: textOf(dc.creator) ?? textOf(ifd0.Artist) ?? textOf(iptc.Byline),
    copyright: textOf(dc.rights) ?? textOf(ifd0.Copyright) ?? textOf(iptc.CopyrightNotice) ?? textOf(rights.UsageTerms),
    credit: textOf(photoshop.Credit) ?? textOf(iptc.Credit),
    title: textOf(dc.title) ?? textOf(iptc.ObjectName) ?? textOf(photoshop.Headline) ?? textOf(iptc.Headline),
    description: textOf(dc.description) ?? textOf(ifd0.ImageDescription) ?? textOf(iptc.Caption) ?? textOf(ihdr.Description),
    altText: textOf(core.AltTextAccessibility),
  });

  const digitalSourceType = textOf(ext.DigitalSourceType) ?? textOf(core.DigitalSourceType) ?? textOf(iptc.DigitalSourceType);
  const result: { facts: ImageFacts; digitalSourceType?: string; software?: string; errors: Record<string, string> } = { facts, errors };
  if (digitalSourceType) result.digitalSourceType = digitalSourceType;
  if (software) result.software = software;
  return result;
}
