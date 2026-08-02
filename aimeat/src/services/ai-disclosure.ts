/**
 * @file src/services/ai-disclosure.ts
 * @description disclosureFor() — the ONE function that decides whether a visible AI disclosure is
 *   owed, and how strong it should be. Nothing else may decide this. The label component renders
 *   what this returns; when the guidance changes, this function changes and no UI does.
 *
 *   THE SENTENCE THAT DRIFTS, kept here in the words the Guidelines use:
 *   **only a step where a person reads the substance and can reject it upgrades `humanInvolvement`.
 *   Clicking publish is not that step.** The 20 July 2026 Guidelines are explicit that superficial
 *   checks do not count as review, which is why `light-review` sits on the labelled side of the line
 *   and `editorial-control` does not. That single boundary is what this whole function turns on.
 *
 *   WHAT IT DOES NOT DO. It does not decide machine-readable marking. Art. 50(2) marking is
 *   satisfied by the provenance record existing and being served on the machine planes, which
 *   happens whether or not a visible label is owed — so `art50_2_synthetic_output` is a reason the
 *   vocabulary carries but this function never returns.
 *
 *   ABSENCE CREATES NO OBLIGATION — AND NO DENIAL. Unstated provenance returns "not required": we
 *   cannot owe a disclosure about content we know nothing about. That is not the same as saying a
 *   human wrote it. If a surface chooses to show a badge anyway, toEuIcon() gives it the honest
 *   "origin unstated" one. Obligation and rendering are deliberately separate questions.
 * @structure
 *   - SurfaceContext — what the surface knows about itself
 *   - DisclosureLabelPolicy — the node's posture (AIMEAT_AI_LABEL_PUBLIC)
 *   - DisclosureDecision — { required, reason, strength }
 *   - disclosureFor(p, ctx, policy) — the decision, in the order the rules apply
 * @usage
 *   import { disclosureFor } from './ai-disclosure.js';
 *   const d = disclosureFor(record, { visibility: 'public', humanAudience: true }, config.aiLabelPublic);
 * @version-history
 *   v1.3.0 — 2026-08-02 — The recorded REASON splits from the label. An absent or `unknown`
 *     publicInterest still labels (D4 over-labels on purpose) but now records
 *     `art50_4_precautionary` instead of asserting Article 50(4)'s text limb. It had been
 *     asserted on everything — a dice game included — because no caller ever passed the field,
 *     which also made a declared public-interest=yes unreadable: it produced a record identical
 *     to saying nothing. The label a reader sees is byte-identical in both cases.
 *   v1.2.0 — 2026-08-01 — TARGET-058 Phase 3. AIMEAT_AI_LABEL_PUBLIC arrives as a third parameter,
 *     which is what finally makes the `policy` reason reachable: `strict` labels the three cases the
 *     law exempts (editorial control on the record, editorial responsibility declared at publication,
 *     publicInterest declared `no`), always at LIGHT strength and only on an anonymously readable
 *     surface. `off` suppresses content labels and NOT the Art. 50(1) conversation disclosure.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 2. `assisted` + `none`/`light-review` on a public-interest
 *     surface now owes a LIGHT label instead of none (22-frozen-vocabulary.md §C2b, overriding the
 *     literal reading of Art. 50(4) that Phase 1 implemented).
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 1. Rules from docs/internal/EUAct/06-platform-design.md
 *     §4 and decision D4 (over-labelling) in 21-decisions-2026-08-01.md.
 */
import { asKnownProvenance, type MaybeAiProvenance, type AiDisclosureReason } from '../models/ai-provenance-schemas.js';

export type DisclosureStrength = 'full' | 'light' | 'none';

/**
 * The node's visible-label posture (`AIMEAT_AI_LABEL_PUBLIC`). It governs PRESENTATION only — the
 * record is minted, the headers are set and the machine planes carry the mark whatever this says.
 *
 * `light` is the neutral value and therefore the default parameter: it means "the law, exactly".
 * `strict` is the shipped default of the CONFIG, because decision D4 is to over-label rather than
 * sit on the line. The two defaults differ on purpose — a caller that forgot to pass the policy
 * gets the letter of the law, never more than the operator asked for.
 */
export type DisclosureLabelPolicy = 'strict' | 'light' | 'off';

/** What the surface serving the content knows about itself. */
export interface SurfaceContext {
  /** How the item is reachable. `public` = anonymously readable. */
  visibility: 'private' | 'owner' | 'group' | 'workspace' | 'members' | 'public';
  /** Is a natural person the audience HERE? `false` = machine-to-machine (MCP, API, feed). */
  humanAudience: boolean;
  /**
   * Does the surface concern matters of public interest? Over-labelling is the default (D4):
   * `unknown` and absent are both treated as YES for anonymously readable text. A publisher may
   * declare `no`, and that declaration is an attributable act they carry — the node never infers it.
   */
  publicInterest?: 'yes' | 'no' | 'unknown';
  /**
   * The publisher has DECLARED editorial responsibility for this item at publication time.
   *
   * This exists because the record's `humanInvolvement` is what the node OBSERVED at generation —
   * where, by definition, no person had yet read anything. Editorial control happens afterwards,
   * and only the publisher can assert it. Claiming it is a legal statement, so it must be an
   * explicit, attributable act by a GHII: **the node never infers it.** It lifts the 50(4) text
   * duty exactly as `editorial-control` on the record does, and it lifts nothing else — a declared
   * editor does not make a deep fake unlabelled.
   */
  editorialResponsibility?: boolean;
  /** The publisher marked the surface artistic / satirical / fictional (Art. 50(4) 2nd subpara). */
  creativeWork?: boolean;
  /** A person is in a two-way exchange with a model AT THIS MOMENT (Art. 50(1)). */
  interactive?: boolean;
  /** What kind of content this is. Non-text engages Art. 50(4) 1st subpara (deep fakes). */
  mediaKind?: 'text' | 'image' | 'audio' | 'video';
}

export interface DisclosureDecision {
  required: boolean;
  reason: AiDisclosureReason;
  strength: DisclosureStrength;
}

const NOTHING_OWED: DisclosureDecision = { required: false, reason: 'none', strength: 'none' };

/** Artistic, satirical or fictional surfaces disclose — present, but not intrusive. */
const strengthFor = (ctx: SurfaceContext): DisclosureStrength => (ctx.creativeWork ? 'light' : 'full');

/**
 * A model touched this, the law lets it pass, and the node may still want it labelled.
 *
 * Always LIGHT: the operator is going beyond the law, so the label is present rather than loud —
 * a full "no human editorial review" statement on content a person actually reviewed would be a
 * false statement, which is a worse outcome than no label at all. `reason: 'policy'` keeps the
 * distinction legible to anyone auditing why a label appeared.
 *
 * Only ever on an anonymously readable surface. A private item exempt under the law is not a
 * compliance posture question; nobody is being informed of anything there.
 */
function exemptButForPolicy(policy: DisclosureLabelPolicy, publiclyReadable: boolean): DisclosureDecision {
  if (policy !== 'strict' || !publiclyReadable) return NOTHING_OWED;
  return { required: true, reason: 'policy', strength: 'light' };
}

/**
 * Decide the visible disclosure for one item on one surface.
 *
 * The rules apply in this order, and the order carries meaning:
 *
 * 1. **No natural person here → nothing owed.** On a machine plane the record IS the disclosure.
 * 2. **A person conversing with a model → Art. 50(1), always.** This duty is about the exchange,
 *    not the content, so it does not care what `level` says, whether a record exists at all, or how
 *    visible the surface is.
 * 3. **Unstated provenance → nothing owed** (but see the note in the file header: not a denial).
 * 4. **A public deep fake → Art. 50(4) 1st subpara**, regardless of subject matter AND regardless
 *    of review. The review exemption belongs to the text limb; it does not reach deep fakes.
 * 5. **A person held editorial control → no 50(4) text duty.** The record still exists and is still
 *    served on every machine plane.
 * 6. Otherwise the text limb: model-touched, nobody read the substance, published anonymously
 *    readable, on a matter of public interest → **Art. 50(4) 2nd subpara**. `assisted` lands here
 *    too, at LIGHT strength — see the comment on that branch.
 * 7. Finally the NODE POLICY, which can only ever say "label something the law let you skip". It
 *    never downgrades a legal reason and never reaches content no model touched.
 *
 * `policy` is the third parameter rather than a member of `SurfaceContext` because it describes the
 * NODE, not the surface: every surface on one node shares it, and putting it in the context would
 * invite a caller to vary it per surface, which is exactly how an operator's compliance posture
 * would come to depend on which route a reader arrived through.
 */
export function disclosureFor(
  input: MaybeAiProvenance, ctx: SurfaceContext, policy: DisclosureLabelPolicy = 'light',
): DisclosureDecision {
  // 1 — nobody to inform.
  if (!ctx.humanAudience) return NOTHING_OWED;

  // 2 — Art. 50(1). The exchange itself is the trigger, and it survives `off`: a person talking to
  // a model must be told, and no operator setting may hide that. `off` reaches the CONTENT label
  // (a development convenience on an unreachable node), never the conversation one.
  if (ctx.interactive) return { required: true, reason: 'art50_1_interaction', strength: 'full' };

  if (policy === 'off') return NOTHING_OWED;

  const p = asKnownProvenance(input);

  // 3 — we know nothing, so we can owe nothing.
  if (!p) return NOTHING_OWED;
  if (p.level === 'original') return NOTHING_OWED;

  const publiclyReadable = ctx.visibility === 'public';

  // 4 — Art. 50(4) 1st subpara: deep fakes. `assisted` counts — a face-swap is precisely a
  // pre-existing human image partially modified by AI.
  const isDeepFake = ctx.mediaKind !== undefined && ctx.mediaKind !== 'text';
  if (publiclyReadable && isDeepFake) {
    return { required: true, reason: 'art50_4_deepfake', strength: strengthFor(ctx) };
  }

  // Rules 5 and 6 below are the three EXEMPTIONS the law grants. Each one hands off to the node
  // policy instead of returning silence, so `strict` catches exactly what the law let go and
  // nothing else: no model involved (rule 3, above) still means no label, on any policy.
  //
  // 5 — a person examined the substance and can reject it. Publishing is not that step. Either the
  // record observed it, or the publisher declared it at publication (an attributable act — the node
  // never infers editorial control on anyone's behalf).
  if (p.humanInvolvement === 'editorial-control' || p.humanInvolvement === 'full-human') {
    return exemptButForPolicy(policy, publiclyReadable);
  }
  if (ctx.editorialResponsibility === true) return exemptButForPolicy(policy, publiclyReadable);

  // 6 — Art. 50(4) 2nd subpara: text published to inform the public on matters of public interest.
  if (!publiclyReadable) return NOTHING_OWED;
  // Over-labelling default (D4): absent and `unknown` both mean YES. Only an explicit `no` opts out.
  if (ctx.publicInterest === 'no') return exemptButForPolicy(policy, publiclyReadable);

  // `assisted` is LIGHT, never full. Read literally, Art. 50(4) reaches content "generated or
  // manipulated" by AI and an assisted text is a human's, so the letter says nothing is owed — and
  // that is where Phase 1 landed. It is the wrong answer for this platform: decision D4 is to
  // over-label rather than sit on the line, and the Commission built an icon for precisely this case
  // (*Partially AI-Modified* — pre-existing human-made content partially modified with AI, on
  // matters of public interest). Under-labelling is the violation; over-labelling costs an icon.
  //
  // What `assisted` + `none` actually means, since it reads like a contradiction: a human wrote it,
  // a model edited it, and NOBODY CHECKED WHAT THE MODEL DID. `humanInvolvement` describes review of
  // the model's contribution, not authorship.
  // WHICH BASIS THE RECORD CLAIMS, now that the label itself is decided.
  //
  // D4 above says an absent or `unknown` publicInterest labels anyway, and that stays. What changed
  // is the REASON written down: 'art50_4_public_interest' asserts the content is text published to
  // inform the public on a matter of public interest, and for an unstated surface nobody asserted
  // that. Recorded on a dice game it was simply false, and it also made a declaration unreadable —
  // an author who stated public-interest=yes produced a record identical to one who stated nothing.
  //
  // So: the statutory reason when it was actually stated, the precautionary one when it was not.
  // The label a reader sees is byte-identical either way, which is the point.
  const stated = ctx.publicInterest === 'yes';
  const reason: AiDisclosureReason = stated ? 'art50_4_public_interest' : 'art50_4_precautionary';

  if (p.level === 'assisted') return { required: true, reason, strength: 'light' };

  return { required: true, reason, strength: strengthFor(ctx) };
}
