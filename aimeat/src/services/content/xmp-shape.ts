/**
 * @file src/services/content/xmp-shape.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether exifr may parse an XMP packet in time proportional to its size.
 *
 *   exifr 7 finds XMP elements with a backtracking pattern that, for every `<prefix:name ...>` opening,
 *   searches lazily for its `</prefix:name>`, and then repeats that inside each element it found. On a
 *   well-formed packet of normal depth that is a few passes over the text. An opening that never
 *   closes makes the search run to the end of the text, once per such opening, and a deep nesting
 *   makes it repeat once per level: measured 2026-10-27 on a PNG iTXt packet, 2000, 4000 and 8000
 *   unclosed tags took 4, 11 and 55 ms, so a 1 MB packet takes tens of seconds on the node's one event
 *   loop. The content pipeline reads every stored picture on arrival (secaudit2026oct26,
 *   readImageFacts:superlinear-svg-and-xmp-patterns-on-arrival).
 *
 *   xmpIsBounded walks the packet once: every prefixed opening closes with the same name, in order,
 *   no deeper than XMP_MAX_DEPTH. XMP is XML, so every packet a real writer makes passes, and its facts
 *   are read exactly as before; a packet that fails is not handed to exifr's XMP parser.
 * @structure XMP_MAX_DEPTH · xmpIsBounded
 * @usage if (xmpIsBounded(raw)) { ...parse it with exifr... }
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26).
 */

/** How deep prefixed XMP elements may nest. Real packets nest about six deep (x:xmpmeta, rdf:RDF, rdf:Description, a property, rdf:Seq, rdf:li). */
export const XMP_MAX_DEPTH = 32;

const NAME_CHAR = /[\w-]/;

/** The `prefix:name` that starts at `at`, or null when the text there is not one. */
function prefixedName(xmp: string, at: number): { name: string; end: number } | null {
  let i = at;
  while (i < xmp.length && NAME_CHAR.test(xmp[i]!)) i++;
  if (i === at || xmp[i] !== ':') return null;
  let j = i + 1;
  while (j < xmp.length && NAME_CHAR.test(xmp[j]!)) j++;
  if (j === i + 1) return null;
  return { name: xmp.slice(at, j), end: j };
}

/**
 * True when every prefixed element in the packet closes, with the same name and in order, and none
 * nests deeper than XMP_MAX_DEPTH. One pass; quoted attribute values may hold '>'.
 */
export function xmpIsBounded(xmp: string): boolean {
  const open: string[] = [];
  let at = xmp.indexOf('<');
  while (at >= 0) {
    const closing = xmp[at + 1] === '/';
    const tag = prefixedName(xmp, at + (closing ? 2 : 1));
    if (!tag) { at = xmp.indexOf('<', at + 1); continue; }
    // The end of the tag: the first '>' outside a quoted value.
    let i = tag.end;
    let quote = '';
    for (; i < xmp.length; i++) {
      const c = xmp[i]!;
      if (quote) { if (c === quote) quote = ''; } else if (c === '"' || c === '\'') quote = c; else if (c === '>') break;
    }
    if (i >= xmp.length) return false;
    if (closing) {
      if (open.pop() !== tag.name) return false;
    } else if (xmp[i - 1] !== '/') {
      open.push(tag.name);
      if (open.length > XMP_MAX_DEPTH) return false;
    }
    at = xmp.indexOf('<', i + 1);
  }
  return open.length === 0;
}
