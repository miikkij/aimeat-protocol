/**
 * @file src/services/app-book-parts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a publish does for a page that says which Design Book parts it was built from.
 *
 *   Measured on 2026-09-20, three builds: two read a Design Book fill and built their working
 *   screen from it, and none made the two calls the specification asked for afterwards
 *   (aimeat_designbook_adopt to record the use, aimeat_app_ui_set to store the arrangement). A
 *   builder stops when the app is live. So the Book's counters stayed at zero for parts that WERE
 *   used, and the owner's AI could not rearrange a screen whose arrangement lived only in the
 *   page's code. Two calls a builder is measured to forget are two calls the publish makes.
 *
 *   THE PAGE SAYS IT, THE PUBLISH ACTS ON IT:
 *
 *     <meta name="aimeat-book-parts" content="leiska-dashboard ambient-dust">
 *     <script type="application/json" id="aimeat-layout">{ "v": 1, "blocks": [ … ] }</script>
 *
 *   The meta counts each named part once for this app (a republish does not count again). The
 *   JSON block, which the page also hands its mosaic as `fallback`, becomes the app's stored
 *   arrangement ON ITS FIRST PUBLISH ONLY: once an arrangement is stored it is the owner's, and a
 *   later publish never writes over what they or their AI arranged.
 *
 *   NOTHING HERE REFUSES A PUBLISH. An unknown part, a part not published yet, or a layout the
 *   validator refuses comes back as a line the publish answer carries.
 * @structure bookPartsDeclared(html) · layoutDeclared(html) · recordBookParts(...)
 * @usage const book = await recordBookParts(storage, config, { ownerName, callerGaii, filename, html, provenance });
 * @version-history
 *   v1.1.0 — 2026-09-20 — The builder's REASONS ride the same publish (#aimeat-build-notes,
 *     app-build-notes.ts → design-book/reasons.ts): what it took, what it passed over and what it
 *     made by hand, each with why. A page that names parts and gives no reasons is asked for them.
 *   v1.0.0 — 2026-09-20 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { AppUiService, type WriteProvenance } from './app-ui/service.js';
import { DesignBookService } from './design-book/service.js';
import { DesignBookReasons } from './design-book/reasons.js';
import { buildNotesDeclared } from './app-build-notes.js';
import { declaredLevel } from './app-build-level-meta.js';
import { logger } from '../utils/logger.js';

const HEAD_BYTES = 8192;
const MAX_PARTS = 12;

const registerOf = (html: string): string | null =>
  /<meta\b[^>]*name\s*=\s*["']aimeat-register["'][^>]*content\s*=\s*["']([^"']*)["']/i.exec(html.slice(0, HEAD_BYTES))?.[1]?.trim() || null;

/** The part ids the page names, in order, without repeats. */
export function bookPartsDeclared(html: string): string[] {
  const content = /<meta\b[^>]*name\s*=\s*["']aimeat-book-parts["'][^>]*content\s*=\s*["']([^"']*)["']/i
    .exec(html.slice(0, HEAD_BYTES))?.[1] ?? '';
  return [...new Set(content.split(/[\s,]+/).map(s => s.trim()).filter(s => /^[a-z0-9][a-z0-9-]{1,79}$/.test(s)))].slice(0, MAX_PARTS);
}

/** The arrangement the page carries as data, or null; `error` when the block is there and does not parse. */
export function layoutDeclared(html: string): { layout: unknown } | { error: string } | null {
  const raw = /<script\b[^>]*\bid\s*=\s*["']aimeat-layout["'][^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1];
  if (raw === undefined) return null;
  try {
    return { layout: JSON.parse(raw) };
  } catch (err) {
    return { error: `The #aimeat-layout block is not JSON: ${(err as Error).message}` };
  }
}

export interface BookPartsResult {
  counted: string[];
  already: string[];
  unknown: string[];
  /** Whether the page's arrangement became the app's stored one on this publish. */
  layout: 'stored' | 'kept-existing' | 'none' | 'refused';
  /** The builder's reasons this version wrote down (#aimeat-build-notes), by list, and whether the Book heard them. */
  reasons?: { took: number; passed: number; made: number; shared: boolean };
  notes: string[];
}

export async function recordBookParts(
  storage: Storage, config: AimeatConfig,
  input: {
    ownerName: string; ownerGaii: string; filename: string; html: string; provenance: WriteProvenance;
    /** The version this publish made, and whether anybody may open the app (not parked, no access code). */
    version: number; shareable: boolean;
  },
): Promise<BookPartsResult | undefined> {
  const written = buildNotesDeclared(input.html);
  // A part the notes say was TAKEN is a part the page names, whether or not the meta repeats it.
  const ids = [...new Set([...bookPartsDeclared(input.html), ...(written?.notes.took.map(n => n.part) ?? [])])];
  const declared = layoutDeclared(input.html);
  if (!ids.length && !declared && !written) return undefined;

  const result: BookPartsResult = { counted: [], already: [], unknown: [], layout: 'none', notes: [] };
  // Best-effort by construction: the app is already published, and a counter must never undo that.
  try {
    if (ids.length) {
      const use = await new DesignBookService(storage, config).recordUse(`${input.ownerName}/${input.filename}`, ids);
      Object.assign(result, use);
      if (use.unknown.length) {
        result.notes.push(`The page names Design Book parts this node does not hold as published: ${use.unknown.join(', ')}. `
          + 'Check the ids against the list (aimeat_designbook_search given nothing), or take the name out.');
      }
    }
    // Measured the day this shipped: three builds took one fill from the Book, all three carried
    // the layout as data, and one of the three named the part. The layout without the name is a
    // use the Book never hears about, and the publish answer is the one text a builder acts on.
    if (declared && !ids.length) {
      result.notes.push('This page carries its arrangement (#aimeat-layout) and names no Design Book part. If the arrangement started from one, '
        + 'name it and publish again, so the Book knows the part is used: <meta name="aimeat-book-parts" content="<part id>">. '
        + 'If you arranged it from nothing, say so in the build notes (`made`, with why no fill in the Book was near): it is a fill the next app could start from, '
        + 'and it is offered to the Book when the owner is satisfied with this app, not because the build is finished.');
    }
    // The reasons, written down with the version they belong to (design-book/reasons.ts). A page
    // that names parts or carries a layout and says nothing about WHY is asked for it: a count
    // with no reason says an AI favoured a part, and nothing about whether the part is any good.
    if (written) {
      result.notes.push(...written.problems);
      result.reasons = await new DesignBookReasons(storage, config).record({
        ownerGhii: input.ownerGaii, ownerName: input.ownerName, filename: input.filename, version: input.version,
        notes: written.notes, level: declaredLevel(input.html) ?? null, register: registerOf(input.html), shareable: input.shareable,
      });
    } else {
      result.notes.push('This page says what it took from the Design Book and not WHY. Add the reasons while you still have them, in one block: '
        + '<script type="application/json" id="aimeat-build-notes">{ "took": [{ "part": "<id>", "why": "<what made it fit>" }], '
        + '"passed": [{ "part": "<id>", "why": "<what made it not fit>" }], "made": [{ "name": "<short-name>", "what": "<what it is>", "why": "<why the Book had nothing for it>" }] }</script>. '
        + 'One sentence each. `passed` and `made` are what the Book grows from.');
    }
    if (declared && 'error' in declared) {
      result.layout = 'refused';
      result.notes.push(declared.error);
    } else if (declared) {
      const apps = new AppUiService(storage, config);
      const current = await apps.read(input.ownerGaii, input.filename);
      if (current.layout) {
        result.layout = 'kept-existing';
      } else {
        await apps.write(input.ownerGaii, input.filename, declared.layout, input.provenance);
        result.layout = 'stored';
      }
    }
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    if (declared && result.layout === 'none') {
      result.layout = 'refused';
      result.notes.push(`The page's #aimeat-layout was not stored as the app's arrangement: ${message}`);
    } else {
      logger.warn('[app-book-parts] recording failed', { filename: input.filename, error: message });
    }
  }
  return result;
}
