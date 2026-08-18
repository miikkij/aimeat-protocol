/**
 * @file public/components/ai-label.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE visible AI label (TARGET-058 Phase 3) — Article 50(5) made concrete: clear,
 *   distinguishable, at first exposure, accessible. One component; no surface hand-rolls a badge.
 *   If it is awkward to use somewhere, fix it here rather than forking it.
 *
 *   IT RENDERS, IT DOES NOT DECIDE. Whether a label is owed was already decided by disclosureFor()
 *   on the server and is carried in `record.disclosure.required`. A view that writes
 *   `if (looksAiGenerated) <AiLabel/>` has put the legal test in the wrong place — pass the record
 *   and let this component return null. That is why the guard lives here and not at every call site.
 *
 *   THE ICONS ARE LOCKUPS, NOT GLYPHS. Only `ai-basic` is square. `ai-generated` is 1789.84:566.93
 *   (≈3.16:1) and `ai-modified` is 3:1 — wide badges containing the words. They are sized by WIDTH
 *   with `aspect-ratio` in the CSS; a square icon box distorts two of the three. Do not draw our own
 *   mark and do not localise the glyph: the whole point of an official icon is that it is the same
 *   everywhere, and there is no Finnish variant to invent. The text beside it is localised.
 *
 *   ICON AND TEXT ALWAYS SHIP TOGETHER. Not only for accessibility: the Commission's own user
 *   testing found the basic icon performed better on every measure when accompanied by a text label.
 *   The text is real text with an `aria-label`, never an image of text, and never colour alone.
 *
 *   THE ICON IS A CSS BACKGROUND, NOT AN `<img>`. The four variants (`_black`, `_white`, and their
 *   50%-opacity siblings) are a THEME choice, and `src` cannot follow `[data-theme]` while a
 *   background-image can. The accessibility contract is kept by `role="img"` plus an `aria-label`
 *   carrying the plain-language statement, so the icon never conveys meaning alone.
 *
 *   WHICH icon is decided by ./ai-label-icons.js — a pure, import-free module precisely so a unit
 *   test can load it under node and compare it against the normative server adapter.
 * @structure
 *   - AiLabel({ record, recordUrl, variant, class }) — the badge; null when no label is owed
 *   - AiInteractionNotice({ class }) — the Art. 50(1) "you are talking to a model" disclosure
 * @usage
 *   import { AiLabel } from '/components/index.js';
 *   html`<${AiLabel} record=${prov.record} recordUrl=${prov.recordUrl} />`
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 3. Copy from docs/internal/EUAct/09 §2 + §5, icon rules
 *     from 15-eu-label-icons.md and public/assets/eu-ai-icons/README.md.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { euIconFor } from './ai-label-icons.js';

const html = htm.bind(h);


/**
 * Pick the localized string out of a record's pre-rendered disclosure block, falling back to English
 * and then to the local i18n bundle.
 *
 * The record travels translated on purpose (mintProvenance pulls every locale the node ships), so
 * the markdown face, an MCP result and this badge say the same words. Reaching for the bundle is the
 * last resort — for a record minted by a node whose locales do not include this reader's.
 */
function localized(block, field, fallbackKey) {
  const text = block?.[field];
  if (text && typeof text === 'object') {
    const loc = (document.documentElement.lang || 'en').slice(0, 2);
    if (typeof text[loc] === 'string') return text[loc];
    if (typeof text.en === 'string') return text.en;
  }
  return t(fallbackKey);
}

/**
 * The visible AI label.
 *
 * Renders NOTHING unless `record.disclosure.required` is true. Absent, unstated or human-written
 * content is not labelled, and a label everywhere is a label nowhere.
 *
 * @param {object} props
 * @param {any} props.record        the `aimeat.provenance/v1` document (from `meta.provenance.record`)
 * @param {string} [props.recordUrl] absolute URL of the addressable record — the "How this was made"
 *                                   link, which is the interactive second layer the Code encourages
 * @param {'inline'|'block'} [props.variant] `inline` chip beside a title (default), `block` banner
 *                                   above a body of text
 * @param {string} [props.class]     extra classes for the wrapper
 */
export function AiLabel({ record, recordUrl, variant = 'inline', class: extraClass = '' }) {
  const disclosure = record?.disclosure;
  if (!disclosure?.required) return null;

  const icon = euIconFor(record);
  if (!icon) return null;

  // `strength` is optional on the record (added in Phase 3; a Phase 1/2 record has none). Absent
  // means "show the label" — the obligation lives in `required`, and defaulting to the quieter form
  // under-states rather than over-states.
  const strength = disclosure.strength === 'full' ? 'full' : 'light';
  const short = localized(disclosure, 'short', 'aiLabel.short');
  const long = localized(disclosure, 'long', 'aiLabel.publicText');
  const alt = t(icon.alt);
  const url = recordUrl || record?.attestation?.recordUrl;

  return html`
    <div class="ai-label ai-label--${variant} ai-label--${strength} ${extraClass}"
         role="group" aria-label=${t('aiLabel.regionLabel')}>
      <span class="ai-label__icon ai-label__icon--${icon.file}" role="img" aria-label=${alt} title=${alt}></span>
      <span class="ai-label__text">
        <span class="ai-label__short">${short}</span>
        ${/* The long statement belongs to the BLOCK form only. A list row carrying a full sentence
              per item is the "wall of metadata at first exposure" doc 09 §2 warns against: the badge
              stays short, and the detail is one click away behind "How this was made". */''}
        ${variant === 'block' && strength === 'full' && long ? html`<span class="ai-label__long">${long}</span>` : null}
      </span>
      ${url
        ? html`<a class="ai-label__link" href=${url} target="_blank" rel="noopener noreferrer">
            ${t('aiLabel.detailsLink')}
          </a>`
        : null}
    </div>
  `;
}

/**
 * A standing statement that a model is on the other end, or wrote what you are looking at.
 *
 * Separate from AiLabel because it answers a different question. AiLabel is Art. 50(4): it labels
 * PUBLISHED content, and it renders only when `disclosure.required` says a label is owed. This one
 * covers Art. 50(1) — a person conversing with a model — and the honest-UI case beside it: text a
 * model just produced FOR you. Neither of those depends on publication, so neither is gated on the
 * record, and dressing them up as a 50(4) label would mean pre-rendering a record that claims a
 * legal obligation nobody has. Two duties, two components, no false statements.
 *
 * It carries no EU icon: the official icon set is for content labelling. It is never suppressed by
 * AIMEAT_AI_LABEL_PUBLIC=off either — an operator may choose how loudly to label content, never
 * whether to tell a person they are talking to a machine.
 *
 * @param {object} props
 * @param {string} [props.titleKey] i18n key for the headline (default: the Art. 50(1) wording)
 * @param {string} [props.bodyKey]  i18n key for the sentence under it
 * @param {string} [props.recordUrl] optional link to a provenance record, when one exists
 * @param {string} [props.class]
 */
export function AiInteractionNotice({
  titleKey = 'aiLabel.interactionTitle', bodyKey = 'aiLabel.interactionBody',
  recordUrl, class: extraClass = '',
}) {
  return html`
    <div class="ai-label ai-label--interaction ${extraClass}" role="note">
      <span class="ai-label__text">
        <span class="ai-label__short">${t(titleKey)}</span>
        <span class="ai-label__long">${t(bodyKey)}</span>
      </span>
      ${recordUrl
        ? html`<a class="ai-label__link" href=${recordUrl} target="_blank" rel="noopener noreferrer">
            ${t('aiLabel.detailsLink')}
          </a>`
        : null}
    </div>
  `;
}
