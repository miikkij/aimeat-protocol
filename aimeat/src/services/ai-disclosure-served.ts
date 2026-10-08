/**
 * @file src/services/ai-disclosure-served.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two pure helpers around disclosureFor(): which `aiLabel.*` words a decision is shown
 *   in, by the record's medium, and the surface a STORED record is decided against when an item is
 *   served.
 *
 *   WHY THE SERVE-TIME SURFACE IS BUILT HERE. A record's disclosure block is decided once, at mint,
 *   against the surface the item had then. An item that becomes public later (a visibility-only
 *   update, an access code removed, a private file made public) kept the block that said "no label
 *   owed". Every surface that serves a record now decides again, against the item as it is served,
 *   and this is the one place that says what that decision may still learn from the stored block:
 *   the publisher's own declarations, which only the stored reason remembers.
 * @structure
 *   - disclosureWording(record, ctx, reason, hasReviewer) — the short and long i18n keys
 *   - servedContext(record, served) — the SurfaceContext for a serve-time decision
 *   - ServedSurface — what a serving route knows about the item it serves
 * @usage
 *   const ctx = servedContext(record, { visibility: 'public' });
 *   const d = disclosureFor(record, ctx, config.aiLabelPublic);
 * @version-history
 *   v1.0.1 — 2026-10-08 — A reviewed app (code) keeps "AI-drafted, reviewed by X" (Jouni, 2026-09-26).
 *   v1.0.0 — 2026-10-08 — Wording by medium (image, audio, video, app, data, transcript), and the
 *     serve-time surface. Reported by originalmiskate.com: a public speech clip read "This text was
 *     written by AI", and a record made public after mint kept `required: false`.
 */
import type { AiProvenance, AiDisclosureReason, AiMediaKind } from '../models/ai-provenance-schemas.js';
import type { SurfaceContext } from './ai-disclosure.js';

/** What a serving route knows about the item it serves. Every member is optional. */
export interface ServedSurface {
  /** The item's visibility as served. Absent: the caller asks the live visibility predicate. */
  visibility?: SurfaceContext['visibility'];
  /** The item's medium, used only when the record does not state its own. */
  mediaKind?: AiMediaKind;
  /** The publisher's public-interest declaration, when the item carries one (an app's posture). */
  publicInterest?: SurfaceContext['publicInterest'];
}

const reviewedBy = (r: AiProvenance): boolean =>
  r.humanInvolvement === 'editorial-control' || r.humanInvolvement === 'full-human';

/**
 * The surface a stored record is decided against when its item is served.
 *
 * The visibility, and the medium, come from the item. The publisher's declarations do not travel
 * with the item, so they are read back from the reason the record was minted with, and from nothing
 * else:
 *   - `art50_4_public_interest` was recorded only when public interest was declared `yes`;
 *   - `policy` on content nobody reviewed was recorded only when public interest was declared `no`
 *     (editorial responsibility is never declared at mint, only at serve);
 *   - `art50_1_interaction` was recorded only for a live exchange with a model.
 * A `none` minted against a private surface cannot say whether `no` was declared, so it reads as
 * not stated, which labels (decision D4 over-labels on purpose).
 */
export function servedContext(
  record: AiProvenance, served: ServedSurface & { visibility: SurfaceContext['visibility'] },
): SurfaceContext {
  const reason = record.disclosure?.reason;
  const minted: SurfaceContext['publicInterest'] = reason === 'art50_4_public_interest' ? 'yes'
    : reason === 'policy' && !reviewedBy(record) ? 'no' : undefined;
  const publicInterest = served.publicInterest ?? minted;
  return {
    visibility: served.visibility,
    // The record travels to whoever reads it; whether a person is reading is the renderer's
    // question, and the block answers it for a person.
    humanAudience: true,
    ...(record.mediaKind === undefined && served.mediaKind ? { mediaKind: served.mediaKind } : {}),
    ...(publicInterest ? { publicInterest } : {}),
    ...(reason === 'art50_1_interaction' ? { interactive: true } : {}),
  };
}

/**
 * The `aiLabel.*` keys a decision is shown in.
 *
 * Text keeps the words it always had. Other media say what they are: a picture is "this image",
 * a sound "this audio". Image, audio and video made or changed by a model keep the synthetic-media
 * sentence even when a person reviewed them, because review does not lift the deep-fake duty, and
 * a reviewed sentence beside a deep-fake label would understate it. A record that does not state
 * its medium (every record minted before 2026-10-08) keeps the words such a record always had,
 * except the one sentence that claimed "This text": a model-made item nobody reviewed gets the
 * medium-neutral sentence. `short` is the same chip on every medium.
 */
export function disclosureWording(
  record: AiProvenance, ctx: SurfaceContext, reason: AiDisclosureReason, hasReviewer: boolean,
): { shortKey: string; longKey: string } {
  const medium = ctx.mediaKind ?? record.mediaKind;
  const text = medium === 'text' || medium === undefined;
  // A reviewed app keeps the reviewer wording ruled on 2026-09-26, "AI-drafted, reviewed by X":
  // code is drafted, as text is. "Made with AI" is for media a model made whole.
  const drafted = text || medium === 'code';
  const reviewed = reviewedBy(record);

  if (reason === 'art50_1_interaction') return { shortKey: 'aiLabel.short', longKey: 'aiLabel.chat' };

  if (reason === 'policy') {
    // Labelled beyond the law. The words must not overstate: this content was either reviewed by a
    // person or declared outside the public-interest limb, so it gets the neutral "a model was
    // involved" wording rather than the "no human editorial review" statement. And the chip itself
    // says the review when there was one: "AI-generated" beside "a person reviewed it" was the
    // label a reviewed board deck still carried on 2026-09-25.
    const declaredReview = ctx.editorialResponsibility === true || reviewed;
    const shortKey = record.level === 'assisted' ? 'aiLabel.assisted'
      : declaredReview && hasReviewer ? (drafted ? 'aiLabel.reviewed' : 'aiLabel.reviewedMade')
      : declaredReview ? (drafted ? 'aiLabel.reviewedShort' : 'aiLabel.reviewedMadeShort') : 'aiLabel.short';
    return { shortKey, longKey: 'aiLabel.policyLong' };
  }

  if (record.level === 'original') {
    return text ? { shortKey: 'aiLabel.original', longKey: 'aiLabel.originalLong' }
      : { shortKey: 'aiLabel.originalMedia', longKey: 'aiLabel.originalMediaLong' };
  }
  if (record.level === 'assisted') {
    return { shortKey: 'aiLabel.assisted', longKey: text ? 'aiLabel.assistedLong' : 'aiLabel.assistedMediaLong' };
  }

  // ai-generated or synthesized from here on.
  if (medium === 'image') return { shortKey: 'aiLabel.short', longKey: 'aiLabel.syntheticImageLong' };
  if (medium === 'audio') return { shortKey: 'aiLabel.short', longKey: 'aiLabel.syntheticAudioLong' };
  if (medium === 'video') return { shortKey: 'aiLabel.short', longKey: 'aiLabel.syntheticVideoLong' };
  if (reviewed) {
    return { shortKey: 'aiLabel.short', longKey: drafted ? 'aiLabel.reviewedGeneric' : 'aiLabel.reviewedMediaLong' };
  }
  const longKey = medium === 'text' ? (record.method === 'transcribed' ? 'aiLabel.transcriptLong' : 'aiLabel.publicText')
    : medium === 'code' ? 'aiLabel.generatedAppLong'
    : medium === 'data' ? 'aiLabel.generatedDataLong'
    : 'aiLabel.generatedContentLong';
  return { shortKey: 'aiLabel.short', longKey };
}
