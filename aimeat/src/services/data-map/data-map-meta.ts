/**
 * @file src/services/data-map/data-map-meta.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Read an app's own data-map declaration out of its HTML head.
 *
 *   `<meta name="aimeat-datamap" content="form=shared; areas=uutiset.*:rw:personal, prefs.*:rw;
 *   doc=apps.uutiset.datamap">`
 *
 *   WHAT FITS HERE AND WHAT DOES NOT. The meta tag carries the machine-readable skeleton: the shape
 *   of the program, the area patterns with their rights, and a pointer to the document. It does NOT
 *   carry the `why` sentence per row, the deletion answers, retention prose, or the whole
 *   "elsewhere" table — those are paragraphs, one per row, and a `content=` attribute is the wrong
 *   container for a paragraph. Those live in a memory record under a key prefix, which is where this
 *   project puts a feature's data, and `appToolsKey` is the precedent for an app-level side document.
 *
 *   Malformed input returns null and NEVER throws, exactly as `parseAiPosture` does: a mistyped
 *   declaration must not be able to stop a publish. The publish check turns the silence into a
 *   finding, which is a message the builder can act on; an exception is a 500 nobody can.
 * @structure DeclaredDataMapMeta · parseDataMapMeta(html) · formatDataMapMeta(decl)
 * @usage import { parseDataMapMeta } from './data-map-meta.js';
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial creation for TARGET-073 step 3.
 */
import { DATA_MAP_FORMS, type DataMapForm } from './data-map-types.js';

/** Only the head-ish part of a big file, matching parseAppScopes and parseAiPosture. */
const SCAN_BYTES = 64 * 1024;

export interface DeclaredArea {
  /** The key or path pattern, e.g. `uutiset.*`. Kept verbatim; it is the row's address. */
  pattern: string;
  rights: ('read' | 'write')[];
  /** Only ever 'yes' or 'unstated' here — a meta tag can say a thing holds personal data, and
   *  silence in a compact attribute is not a considered "no". Saying no is done in the document. */
  personalData: 'yes' | 'unstated';
  /** Which store, when the pattern says so. Defaults to memory. */
  area: string;
}

export interface DeclaredDataMapMeta {
  form: DataMapForm;
  areas: DeclaredArea[];
  /** The memory key holding the full document, when the app named one. */
  doc?: string;
}

/**
 * Read the declaration. Returns null when the app declares none or the value is unreadable.
 *
 * A tag that names a form but no areas is still a declaration — it says "this is a group program"
 * and leaves the rows to the document, which is a legitimate way to write it.
 */
export function parseDataMapMeta(html: string): DeclaredDataMapMeta | null {
  const metas = html.slice(0, SCAN_BYTES).match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metas) {
    if (!/name\s*=\s*["']aimeat-datamap["']/i.test(tag)) continue;
    const m = /content\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (!m) continue;

    const parts = new Map<string, string>();
    for (const chunk of m[1].split(';')) {
      const eq = chunk.indexOf('=');
      if (eq < 0) continue;
      parts.set(chunk.slice(0, eq).trim().toLowerCase(), chunk.slice(eq + 1).trim());
    }

    const rawForm = (parts.get('form') ?? '').toLowerCase();
    const form = (DATA_MAP_FORMS as readonly string[]).includes(rawForm)
      ? rawForm as DataMapForm
      : 'mixed';

    const areas: DeclaredArea[] = [];
    for (const entry of (parts.get('areas') ?? '').split(',')) {
      const area = parseArea(entry.trim());
      if (area) areas.push(area);
    }

    const doc = parts.get('doc');
    return { form, areas, ...(doc ? { doc } : {}) };
  }
  return null;
}

/** `uutiset.*:rw:personal` → one area. A part this function cannot read is skipped, not fatal. */
function parseArea(entry: string): DeclaredArea | null {
  if (!entry) return null;
  const bits = entry.split(':');
  // `organism:ws-x/notes.*:rw` — a leading store name is allowed, and only these four exist.
  let area = 'memory';
  if (bits.length >= 2 && ['memory', 'storage', 'knowledge', 'organisms'].includes(bits[0].toLowerCase())) {
    area = bits.shift()!.toLowerCase();
  }
  const pattern = (bits.shift() ?? '').trim();
  if (!pattern) return null;

  const rightsWord = (bits.shift() ?? 'r').toLowerCase();
  const rights: ('read' | 'write')[] = [];
  if (rightsWord.includes('r')) rights.push('read');
  if (rightsWord.includes('w')) rights.push('write');
  if (rights.length === 0) rights.push('read');

  const flag = (bits.shift() ?? '').toLowerCase();
  return {
    pattern,
    rights,
    personalData: flag === 'personal' ? 'yes' : 'unstated',
    area,
  };
}

/**
 * Write the declaration back out, so a publish hint can hand a builder the exact line to paste.
 *
 * A hint that describes the fix in prose gets read and not applied; a hint that IS the fix gets
 * pasted. Same reason the AI-posture hint spells out its whole meta tag.
 */
export function formatDataMapMeta(decl: DeclaredDataMapMeta): string {
  const areas = decl.areas.map(a => {
    const rights = `${a.rights.includes('read') ? 'r' : ''}${a.rights.includes('write') ? 'w' : ''}` || 'r';
    const prefix = a.area && a.area !== 'memory' ? `${a.area}:` : '';
    const personal = a.personalData === 'yes' ? ':personal' : '';
    return `${prefix}${a.pattern}:${rights}${personal}`;
  }).join(', ');
  const doc = decl.doc ? `; doc=${decl.doc}` : '';
  return `<meta name="aimeat-datamap" content="form=${decl.form}; areas=${areas}${doc}">`;
}
