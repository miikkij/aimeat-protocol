/**
 * @file src/utils/app-content-type.ts
 * @description The `Content-Type` a published AIMEAT app is served with, in one place — because the
 *   charset parameter has to be on ALL of them or the bug comes back on whichever one was missed.
 *
 *   THE BUG THIS FIXES, MEASURED. An app was served as bare `text/html`, with no charset parameter.
 *   HTML's encoding sniffing then falls back to the locale default (windows-1252 in western Europe),
 *   so every UTF-8 byte in the document arrived as mojibake unless the document happened to declare
 *   its own `<meta charset>` early enough. It had been shipping since v1.3.0 in July, and it surfaced
 *   only when a Finnish compliance string rendered as `TekoÃ¤lyn tuottama` — a legal disclosure a
 *   Finn cannot read (TARGET-058 Phase 3, audit proposal 1).
 *
 *   WHY DECLARING IT IS SAFE HERE, AND WHY IT WAS CHECKED FIRST. An HTTP charset OVERRIDES the
 *   document's own `<meta charset>`, so this is exactly the kind of change that can break somebody
 *   else's published work: an author who saw the mojibake and compensated would have stored
 *   double-encoded text that renders correctly TODAY and breaks the moment we tell the truth. So the
 *   corpus was scanned before the header was added — all 110 published apps on aimeat.io, against
 *   the raw stored bytes, with a decode test rather than a glyph signature (a glyph signature cannot
 *   tell `Ã¤` from a clean Finnish character class like `[ÅÄÖåäö]`, and produced exactly that false
 *   positive). Result: 0 double-encoded apps, 0 non-UTF-8 `<meta charset>` declarations, 108 of 110
 *   already declaring `utf-8` themselves, and 106 containing non-ASCII. The bytes we store are UTF-8
 *   by construction — they arrive as JavaScript strings through a JSON API — so declaring it is
 *   strictly correct, and it repairs the one app that declared no charset and does carry non-ASCII.
 * @structure appContentType(mimeType) — the mime type, with `charset=utf-8` added for text types
 *   that do not already carry a charset. Non-text types pass through untouched.
 * @usage
 *   import { appContentType } from '../utils/app-content-type.js';
 *   res.setHeader('Content-Type', appContentType(app.mimeType));
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 4 step 0a, after the corpus scan above.
 */

/** Text-ish types whose bytes we know are UTF-8, so the parameter states a fact rather than a hope. */
const TEXTUAL = /^(text\/|application\/(xhtml\+xml|xml|json|javascript|manifest\+json)|image\/svg\+xml)/i;

/**
 * `Content-Type` for a served app document.
 *
 * Adds `charset=utf-8` to a textual type that does not already declare one; leaves a type that
 * already names a charset exactly as it is (an author who stored `text/html; charset=iso-8859-1`
 * meant it, and silently retyping their document is the failure mode this file exists to avoid);
 * and passes binary types through untouched, where a charset parameter would be meaningless.
 */
export function appContentType(mimeType: string | undefined | null): string {
  const type = (mimeType ?? '').trim() || 'application/octet-stream';
  if (/;\s*charset\s*=/i.test(type)) return type;
  if (!TEXTUAL.test(type)) return type;
  return `${type}; charset=utf-8`;
}
