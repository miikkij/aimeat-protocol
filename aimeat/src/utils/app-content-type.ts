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
 *   AND THE LIMIT THAT ARGUMENT DOES NOT REACH. Everything above is true because app HTML is UTF-8
 *   BY CONSTRUCTION — it arrives as a JavaScript string through a JSON API, so there is no other
 *   thing it could be. STORED FILES ARE NOT. A person can upload a genuinely cp1252 `.txt` or
 *   `.csv`, and declaring `charset=utf-8` over it would corrupt a file that is served correctly
 *   today — the exact failure this file exists to avoid, pointed the other way. So the stored-file
 *   routes get sniffedContentType() instead: it reads the bytes, and declares UTF-8 only when the
 *   bytes ARE valid UTF-8. Anything else keeps the type it has, and today's behaviour with it.
 * @structure
 *   - appContentType(mimeType) — for content the NODE generates: the mime type, with `charset=utf-8`
 *     added for text types that do not already carry a charset. Non-text types pass through.
 *   - sniffedContentType(mimeType, bytes) — for USER-UPLOADED bytes: the same, but only after the
 *     bytes pass a UTF-8 decode test.
 *   - needsUtf8Verdict(mimeType) / isValidUtf8(bytes) — the two halves of that test, so a WRITE path
 *     can settle the question once instead of every read repeating it.
 *   - verifiedContentType(mimeType, utf8Verified) — the same answer from a stored verdict, for a
 *     response that does not have the whole file in hand.
 *
 *   WHY THE VERDICT IS STORED. Serving a byte range is the case that breaks the "read the bytes"
 *   design: the whole point of a range is not to load the file, and the whole file is exactly what
 *   the decode test wants. Loading 25 MB to answer an 8-byte request measured 181 ms against 3 ms for
 *   a database-side slice. So the decode test moved to the write, where the bytes are already in
 *   hand and the answer is a property of the file rather than of the request. A row from before this
 *   existed carries no verdict, and a range read of one still loads the file: the same answer as
 *   today at the same cost as today, and it settles itself the next time the file is written.
 * @usage
 *   import { appContentType, sniffedContentType, verifiedContentType } from '../utils/app-content-type.js';
 *   res.setHeader('Content-Type', appContentType(app.mimeType));                    // node-generated
 *   res.setHeader('Content-Type', sniffedContentType(file.mimeType, file.data));    // uploaded, bytes in hand
 *   res.setHeader('Content-Type', verifiedContentType(file.mimeType, file.utf8Verified)); // uploaded, metadata only
 * @version-history
 *   v1.2.0 — 2026-08-15 — TARGET-063: the decode test split out so a write can settle it once
 *     (needsUtf8Verdict / isValidUtf8) and a metadata-only response can read the answer back
 *     (verifiedContentType). sniffedContentType now delegates, so there is still ONE rule.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 5 step 0b: sniffedContentType() for the stored-file
 *     routes, with the node-generated / user-uploaded distinction the Phase 4 audit drew.
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

/**
 * `Content-Type` for bytes SOMEBODY UPLOADED, where the encoding is a fact to be established rather
 * than a property of how the content got here.
 *
 * The test is a strict UTF-8 decode of the whole file, which is the method the Phase 4 corpus scan
 * settled on after a glyph signature produced a false positive (it cannot tell `Ã¤` from a Finnish
 * character class like `[ÅÄÖåäö]`; a decode test can). Two outcomes, and both are safe:
 *
 * - **The bytes decode as UTF-8** → declare it. The declaration states what the bytes are, and it
 *   REPAIRS the file: without it a browser falls back to the locale default and shows mojibake.
 * - **They do not** → say nothing, and the file keeps being served exactly as it is served today.
 *   A genuinely cp1252 `.txt` is not retyped by us into something a reader cannot read.
 *
 * Pass the WHOLE file even when serving a byte range: a multi-byte character straddling a range
 * boundary would fail a decode of the chunk while the file is perfectly good UTF-8, and the header
 * describes the entity, not the slice.
 */
export function sniffedContentType(
  mimeType: string | undefined | null,
  bytes: Buffer | Uint8Array | undefined | null,
): string {
  if (!needsUtf8Verdict(mimeType)) return normalisedType(mimeType);
  if (!bytes) return normalisedType(mimeType);
  return verifiedContentType(mimeType, isValidUtf8(bytes));
}

/**
 * Would a UTF-8 verdict change how this type is served? False for a type that already names a
 * charset (the author said it and we do not overrule them) and for anything non-textual (a charset
 * on a PNG means nothing).
 *
 * A write path asks this FIRST, and skips the decode test entirely when the answer is no. That is
 * what keeps the cost off image and archive uploads: they never needed the test, and now they do
 * not pay for it.
 */
export function needsUtf8Verdict(mimeType: string | undefined | null): boolean {
  const type = normalisedType(mimeType);
  if (/;\s*charset\s*=/i.test(type)) return false;
  return TEXTUAL.test(type);
}

/**
 * Do these bytes decode as UTF-8, whole and strict?
 *
 * The decode test rather than a glyph signature, for the reason in the file header: a signature
 * cannot tell `Ã¤` from a clean Finnish `[ÅÄÖåäö]`, and produced exactly that false positive
 * against the real corpus.
 */
export function isValidUtf8(bytes: Buffer | Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    // The exception IS the answer. A fatal TextDecoder throws on exactly one condition, an invalid
    // UTF-8 sequence, and that condition is the question being asked. There is no failure here to
    // hide: false is a measured result rather than a fallback, and the caller stores it as one.
    // eslint-disable-next-line aimeat/no-silent-catch -- the throw is the measurement, see above
    return false;
  }
}

/**
 * The served `Content-Type` from a verdict somebody else established.
 *
 * `undefined` means NOT ESTABLISHED — a file stored before the verdict was recorded — and it is
 * treated exactly like `false`: say nothing, and serve the file the way it is served today. It is
 * never read as "not UTF-8", because a caller that knows the answer passes the boolean.
 */
export function verifiedContentType(mimeType: string | undefined | null, utf8Verified: boolean | undefined | null): string {
  const type = normalisedType(mimeType);
  if (!utf8Verified) return type;
  if (!needsUtf8Verdict(type)) return type;
  return `${type}; charset=utf-8`;
}

const normalisedType = (mimeType: string | undefined | null): string =>
  (mimeType ?? '').trim() || 'application/octet-stream';

/**
 * The verdict to STORE for a file being written. `null` when the type could not be changed by one
 * (an image, an archive, or a type whose author already named a charset), so nothing is computed
 * and nothing is recorded.
 *
 * Called by each storage provider from createStorageFile, which is the one door every write goes
 * through — sixteen call sites create files and none of them should have to know this rule exists.
 */
export function utf8VerdictFor(file: { mimeType: string; data: Buffer | Uint8Array }): boolean | null {
  if (!needsUtf8Verdict(file.mimeType)) return null;
  return isValidUtf8(file.data);
}
