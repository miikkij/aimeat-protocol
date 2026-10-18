/**
 * @file src/services/provenance-embed/xmp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The XMP packet a file carries about how it was made: the IPTC `DigitalSourceType`
 *   (the field image tools, search engines and social platforms read to label AI content) and, in the
 *   node's own namespace, the provenance records it was made from, each with its address. Built once
 *   here and written into PNG, JPEG, PDF and CBZ by the sibling modules.
 * @structure EmbedFacts · buildXmp · AIMEAT_XMP_NS
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (Comicland v3 A-8).
 */

import { escapeHtml } from '../../utils/html-escape.js';

/** The node's XMP namespace for the provenance records a file was made from. */
export const AIMEAT_XMP_NS = 'https://aimeat.io/ns/provenance/1.0/';

/** What a file says about itself. */
export interface EmbedFacts {
  /** The IPTC digital source type URI, from services/ai-provenance-adapters.ts (toIptc, iptcComposite). */
  digitalSourceType: string;
  /** One sentence a person reads in a file viewer. */
  description: string;
  /** The records the content was made from. */
  records: Array<{ id: string; url: string; level: string; model?: string; mediaKind?: string }>;
  /** When the file was marked, ISO 8601. */
  markedAt: string;
  /** The node that marked it, e.g. "AIMEAT aimeat.io". */
  tool: string;
}

/** XML text and attribute values are escaped as HTML is: the five characters (utils/html-escape.ts). */
const esc = (s: string): string => escapeHtml(s);

/** The XMP packet, UTF-8, with the padding readers expect so the packet can be edited in place. */
export function buildXmp(facts: EmbedFacts): string {
  const records = facts.records.map(r =>
    `<rdf:li rdf:parseType="Resource"><aimeat:id>${esc(r.id)}</aimeat:id><aimeat:url>${esc(r.url)}</aimeat:url>`
    + `<aimeat:level>${esc(r.level)}</aimeat:level>${r.model ? `<aimeat:model>${esc(r.model)}</aimeat:model>` : ''}`
    + `${r.mediaKind ? `<aimeat:mediaKind>${esc(r.mediaKind)}</aimeat:mediaKind>` : ''}</rdf:li>`).join('');
  return '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'
    + '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    + '<rdf:Description rdf:about=""'
    + ' xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"'
    + ' xmlns:dc="http://purl.org/dc/elements/1.1/"'
    + ' xmlns:xmp="http://ns.adobe.com/xap/1.0/"'
    + ` xmlns:aimeat="${AIMEAT_XMP_NS}">`
    + `<Iptc4xmpExt:DigitalSourceType>${esc(facts.digitalSourceType)}</Iptc4xmpExt:DigitalSourceType>`
    + `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${esc(facts.description)}</rdf:li></rdf:Alt></dc:description>`
    + `<xmp:CreatorTool>${esc(facts.tool)}</xmp:CreatorTool>`
    + `<xmp:MetadataDate>${esc(facts.markedAt)}</xmp:MetadataDate>`
    + `<aimeat:records><rdf:Bag>${records}</rdf:Bag></aimeat:records>`
    + '</rdf:Description></rdf:RDF></x:xmpmeta>'
    + `${' '.repeat(100)}\n`.repeat(20)
    + '<?xpacket end="w"?>';
}
