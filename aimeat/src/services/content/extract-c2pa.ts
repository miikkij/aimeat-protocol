/**
 * @file src/services/content/extract-c2pa.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The C2PA manifest a file carries, read with @trustnxt/c2pa-ts (pure TypeScript, no
 *   native binary): whether a manifest is present, whether the library judges it valid, the claim
 *   generator, the signer from the signing certificate's subject, the title, the action names and the
 *   digital source types those actions declare. provenance-read.ts maps the source types to an AI
 *   verdict (types.ts AiMarks['c2pa']).
 *
 *   FORMATS. c2pa-ts reads JPEG, PNG, HEIC/HEIF, MP3 and MP4/BMFF. For any other format the answer is
 *   null, which means "not readable here", as opposed to `{ present: false }`, which means "readable,
 *   and no manifest". Chain of trust is not checked by the library, so `valid` says that the
 *   manifest's hashes and signature hold, not who is behind the certificate.
 *
 *   IN A WORKER. The library runs in a worker thread under the time and memory limits of
 *   media-read-bounded.ts (content_class.media_read_seconds, content_class.media_read_memory_mb), which
 *   also loads reflect-metadata before it, as tsyringe (loaded by @peculiar/x509) requires. The node's
 *   own thread never loads c2pa-ts.
 *
 *   NEVER THROWS, WITH ONE EXCEPTION. Any error after a manifest was found gives `{ present: true,
 *   error }` (a limit reached then included); any error before that gives null. A limit reached before
 *   the manifest was found throws MediaReadLimitReached, so the caller records why the file was not read.
 * @structure readC2pa · subjectName
 * @usage const c2pa = await readC2pa(bytes, mediaReadLimits(config)); // null | { present: false } | { present: true, ... }
 * @version-history
 *   v1.1.0 — 2026-11-01 — c2pa-ts runs in a worker under a time and a memory limit (media-read-bounded.ts);
 *     nested JUMBF superboxes made it copy the manifest once per level in the node's own thread
 *     (secaudit2026oct31w2 round 12, readC2pa:jumbf-superbox-nesting-quadratic-copy). The facts read
 *     are the same.
 *   v1.0.1 — 2026-10-20 — The hand-written Reflect metadata functions are replaced by the
 *     reflect-metadata package.
 *   v1.0.0 — 2026-10-20 — Initial.
 */
import { logger } from '../../utils/logger.js';
import { DEFAULT_MEDIA_READ_LIMITS, MediaReadLimitReached, readC2paBounded, type MediaReadLimits } from './media-read-bounded.js';
import type { AiMarks } from './types.js';

type C2paFacts = NonNullable<AiMarks['c2pa']>;

/** "CN=Example Signer, O=Example Ltd, C=FI" gives "Example Signer (Example Ltd)". */
function subjectName(subject: string | undefined): string | undefined {
  if (!subject) return undefined;
  const field = (name: string): string | undefined =>
    new RegExp(`(?:^|,\\s*)${name}=((?:\\\\,|[^,])+)`).exec(subject)?.[1]?.replace(/\\,/g, ',').trim();
  const cn = field('CN');
  const o = field('O');
  if (cn && o && cn !== o) return `${cn} (${o})`;
  return cn ?? o ?? subject;
}

const errText = (err: unknown): string => ((err as Error)?.message || String(err)).slice(0, 300);

/**
 * The C2PA manifest summary of a file.
 * @param {Buffer} bytes - The file.
 * @param {MediaReadLimits} [limits] - The time and memory limits of the read; the defaults when left out.
 * @returns {Promise<object|null>} null when c2pa-ts does not read the format; `{ present: false }`
 *   when it reads it and finds no manifest; otherwise the active manifest's summary.
 * @throws {MediaReadLimitReached} when a limit is reached before a manifest was found.
 */
export async function readC2pa(bytes: Buffer, limits: MediaReadLimits = DEFAULT_MEDIA_READ_LIMITS): Promise<C2paFacts | null> {
  let found = false;
  let answer;
  try {
    answer = await readC2paBounded(bytes, limits, () => { found = true; });
  } catch (err) {
    if (found) return { present: true, error: errText(err) };
    if (err instanceof MediaReadLimitReached) throw err;
    logger.debug(`[content] C2PA read failed: ${errText(err)}`);
    return null;
  }
  if ('load' in answer) {
    logger.warn(`[content] c2pa-ts did not load: ${answer.load}`);
    return null;
  }
  if ('unreadable' in answer) {
    // createAsset throws on any format it does not read; null is the documented answer for that.
    logger.debug(`[content] c2pa-ts does not read this format: ${answer.unreadable}`);
    return null;
  }
  if ('failed' in answer) {
    logger.debug(`[content] C2PA read failed: ${answer.failed}`);
    return null;
  }
  const { facts, subject } = answer;
  if (!facts.present) return { present: false };
  const out: C2paFacts = { present: true };
  if (facts.claimGenerator) out.claimGenerator = facts.claimGenerator as string;
  if (facts.title) out.title = facts.title;
  const signer = subjectName(subject);
  if (signer) out.signer = signer;
  if (facts.actions?.length) out.actions = facts.actions;
  if (facts.digitalSourceTypes?.length) out.digitalSourceTypes = facts.digitalSourceTypes;
  if (facts.valid !== undefined) out.valid = facts.valid;
  if (facts.error) out.error = facts.error;
  if (out.error && facts.valid === undefined) logger.debug(`[content] C2PA read failed: ${out.error}`);
  return out;
}
